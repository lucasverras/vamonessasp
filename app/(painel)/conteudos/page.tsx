import Link from 'next/link'
import { Link2, Play, Unlink } from 'lucide-react'
import {
  listarConteudos,
  listarVinculosPendentes,
  ordenar,
  type Ordenacao,
  type Periodo,
  type Plataforma,
} from '@/lib/analytics/conteudos'
import { sessaoAtual } from '@/lib/auth/guarda'
import { db } from '@/lib/db'
import { desfazerVinculo, vincularConteudo } from './acoes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conteúdos' }

const compacto = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.', ',')} mi`
  if (n >= 10_000) return `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace('.', ',')} mil`
  return n.toLocaleString('pt-BR')
}

const PERIODOS: Array<[Periodo, string]> = [
  ['hoje', 'Hoje'],
  ['7d', '7 dias'],
  ['30d', '30 dias'],
  ['mes', 'Este mês'],
  ['mes-anterior', 'Mês anterior'],
  ['tudo', 'Tudo'],
]
const PLATAFORMAS: Array<[Plataforma, string]> = [
  ['todos', 'Todos'],
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['tiktok', 'TikTok'],
]
const ORDENACOES: Array<[Ordenacao, string]> = [
  ['recentes', 'Mais recentes'],
  ['antigos', 'Mais antigos'],
  ['total', 'Total de views'],
  ['ig', 'Views Instagram'],
  ['fb', 'Views Facebook'],
  ['interacoes', 'Interações'],
]

