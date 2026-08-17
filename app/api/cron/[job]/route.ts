import { NextResponse, type NextRequest } from 'next/server'
import { safeEqual } from '@/lib/crypto'
import { env } from '@/lib/env'
import { syncAccount } from '@/lib/instagram/account'
import { backfillDailyInsights } from '@/lib/instagram/backfill'
import { syncMedia, syncMediaInsights } from '@/lib/instagram/media'

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
