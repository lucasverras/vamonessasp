import Link from 'next/link'
import { LEGAL, LEGAL_ROUTES } from '@/lib/legal'

// Placeholder: será substituído pela Visão Geral do painel na Fase 2.
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-5 py-16">
      <div>
        <span
          aria-hidden
          className="grid size-8 place-items-center rounded-lg bg-ink text-[0.75rem] font-bold text-canvas"
        >
          VN
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-[-0.02em] text-ink">
          {LEGAL.appName}
        </h1>
        <p className="mt-2 max-w-prose text-[0.9375rem] leading-relaxed text-ink-soft">
          Ferramenta interna de análise de crescimento e relacionamento da conta{' '}
          {LEGAL.instagramHandle}. O acesso é restrito a operadores autorizados.
        </p>
      </div>
      <nav className="flex flex-wrap gap-2">
        {LEGAL_ROUTES.map((route) => (
          <Link
            key={route.href}
            href={route.href}
            className="rounded-lg border border-line px-3.5 py-2 text-[0.8125rem] text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
          >
            {route.label}
          </Link>
        ))}
      </nav>
    </main>
  )
}
