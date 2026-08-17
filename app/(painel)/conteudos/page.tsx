import { getTopContent } from '@/lib/analytics/overview'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Conteúdos' }

const compacto = (n: number | null) => {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString('pt-BR')
}

const segundos = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`)

export default async function Conteudos() {
  const itens = await getTopContent(200)

  const colunas = [
    { chave: 'views', rotulo: 'Views' },
    { chave: 'reach', rotulo: 'Alcance' },
    { chave: 'shares', rotulo: 'Shares' },
    { chave: 'reposts', rotulo: 'Reposts' },
    { chave: 'saved', rotulo: 'Salvos' },
    { chave: 'comments', rotulo: 'Coment.' },
    { chave: 'likes', rotulo: 'Curtidas' },
  ] as const

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Conteúdos
        </h1>
        <p className="mt-1 text-sm text-ink-faint">
          {itens.length} publicações · ordenadas por views
        </p>
      </header>

      {/* Desktop: tabela densa. Mobile: cada linha vira cartão — a mesma
          informação, sem rolagem horizontal em tela pequena. */}
      <div className="rise mt-7 overflow-hidden rounded-card border border-line" style={{ animationDelay: '60ms' }}>
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-canvas">
                <th className="px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Conteúdo
                </th>
                <th className="px-3 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  Data
                </th>
                {colunas.map((c) => (
                  <th
                    key={c.chave}
                    className="px-3 py-2.5 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint"
                  >
                    {c.rotulo}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                  T. médio
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-line-soft bg-void/40 transition-colors last:border-0 hover:bg-canvas"
                >
                  <td className="max-w-[340px] px-4 py-2.5">
                    <a
                      href={m.permalink ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3"
                    >
                      {m.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={m.thumbnail_url}
                          alt=""
                          className="size-9 shrink-0 rounded-md object-cover"
                        />
                      ) : (
                        <div className="size-9 shrink-0 rounded-md bg-surface" />
                      )}
                      <span className="truncate text-[0.8125rem] text-ink-soft hover:text-ink">
                        {m.caption?.replace(/\s+/g, ' ').trim() || 'Sem legenda'}
                      </span>
                    </a>
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2.5 text-[0.75rem] text-ink-faint">
                    {new Date(m.published_at).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      year: '2-digit',
                    })}
                  </td>
                  {colunas.map((c) => (
                    <td
                      key={c.chave}
                      className="tnum px-3 py-2.5 text-right text-[0.8125rem] tabular-nums"
                    >
                      {compacto(m[c.chave])}
                    </td>
                  ))}
                  <td className="tnum px-3 py-2.5 text-right text-[0.8125rem] text-ink-faint">
                    {segundos(m.avg_watch_time_ms)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className="divide-y divide-line-soft lg:hidden">
          {itens.map((m) => (
            <li key={m.id} className="bg-void/40 p-4">
              <a href={m.permalink ?? '#'} target="_blank" rel="noreferrer" className="flex gap-3">
                {m.thumbnail_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.thumbnail_url}
                    alt=""
                    className="size-12 shrink-0 rounded-lg object-cover"
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[0.8125rem] leading-snug text-ink-soft">
                    {m.caption?.replace(/\s+/g, ' ').trim() || 'Sem legenda'}
                  </p>
                  <p className="tnum mt-1 text-[0.6875rem] text-ink-faint">
                    {new Date(m.published_at).toLocaleDateString('pt-BR')}
                  </p>
                </div>
              </a>
              <dl className="tnum mt-3 grid grid-cols-4 gap-2 text-center">
                {colunas.slice(0, 4).map((c) => (
                  <div key={c.chave} className="rounded-lg bg-canvas py-2">
                    <dt className="text-[0.625rem] uppercase tracking-wider text-ink-faint">
                      {c.rotulo}
                    </dt>
                    <dd className="mt-0.5 text-[0.8125rem] font-semibold">{compacto(m[c.chave])}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </main>
  )
}
