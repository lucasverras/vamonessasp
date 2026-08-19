import { NextResponse, type NextRequest } from 'next/server'
import { safeEqual } from '@/lib/crypto'
import { env } from '@/lib/env'
import { syncAccount } from '@/lib/instagram/account'
import { backfillDailyInsights } from '@/lib/instagram/backfill'
import { syncComentarios } from '@/lib/instagram/comments'
import { syncMedia, syncMediaInsights } from '@/lib/instagram/media'
import { expirarVencidos } from '@/lib/campaigns/eligibility'
import { destravarPresos, processarLote } from '@/lib/campaigns/worker'
import { analisarPendentes } from '@/lib/ai/analise'
import { syncFacebook } from '@/lib/facebook/sync'
import { analisarFacebookPendentes } from '@/lib/facebook/comments'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Endpoints de sincronização agendada.
 *
 * Disparados pelo pg_cron do Supabase, que chama estas URLs com o header
 * x-cron-secret. Escolhemos pg_cron em vez do Vercel Cron porque o plano Hobby
 * executa uma vez por dia — inútil para snapshot horário — enquanto o pg_cron
 * dá granularidade de minuto sem custo.
 *
 * Cada job é idempotente: reexecutar não duplica nada.
 */

const JOBS = {
  /** Snapshot horário: a série de seguidores que a Meta não fornece. */
  'snapshot-account': () => syncAccount('cron_hourly'),

  /** Conteúdos novos e atualização de legenda/permalink. */
  'sync-media': () => syncMedia(),

  /**
   * Insights recentes. Só os últimos 7 dias: insights se movem rápido nas
   * primeiras horas e ficam estáveis depois — recoletar 256 conteúdos de hora
   * em hora seria desperdício de rate limit sem ganho de informação.
   */
  'sync-insights-recent': () => syncMediaInsights({ sinceDays: 7 }),

  /** Varredura completa, para o acervo antigo. Diária. */
  'sync-insights-full': () => syncMediaInsights(),

  /** Métricas diárias da conta. O Facebook Login expõe 30 dias. */
  'backfill-daily': () => backfillDailyInsights(30),

  /**
   * Reconciliação de comentários. O webhook não garante entrega, e enquanto o
   * app não estiver Live a Meta não envia nada — este job é o que mantém a
   * ingestão funcionando de qualquer forma.
   */
  'sync-comments': () => syncComentarios(),

  /** Marca como EXPIRED quem passou da janela de 7 dias. */
  'expirar-elegibilidade': async () => ({ expirados: await expirarVencidos() }),

  /**
   * Worker de envio. Roda a cada minuto e processa até 10 por vez: com teto de
   * 600/h, 10/min mantém o ritmo abaixo do limite oficial de 750/h com folga.
   * Não faz nada enquanto o kill switch estiver ligado.
   */
  'dm-worker': () => processarLote(10),

  /** Reels da Página do Facebook + auto-match com os contents do Instagram. */
  'sync-facebook': () => syncFacebook(),

  /** Devolve à fila o que ficou preso em SENDING por worker morto. */
  'destravar-fila': async () => ({ destravados: await destravarPresos() }),

  /**
   * Classificação por IA em SHADOW MODE. Gera e registra; não envia nada, e não
   * tem caminho para enviar — o worker recusa qualquer ação que não esteja
   * QUEUED, e estas nascem SHADOW.
   */
  // 60 com concorrência 6 ≈ 10 ondas de 3,6s ≈ 36s, dentro do limite de duração
  // da função com margem. Era 20 em série (~72s), escolhido quando o prompt ainda
  // não estava validado e o gotejamento lento protegia o bolso.
  'analisar-comentarios': async () => {
    const ig = await analisarPendentes(60)
    const fb = await analisarFacebookPendentes(10)
    return { ...ig, facebook: fb.analisados }
  },
} as const

type JobName = keyof typeof JOBS

export async function POST(request: NextRequest, context: { params: Promise<{ job: string }> }) {
  const secret = request.headers.get('x-cron-secret')
  if (!secret || !safeEqual(secret, env.cronSecret)) {
    return NextResponse.json({ erro: 'não autorizado' }, { status: 401 })
  }

  const { job } = await context.params
  const handler = JOBS[job as JobName]
  if (!handler) {
    return NextResponse.json(
      { erro: 'job desconhecido', disponiveis: Object.keys(JOBS) },
      { status: 404 },
    )
  }

  const started = Date.now()
  try {
    const result = await handler()
    return NextResponse.json({ ok: true, job, ms: Date.now() - started, result })
  } catch (error) {
    // O erro já foi registrado em sync_runs pelo próprio job.
    return NextResponse.json(
      {
        ok: false,
        job,
        ms: Date.now() - started,
        erro: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
