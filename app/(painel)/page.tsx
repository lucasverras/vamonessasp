import Link from 'next/link'
import { ArrowUpRight, Play } from 'lucide-react'
import { GrowthChart } from '@/components/growth-chart'
import { db } from '@/lib/db'
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
  const [{ conta, kpis, serieDiaria }, top, funil, { data: aquisicaoRaw }] = await Promise.all([
    getOverview(30),
    getTopContent(6),
    getFunnelToday(),
    db().rpc('central_aquisicao_kpis'),
  ])
  const aquisicao = (Array.isArray(aquisicaoRaw) ? aquisicaoRaw[0] : aquisicaoRaw) as
    | Record<string, number>
    | null

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
        <div className="flex flex-wrap items-center gap-2">
          {funil.precisaDeVoce > 0 ? (
            <Link
              href="/aprovacoes"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
            >
              Aguardando sua aprovação: {nf(funil.precisaDeVoce)}
              <ArrowUpRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ) : (
            <Link
              href="/comentarios"
              className="group inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
            >
              Trabalhar comentários
              <ArrowUpRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
          {funil.aprovadasHoje > 0 ? (
            <span className="tnum rounded-full border border-line px-3.5 py-2 text-[0.8125rem] text-ink-faint">
              {nf(funil.aprovadasHoje)} aprovadas hoje
            </span>
          ) : null}
        </div>
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

      {/* DOIS fluxos, DOIS cards (spec Parte 18): AQUISIÇÃO (DM) nunca se
          mistura com COMENTÁRIOS (resposta pública). */}
      <section className="rise mt-6 grid gap-3 sm:grid-cols-2" style={{ animationDelay: '140ms' }}>
        <div className="flex flex-col rounded-card border border-accent/25 bg-accent-wash/30 p-5">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-accent">
            Aquisição
          </p>
          <dl className="tnum mt-2 flex gap-5 text-[0.875rem]">
            <div>
              <dt className="text-[0.625rem] uppercase text-ink-faint">Qualificados</dt>
              <dd className="font-display text-2xl font-semibold">{nf(aquisicao?.qualificados ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-[0.625rem] uppercase text-ink-faint">Enviados</dt>
              <dd className="font-display text-2xl font-semibold">{nf(aquisicao?.enviados ?? 0)}</dd>
            </div>
            <div>
              <dt className="text-[0.625rem] uppercase text-ink-faint">Negados</dt>
              <dd className="font-display text-2xl font-semibold">{nf(aquisicao?.negados ?? 0)}</dd>
            </div>
          </dl>
          <Link
            href="/aquisicao"
            className="group mt-auto inline-flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-accent"
          >
            Abrir aquisição
            <ArrowUpRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>

        <div className="flex flex-col rounded-card border border-line bg-canvas p-5">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-ink-faint">
            Comentários
          </p>
          <p className="mt-2 text-[0.9375rem]">
            <strong className="tnum font-display text-2xl font-semibold">{nf(funil.precisaDeVoce)}</strong>{' '}
            aguardando sua aprovação
          </p>
          <p className="tnum mt-1 text-[0.8125rem] text-ink-faint">
            {nf(funil.aprovadasHoje)} aprovados hoje
          </p>
          <Link
            href="/aprovacoes"
            className="group mt-auto inline-flex items-center gap-2 pt-3 text-[0.8125rem] font-semibold text-ink-soft"
          >
            Revisar comentários
            <ArrowUpRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
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
