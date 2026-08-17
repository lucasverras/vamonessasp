import { db } from '@/lib/db'
import { GrowthChart } from '@/components/growth-chart'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Crescimento' }

const num = (n: number | null | undefined) =>
  n === null || n === undefined ? null : Number(n).toLocaleString('pt-BR')

export default async function Crescimento() {
  const [{ data: pos, error: e1 }, diarios, snaps] = await Promise.all([
    db().rpc('crescimento_pos_publicacao', { limite: 25 }),
    db()
      .from('account_daily_insights')
      .select('date,new_followers,is_provisional')
      .order('date', { ascending: true })
      .limit(400),
    db()
      .from('account_snapshots')
      .select('followers_count,captured_at')
      .order('captured_at', { ascending: true }),
  ])
  if (e1) throw new Error(`Falha ao carregar crescimento: ${e1.message}`)

  type Pos = {
    media_id: string
    caption: string | null
    permalink: string | null
    thumbnail_url: string | null
    published_at: string
    views: number | null
    base: number | null
    mais_1h: number | null
    mais_3h: number | null
    mais_6h: number | null
    mais_24h: number | null
    mais_48h: number | null
    mais_7d: number | null
  }
  const posts = (pos ?? []) as Pos[]
  const serie = (diarios.data ?? []).map((d) => ({
    data: d.date,
    novos: d.new_followers ?? 0,
    provisorio: d.is_provisional,
  }))

  const historico = (diarios.data ?? []).filter((d) => !d.is_provisional)
  const total = historico.reduce((s, d) => s + (d.new_followers ?? 0), 0)
  const media = historico.length > 0 ? total / historico.length : 0
  const melhor = historico.reduce(
    (m, d) => ((d.new_followers ?? 0) > (m?.new_followers ?? -1) ? d : m),
    historico[0],
  )

  const snapshots = snaps.data ?? []
  const primeiroSnap = snapshots[0]
  const ultimoSnap = snapshots.at(-1)

  const DELTAS = [
    ['+1h', 'mais_1h'],
    ['+3h', 'mais_3h'],
    ['+6h', 'mais_6h'],
    ['+24h', 'mais_24h'],
    ['+48h', 'mais_48h'],
    ['+7d', 'mais_7d'],
  ] as const

  const algumMedido = posts.some((p) => DELTAS.some(([, k]) => p[k] !== null))

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Crescimento
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-faint">
          Histórico diário da Meta, e o crescimento observado da conta depois de cada publicação.
        </p>
      </header>

      <section
        className="rise mt-7 grid gap-px overflow-hidden rounded-card border border-line bg-line grid-cols-2 lg:grid-cols-4"
        style={{ animationDelay: '60ms' }}
      >
        {[
          ['Novos seguidores no histórico', num(total) ?? '—'],
          ['Média por dia', media.toFixed(1)],
          [
            'Melhor dia',
            melhor
              ? `+${num(melhor.new_followers)} · ${new Date(`${melhor.date}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}`
              : '—',
          ],
          ['Dias de histórico', String(historico.length)],
        ].map(([k, v]) => (
          <div key={k} className="bg-canvas px-5 py-4">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {k}
            </p>
            <p className="tnum mt-1.5 font-display text-xl font-semibold tracking-[-0.02em]">{v}</p>
          </div>
        ))}
      </section>

      <section className="rise mt-10" style={{ animationDelay: '110ms' }}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
            Novos seguidores por dia
          </h2>
          <span className="text-[0.75rem] text-ink-faint">
            bruto — a Meta não desconta quem deixou de seguir
          </span>
        </div>
        <GrowthChart dados={serie} />
      </section>

      <section className="rise mt-11" style={{ animationDelay: '160ms' }}>
        <div className="mb-3">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
            Crescimento da conta após a publicação
          </h2>
          {/* Esta frase é o produto. A Meta não fornece atribuição de seguidores
              por Reel — nem no Instagram Login, nem no Facebook Login. O que
              existe é a coincidência temporal, e é assim que ela é nomeada. */}
          <p className="mt-1 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-faint">
            Isto <strong className="text-ink-soft">não</strong> significa que o conteúdo gerou esses
            seguidores. A API da Meta não fornece atribuição por Reel — verificamos em 60 caminhos
            diferentes. O que você vê é o crescimento da conta medido pelos nossos snapshots
            horários, no intervalo após a publicação. Correlação, não causa.
          </p>
        </div>

        {!algumMedido ? (
          <div className="rounded-card border border-dashed border-line px-6 py-12 text-center">
            <p className="text-[0.9375rem] font-medium">Ainda sem janelas medidas</p>
            <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-faint">
              O snapshot horário começou em{' '}
              {primeiroSnap
                ? new Date(primeiroSnap.captured_at).toLocaleString('pt-BR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'}
              . As janelas aparecem conforme os posts novos forem publicados com a série já rodando —
              não é possível medir retroativamente o que não foi capturado.
            </p>
            {primeiroSnap && ultimoSnap ? (
              <p className="tnum mt-3 text-[0.75rem] text-ink-faint">
                {snapshots.length} snapshots · {num(primeiroSnap.followers_count)} →{' '}
                {num(ultimoSnap.followers_count)} seguidores
              </p>
            ) : null}
          </div>
        ) : (
          <div className="overflow-hidden rounded-card border border-line">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                      Publicação
                    </th>
                    <th className="px-3 py-2.5 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                      Views
                    </th>
                    {DELTAS.map(([r]) => (
                      <th
                        key={r}
                        className="px-3 py-2.5 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint"
                      >
                        {r}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {posts.map((p) => (
                    <tr
                      key={p.media_id}
                      className="border-b border-line-soft bg-void/40 last:border-0"
                    >
                      <td className="max-w-[300px] px-4 py-2.5">
                        <a
                          href={p.permalink ?? '#'}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-2.5"
                        >
                          {p.thumbnail_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.thumbnail_url}
                              alt=""
                              className="size-8 shrink-0 rounded object-cover"
                            />
                          ) : null}
                          <span className="min-w-0">
                            <span className="block truncate text-[0.8125rem] text-ink-soft">
                              {p.caption?.replace(/\s+/g, ' ').slice(0, 44) || 'Sem legenda'}
                            </span>
                            <span className="tnum block text-[0.6875rem] text-ink-faint">
                              {new Date(p.published_at).toLocaleString('pt-BR', {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </span>
                        </a>
                      </td>
                      <td className="tnum px-3 py-2.5 text-right text-[0.8125rem]">
                        {num(p.views) ?? '—'}
                      </td>
                      {DELTAS.map(([r, k]) => (
                        <td key={r} className="tnum px-3 py-2.5 text-right text-[0.8125rem]">
                          {p[k] === null ? (
                            <span className="text-ink-faint" title="sem snapshot nessa janela">
                              —
                            </span>
                          ) : (
                            <span className={p[k]! > 0 ? 'font-semibold text-accent' : ''}>
                              {p[k]! > 0 ? '+' : ''}
                              {num(p[k])}
                            </span>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="mt-3 text-[0.75rem] text-ink-faint">
          Um travessão significa que não havia snapshot naquela janela. Nunca interpolamos: um número
          inventado aqui viraria uma decisão de conteúdo errada.
        </p>
      </section>
    </main>
  )
}
