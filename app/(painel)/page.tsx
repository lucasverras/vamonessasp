import Link from 'next/link'
import { ArrowUpRight, Play } from 'lucide-react'
import { GrowthChart } from '@/components/growth-chart'
import { getFunnelToday, getOverview, getTopContent } from '@/lib/analytics/overview'

export const dynamic = 'force-dynamic'

const nf = (n: number | null | undefined, casas = 0) =>
  n === null || n === undefined
    ? '—'
    : n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })

function compacto(n: number | null) {
  if (n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return n.toLocaleString('pt-BR')
}

export default async function VisaoGeral() {
  const [{ conta, kpis, serieDiaria }, top, funil] = await Promise.all([
    getOverview(30),
    getTopContent(6),
    getFunnelToday(),
  ])

  const [seguidores, novos, ...resto] = kpis

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            Visão geral
          </h1>
          <p className="mt-1 text-sm text-ink-faint">Últimos 30 dias · @{conta?.username}</p>
        </div>
        <Link
          href="/comentarios"
          className="group inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
        >
          {funil.elegiveis > 0
            ? `${nf(funil.elegiveis)} pessoas esperando mensagem`
            : 'Trabalhar comentários'}
          <ArrowUpRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
        </Link>
      </header>

      {/* Os dois números que definem o produto ganham o dobro de peso visual;
          o resto é contexto e vive numa faixa menor. */}
      <section className="rise mt-8 grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-2" style={{ animationDelay: '60ms' }}>
        {[seguidores, novos].map((k) => (
          <div key={k!.label} className="bg-canvas p-6">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
              {k!.label}
            </p>
            <p className="tnum mt-2 font-display text-[2.75rem] font-semibold leading-none tracking-[-0.04em]">
              {k!.value === null ? '—' : nf(k!.value)}
            </p>
            {k!.delta !== null && k!.delta !== undefined ? (
              <p className="tnum mt-2 text-[0.8125rem] font-medium text-accent">
                {k!.delta >= 0 ? '+' : ''}
                {nf(k!.delta)}
                <span className="ml-1.5 font-normal text-ink-faint">
                  {k!.label === 'Seguidores' ? 'no período medido' : 'vs. 30 dias anteriores'}
                </span>
              </p>
            ) : k!.hint ? (
              <p className="mt-2 text-[0.8125rem] text-ink-faint">{k!.hint}</p>
            ) : null}
          </div>
        ))}
      </section>

      <section
        className="rise mt-px grid gap-px overflow-hidden rounded-card border border-line bg-line grid-cols-2 lg:grid-cols-6"
        style={{ animationDelay: '110ms' }}
      >
        {resto.map((k) => (
          <div key={k.label} className="bg-canvas px-5 py-4">
            <p className="truncate text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {k.label}
            </p>
            <p className="tnum mt-1.5 font-display text-xl font-semibold tracking-[-0.02em]">
              {k.value === null ? '—' : compacto(k.value)}
              {k.suffix ? (
                <span className="ml-0.5 text-[0.75rem] font-normal text-ink-faint">{k.suffix}</span>
              ) : null}
            </p>
          </div>
        ))}
      </section>

      <section className="rise mt-10" style={{ animationDelay: '160ms' }}>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
            Novos seguidores por dia
          </h2>
          <span className="text-[0.75rem] text-ink-faint">bruto, sem descontar unfollows</span>
        </div>
        <GrowthChart dados={serieDiaria} />
      </section>

      <section className="rise mt-11" style={{ animationDelay: '210ms' }}>
        <div className="mb-4 flex items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
            Conteúdos que mais renderam
          </h2>
          <Link
            href="/conteudos"
            className="text-[0.8125rem] font-medium text-ink-faint transition-colors hover:text-accent"
          >
            ver todos
          </Link>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {top.map((m) => (
            <li key={m.id}>
              <a
                href={m.permalink ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="group flex h-full gap-3.5 rounded-card border border-line bg-canvas p-3 transition-colors hover:border-ink-faint"
              >
                <div className="relative size-[68px] shrink-0 overflow-hidden rounded-lg bg-surface">
                  {m.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.thumbnail_url} alt="" className="size-full object-cover" />
                  ) : null}
                  <Play className="absolute bottom-1 left-1 size-3 fill-ink text-ink drop-shadow" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <p className="line-clamp-2 text-[0.8125rem] leading-snug text-ink-soft transition-colors group-hover:text-ink">
                    {m.caption?.replace(/\s+/g, ' ').trim() || 'Sem legenda'}
                  </p>
                  <dl className="tnum mt-auto flex gap-3.5 pt-2 text-[0.75rem]">
                    <div>
                      <dt className="sr-only">Views</dt>
                      <dd className="font-semibold">{compacto(m.views)}</dd>
                    </div>
                    <div className="text-ink-faint">
                      <dt className="sr-only">Compartilhamentos</dt>
                      <dd>{compacto(m.shares)} shares</dd>
                    </div>
                    <div className="text-ink-faint">
                      <dt className="sr-only">Comentários</dt>
                      <dd>{compacto(m.comments)} com.</dd>
                    </div>
                  </dl>
                </div>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
