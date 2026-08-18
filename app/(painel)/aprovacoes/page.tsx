import Link from 'next/link'
import { AlertTriangle, Inbox } from 'lucide-react'
import { AprovacoesLista, type ItemAprovacao } from '@/components/aprovacoes-lista'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aprovações' }

type Origem = 'todas' | 'novos' | 'campanha'
type Tipo = 'todas' | 'publica' | 'dm'
type Vista = 'pendentes' | 'enviadas' | 'descartadas' | 'editadas'
type Ordem = 'recentes' | 'antigos'

function relativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 60) return `há ${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`
}

export default async function Aprovacoes({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const origem = (['todas', 'novos', 'campanha'].includes(sp.origem ?? '') ? sp.origem : 'todas') as Origem
  const tipo = (['todas', 'publica', 'dm'].includes(sp.tipo ?? '') ? sp.tipo : 'todas') as Tipo
  const vista = (['pendentes', 'enviadas', 'descartadas', 'editadas'].includes(sp.vista ?? '') ? sp.vista : 'pendentes') as Vista
  const ordem = (sp.ordem === 'antigos' ? 'antigos' : 'recentes') as Ordem

  let q = db()
    .from('comment_actions')
    .select(
      'id,action_type,status,generated_text,final_text,edited_by,campaign_id,created_at,sent_at,rejected_reason,' +
        'instagram_comments:comment_id(username,text,commented_at,instagram_media:media_id(caption,thumbnail_url)),' +
        'comment_analyses:analysis_id(intent,intent_confidence,decision_reason)',
    )
    .order('created_at', { ascending: ordem === 'antigos' })
    .limit(40)

  if (vista === 'pendentes') q = q.eq('status', 'PENDING_APPROVAL')
  else if (vista === 'enviadas') q = q.eq('status', 'SENT').not('approved_by', 'is', null)
  else if (vista === 'descartadas') q = q.eq('status', 'REJECTED')
  else q = q.not('edited_by', 'is', null)

  if (tipo !== 'todas') q = q.eq('action_type', tipo === 'dm' ? 'PRIVATE_REPLY' : 'PUBLIC_REPLY')
  if (origem === 'novos') q = q.is('campaign_id', null)
  if (origem === 'campanha') q = q.not('campaign_id', 'is', null)

  const [{ data: acoes, error }, { data: metricasRaw }] = await Promise.all([
    q,
    db().rpc('aprovacao_metricas'),
  ])
  if (error) throw new Error(`Falha ao carregar aprovações: ${error.message}`)
  const m = (Array.isArray(metricasRaw) ? metricasRaw[0] : metricasRaw) as Record<string, number> | null

  // O parser de tipos do PostgREST não entende select montado por concatenação;
  // o shape real está garantido pela query acima.
  interface Linha {
    id: string
    action_type: string
    status: string
    generated_text: string | null
    final_text: string | null
    edited_by: string | null
    campaign_id: string | null
    created_at: string
    instagram_comments: unknown
    comment_analyses: unknown
  }
  const linhas = (acoes ?? []) as unknown as Linha[]

  const itens: ItemAprovacao[] = linhas.map((a) => {
    const c = a.instagram_comments as unknown as {
      username: string | null
      text: string | null
      commented_at: string
      instagram_media: { caption: string | null; thumbnail_url: string | null } | null
    } | null
    const an = a.comment_analyses as unknown as {
      intent: string | null
      intent_confidence: number | null
      decision_reason: string | null
    } | null
    return {
      id: a.id,
      tipo: a.action_type as 'PUBLIC_REPLY' | 'PRIVATE_REPLY',
      username: c?.username ?? null,
      comentario: c?.text ?? null,
      conteudo: c?.instagram_media?.caption ?? null,
      thumbnail: c?.instagram_media?.thumbnail_url ?? null,
      quando: relativo(c?.commented_at ?? a.created_at),
      sugestao: (a.final_text ?? a.generated_text ?? '').trim(),
      editada: Boolean(a.edited_by),
      intent: an?.intent ?? null,
      confianca: an?.intent_confidence !== null && an?.intent_confidence !== undefined ? Number(an.intent_confidence) : null,
      motivo: an?.decision_reason ?? (a.campaign_id ? 'campanha de DM criada por você' : null),
      origem: a.campaign_id ? 'campanha' : 'novo',
    }
  })

  const taxa = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1).replace('.', ',')}%` : '—')
  const revisadas = (m?.approved_today ?? 0) + (m?.discarded_today ?? 0)

  const filtro = (mut: Partial<Record<'origem' | 'tipo' | 'vista' | 'ordem', string>>) => {
    const fin = { origem, tipo, vista, ordem, ...mut }
    const p = new URLSearchParams()
    if (fin.origem !== 'todas') p.set('origem', fin.origem)
    if (fin.tipo !== 'todas') p.set('tipo', fin.tipo)
    if (fin.vista !== 'pendentes') p.set('vista', fin.vista)
    if (fin.ordem !== 'recentes') p.set('ordem', fin.ordem)
    const s = p.toString()
    return s ? `/aprovacoes?${s}` : '/aprovacoes'
  }

  return (
    <main className="mx-auto max-w-[860px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            Aprovações
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Comentário → resposta sugerida → OK. Nada sai sem o seu clique.
          </p>
        </div>
        <dl className="flex gap-5 text-right">
          {[
            ['Aguardando', m?.pending_approval ?? 0],
            ['Aprovadas hoje', m?.approved_today ?? 0],
            ['Editadas hoje', m?.edited_today ?? 0],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-faint">{k as string}</dt>
              <dd className="tnum font-display text-xl font-semibold">{v as number}</dd>
            </div>
          ))}
        </dl>
      </header>

      {revisadas > 0 ? (
        <p className="rise mt-4 text-[0.75rem] text-ink-faint" style={{ animationDelay: '40ms' }}>
          Hoje: {taxa((m?.approved_today ?? 0) - (m?.edited_today ?? 0), revisadas)} aprovadas sem
          edição · {taxa(m?.edited_today ?? 0, revisadas)} editadas · {taxa(m?.discarded_today ?? 0, revisadas)} descartadas
          — é essa taxa que decide quando o LIVE merece confiança.
        </p>
      ) : null}

      {(m?.hold ?? 0) > 0 ? (
        <Link
          href="/revisao"
          className="rise mt-5 flex items-center gap-2.5 rounded-card border border-warn/40 bg-warn-wash/50 px-4 py-3 text-[0.8125rem] transition-transform hover:-translate-y-px"
          style={{ animationDelay: '60ms' }}
        >
          <AlertTriangle className="size-4 shrink-0 text-warn" />
          <span>
            <strong className="font-semibold">Precisa de você: {m?.hold}</strong> — sem sugestão
            pronta (falta informação ou é sensível). Não é OK cego: essas você escreve na Revisão.
          </span>
        </Link>
      ) : null}

      <nav className="rise mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-[0.75rem]" style={{ animationDelay: '80ms' }}>
        <span className="flex gap-1">
          {(['pendentes', 'enviadas', 'editadas', 'descartadas'] as const).map((vv) => (
            <Link key={vv} href={filtro({ vista: vv })} className={`rounded-full px-3 py-1.5 font-medium ${vista === vv ? 'bg-accent text-void' : 'text-ink-faint hover:bg-surface'}`}>
              {vv[0]!.toUpperCase() + vv.slice(1)}
            </Link>
          ))}
        </span>
        <span className="h-4 w-px bg-line" />
        <span className="flex gap-1">
          {(
            [
              ['todas', 'Todas'],
              ['novos', 'Novos'],
              ['campanha', 'Histórico pausado'],
            ] as const
          ).map(([o, r]) => (
            <Link key={o} href={filtro({ origem: o })} className={`rounded-full px-2.5 py-1 ${origem === o ? 'bg-surface font-semibold text-ink' : 'text-ink-faint hover:text-ink'}`}>
              {r}
            </Link>
          ))}
        </span>
        <span className="h-4 w-px bg-line" />
        <span className="flex gap-1">
          {(
            [
              ['todas', 'Públicas + DMs'],
              ['publica', 'Públicas'],
              ['dm', 'DMs'],
            ] as const
          ).map(([t, r]) => (
            <Link key={t} href={filtro({ tipo: t })} className={`rounded-full px-2.5 py-1 ${tipo === t ? 'bg-surface font-semibold text-ink' : 'text-ink-faint hover:text-ink'}`}>
              {r}
            </Link>
          ))}
        </span>
        <Link href={filtro({ ordem: ordem === 'recentes' ? 'antigos' : 'recentes' })} className="ml-auto text-ink-faint hover:text-ink">
          {ordem === 'recentes' ? 'mais recentes ↓' : 'mais antigos ↑'}
        </Link>
      </nav>

      <div className="rise mt-5" style={{ animationDelay: '110ms' }}>
        {vista === 'pendentes' ? (
          itens.length === 0 ? (
            <div className="rounded-card border border-dashed border-line px-6 py-14 text-center">
              <Inbox className="mx-auto size-5 text-ink-faint" />
              <p className="mt-3 text-[0.9375rem] font-medium">Fila limpa</p>
              <p className="mt-1 text-[0.8125rem] text-ink-faint">
                Novos comentários geram sugestões que aparecem aqui para o seu OK.
              </p>
            </div>
          ) : (
            <AprovacoesLista itens={itens} />
          )
        ) : (
          <ul className="space-y-2">
            {itens.map((i) => (
              <li key={i.id} className="rounded-card border border-line bg-canvas px-4 py-3">
                <div className="flex flex-wrap items-center gap-2 text-[0.75rem] text-ink-faint">
                  <span className="font-semibold text-ink">@{i.username ?? '—'}</span>
                  <span>{i.tipo === 'PRIVATE_REPLY' ? 'DM' : 'pública'}</span>
                  {i.editada ? <span className="rounded-full bg-surface px-2 py-0.5">editada</span> : null}
                  <span className="ml-auto">{i.quando}</span>
                </div>
                <p className="mt-1.5 text-[0.8125rem] italic text-ink-soft">{i.comentario}</p>
                <p className="mt-1 text-[0.875rem]">{i.sugestao}</p>
              </li>
            ))}
            {itens.length === 0 ? (
              <p className="py-10 text-center text-[0.8125rem] text-ink-faint">nada aqui ainda</p>
            ) : null}
          </ul>
        )}
      </div>
    </main>
  )
}