export default async function Conteudos({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams
  const periodo = (PERIODOS.some(([p]) => p === sp.periodo) ? sp.periodo : 'tudo') as Periodo
  const plataforma = (PLATAFORMAS.some(([p]) => p === sp.plat) ? sp.plat : 'todos') as Plataforma
  const ord = (ORDENACOES.some(([o]) => o === sp.ord) ? sp.ord : 'recentes') as Ordenacao

  const [todos, sessao, pendentes, { count: tiktokContas }] = await Promise.all([
    listarConteudos(periodo),
    sessaoAtual(),
    listarVinculosPendentes(),
    db().from('tiktok_accounts').select('id', { count: 'exact', head: true }).eq('connection_status', 'CONNECTED'),
  ])
  const admin = sessao?.papel === 'ADMIN'
  const temTikTok = (tiktokContas ?? 0) > 0

  const filtrados =
    plataforma === 'todos' ? todos : todos.filter((c) => c.plataformas.includes(plataforma))
  const itens = ordenar(filtrados, ord)

  // Somas do topo respeitam o MESMO período e filtro da lista.
  const soma = (f: (c: (typeof itens)[number]) => number | null) => {
    const vals = itens.map(f).filter((v): v is number => v !== null)
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null
  }
  const resumo = {
    ig: soma((c) => c.ig_views),
    fb: soma((c) => c.fb_views),
    tt: soma((c) => c.tt_views),
    total: soma((c) => c.total_views),
    interacoes: soma((c) => c.total_interacoes),
  }

  const link = (mut: Partial<Record<'periodo' | 'plat' | 'ord', string>>) => {
    const q = new URLSearchParams()
    const fin = { periodo, plat: plataforma, ord, ...mut }
    if (fin.periodo !== 'tudo') q.set('periodo', fin.periodo)
    if (fin.plat !== 'todos') q.set('plat', fin.plat)
    if (fin.ord !== 'recentes') q.set('ord', fin.ord)
    const s = q.toString()
    return s ? `/conteudos?${s}` : '/conteudos'
  }

  return (
    <main className="mx-auto max-w-[1240px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Conteúdos
        </h1>
        <p className="mt-1 text-sm text-ink-faint">
          Desempenho consolidado por conteúdo, em todas as redes.
        </p>
      </header>

      {/* Resumo por plataforma — sempre no MESMO período/filtro da lista. */}
      <section
        className="rise mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-4"
        style={{ animationDelay: '50ms' }}
      >
        {[
          ['Instagram', resumo.ig, null],
          ['Facebook', resumo.fb, null],
          ['TikTok', resumo.tt, temTikTok ? null : 'aguardando integração'],
          ['Total de views', resumo.total, 'soma das plataformas'],
        ].map(([rotulo, valor, nota]) => (
          <div key={rotulo as string} className="bg-canvas px-5 py-4">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {rotulo as string}
            </p>
            <p
              className="tnum mt-1.5 font-display text-xl font-semibold tracking-[-0.02em]"
              title={
                rotulo === 'Total de views'
                  ? 'Soma das visualizações nas plataformas com dado disponível. NÃO são pessoas únicas: a mesma pessoa pode ter visto em mais de uma rede.'
                  : undefined
              }
            >
              {valor === null ? '—' : compacto(valor as number)}
            </p>
            {nota ? <p className="mt-0.5 text-[0.6875rem] text-ink-faint">{nota as string}</p> : null}
          </div>
        ))}
      </section>

      {/* Filtros */}
      <section className="rise mt-5 flex flex-wrap items-center gap-x-5 gap-y-2.5" style={{ animationDelay: '80ms' }}>
        <div className="flex flex-wrap gap-1">
          {PERIODOS.map(([p, rotulo]) => (
            <Link
              key={p}
              href={link({ periodo: p })}
              className={`rounded-full px-3 py-1.5 text-[0.75rem] font-medium transition-colors ${
                periodo === p ? 'bg-accent text-void' : 'text-ink-faint hover:bg-surface hover:text-ink'
              }`}
            >
              {rotulo}
            </Link>
          ))}
        </div>
        <span className="hidden h-4 w-px bg-line sm:block" />
        <div className="flex flex-wrap gap-1">
          {PLATAFORMAS.map(([p, rotulo]) => (
            <Link
              key={p}
              href={link({ plat: p })}
              className={`rounded-full px-3 py-1.5 text-[0.75rem] font-medium transition-colors ${
                plataforma === p ? 'bg-surface text-ink' : 'text-ink-faint hover:text-ink'
              }`}
            >
              {rotulo}
            </Link>
          ))}
        </div>
        <span className="hidden h-4 w-px bg-line sm:block" />
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">ordenar:</span>
          {ORDENACOES.map(([o, rotulo]) => (
            <Link
              key={o}
              href={link({ ord: o })}
              className={`rounded-full px-2.5 py-1 text-[0.75rem] transition-colors ${
                ord === o ? 'font-semibold text-accent' : 'text-ink-faint hover:text-ink'
              }`}
            >
              {rotulo}
            </Link>
          ))}
        </div>
      </section>

      {/* Desktop: tabela com zebra e cabeçalho fixo. */}
      <div className="rise mt-5 overflow-hidden rounded-card border border-line" style={{ animationDelay: '110ms' }}>
        <div className="hidden max-h-[70vh] overflow-auto lg:block">
          <table className="w-full border-collapse text-left">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-canvas shadow-[0_1px_0_var(--color-line)]">
                <th className="bg-canvas px-4 py-3 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Conteúdo
                </th>
                <th className="bg-canvas px-3 py-3 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Data
                </th>
                {['Instagram', 'Facebook', 'TikTok'].map((h) => (
                  <th key={h} className="bg-canvas px-3 py-3 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                    {h}
                  </th>
                ))}
                <th className="bg-canvas px-3 py-3 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Total
                </th>
                <th className="bg-canvas px-4 py-3 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Distribuição
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.map((c) => {
                const conhecidas = [c.ig_views, c.fb_views, c.tt_views].filter(
                  (v): v is number => v !== null,
                )
                const totalDist = conhecidas.reduce((a, b) => a + b, 0)
                const pct = (v: number | null) =>
                  v !== null && totalDist > 0 ? Math.round((v / totalDist) * 100) : null
                return (
                  /* Zebra sutil: linhas pares levemente elevadas — o olho segue
                     a linha inteira sem esforço, sem virar planilha antiga. */
                  <tr
                    key={c.content_id}
                    className="border-b border-line-soft/60 last:border-0 odd:bg-transparent even:bg-surface/45"
                  >
                    <td className="max-w-[300px] px-4 py-3">
                      <a href={c.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-2.5">
                        {c.thumbnail_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbnail_url} alt="" className="size-9 shrink-0 rounded object-cover" />
                        ) : (
                          <span className="grid size-9 shrink-0 place-items-center rounded bg-surface">
                            <Play className="size-3.5 text-ink-faint" />
                          </span>
                        )}
                        <span className="truncate text-[0.8125rem] leading-snug text-ink-soft">
                          {c.title || 'Sem título'}
                        </span>
                      </a>
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-3 text-[0.75rem] text-ink-faint">
                      {new Date(c.published_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' })}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[0.875rem] font-semibold">
                      {compacto(c.ig_views)}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[0.875rem]">
                      {c.plataformas.includes('facebook') ? compacto(c.fb_views) : <span className="text-ink-faint">—</span>}
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[0.8125rem] text-ink-faint" title={temTikTok ? undefined : 'Integração TikTok aguardando aprovação'}>
                      —
                    </td>
                    <td className="tnum px-3 py-3 text-right text-[0.9375rem] font-bold" title="Soma das views nas plataformas com dado. Não são pessoas únicas.">
                      {compacto(c.total_views)}
                    </td>
                    <td className="px-4 py-3">
                      {totalDist > 0 && conhecidas.length > 1 ? (
                        <div className="flex items-center gap-2">
                          <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-line-soft">
                            {c.ig_views !== null && (
                              <span style={{ width: `${pct(c.ig_views)}%` }} className="bg-accent" />
                            )}
                            {c.fb_views !== null && (
                              <span style={{ width: `${pct(c.fb_views)}%` }} className="bg-ink-faint" />
                            )}
                          </div>
                          <span className="tnum text-[0.6875rem] text-ink-faint">
                            IG {pct(c.ig_views) ?? 0}% · FB {pct(c.fb_views) ?? 0}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-[0.6875rem] text-ink-faint">
                          {c.plataformas.length === 1 ? 'só ' + c.plataformas[0] : '—'}
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile: cada conteúdo vira uma pilha vertical. */}
        <ul className="divide-y divide-line-soft lg:hidden">
          {itens.slice(0, 60).map((c) => (
            <li key={c.content_id} className="p-4 odd:bg-transparent even:bg-surface/45">
              <a href={c.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-3">
                {c.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.thumbnail_url} alt="" className="size-11 shrink-0 rounded object-cover" />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem] font-medium">{c.title || 'Sem título'}</p>
                  <p className="tnum text-[0.6875rem] text-ink-faint">
                    {new Date(c.published_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <p className="tnum text-right font-display text-lg font-bold">{compacto(c.total_views)}</p>
              </a>
              <dl className="tnum mt-2.5 grid grid-cols-3 gap-2 text-center text-[0.75rem]">
                <div className="rounded-lg bg-void/50 py-1.5">
                  <dt className="text-[0.625rem] uppercase text-ink-faint">IG</dt>
                  <dd className="font-semibold">{compacto(c.ig_views)}</dd>
                </div>
                <div className="rounded-lg bg-void/50 py-1.5">
                  <dt className="text-[0.625rem] uppercase text-ink-faint">FB</dt>
                  <dd className="font-semibold">{compacto(c.fb_views)}</dd>
                </div>
                <div className="rounded-lg bg-void/50 py-1.5">
                  <dt className="text-[0.625rem] uppercase text-ink-faint">TT</dt>
                  <dd className="text-ink-faint">—</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
        <strong className="text-ink-soft">Total</strong> é a soma das visualizações nas plataformas
        com dado disponível — não é alcance único: a mesma pessoa pode ter visto em duas redes.
        TikTok aparece quando a integração for aprovada; enquanto isso, ausência é ausência, nunca zero.
      </p>

      {/* Vínculos pendentes: só ADMIN vincula/desfaz. */}
      {admin && pendentes.length > 0 ? (
        <section className="rise mt-9" style={{ animationDelay: '150ms' }}>
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
            Vínculos aguardando revisão
          </h2>
          <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-faint">
            Publicações do Facebook que o matching automático não vinculou com confiança
            suficiente (similaridade ≥ 0,60 e candidato único). Confirme ou deixe sem grupo.
          </p>
          <ul className="mt-4 space-y-2">
            {pendentes.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-canvas px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[0.8125rem]">
                    <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-[0.625rem] font-semibold uppercase text-ink-faint">FB</span>
                    {(p.caption ?? 'Sem legenda').replace(/\s+/g, ' ').slice(0, 90)}
                  </p>
                  {p.sugestaoContentId ? (
                    <p className="mt-1 truncate text-[0.75rem] text-ink-faint">
                      sugestão (sim {p.sugestaoSim}): {(p.sugestaoCaption ?? '').replace(/\s+/g, ' ').slice(0, 90)}
                    </p>
                  ) : (
                    <p className="mt-1 text-[0.75rem] text-ink-faint">sem candidato razoável no Instagram</p>
                  )}
                </div>
                {p.sugestaoContentId ? (
                  <form
                    action={async () => {
                      'use server'
                      await vincularConteudo(p.id, p.sugestaoContentId!)
                    }}
                  >
                    <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[0.75rem] font-semibold text-void transition-transform hover:-translate-y-px">
                      <Link2 className="size-3.5" /> Vincular
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Desfazer vínculos automáticos: lista compacta, só para ADMIN. */}
      {admin ? <DesfazerVinculos /> : null}
    </main>
  )
}

async function DesfazerVinculos() {
  const { data } = await db()
    .from('platform_posts')
    .select('id,caption,match_confidence,match_method')
    .eq('platform', 'facebook')
    .not('content_id', 'is', null)
    .order('match_confidence', { ascending: true })
    .limit(8)

  if (!data?.length) return null
  return (
    <details className="rise mt-6 rounded-card border border-line bg-canvas px-4 py-3">
      <summary className="cursor-pointer text-[0.8125rem] font-medium text-ink-soft">
        Vínculos automáticos de menor confiança (desfazer se estiver errado)
      </summary>
      <ul className="mt-3 space-y-1.5">
        {data.map((v) => (
          <li key={v.id as string} className="flex items-center gap-3 text-[0.75rem]">
            <span className="tnum shrink-0 rounded bg-surface px-1.5 py-0.5 text-ink-faint">
              sim {Number(v.match_confidence ?? 0).toFixed(2)}
            </span>
            <span className="min-w-0 flex-1 truncate text-ink-soft">
              {((v.caption as string | null) ?? '').replace(/\s+/g, ' ').slice(0, 80)}
            </span>
            <form
              action={async () => {
                'use server'
                await desfazerVinculo(v.id as string)
              }}
            >
              <button type="submit" className="inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-[0.6875rem] text-ink-faint transition-colors hover:border-danger hover:text-danger">
                <Unlink className="size-3" /> desfazer
              </button>
            </form>
          </li>
        ))}
      </ul>
    </details>
  )
}
