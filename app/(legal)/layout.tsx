import type { Metadata } from 'next'
import Link from 'next/link'
import { LEGAL, LEGAL_ROUTES, pendingLegalFields } from '@/lib/legal'

export const metadata: Metadata = {
  // As páginas legais são públicas por exigência da Meta (App Review) e da LGPD.
  robots: { index: true, follow: true },
}

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  const pending = pendingLegalFields()

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-5">
          <Link href="/privacy" className="flex items-center gap-2.5 shrink-0">
            <span
              aria-hidden
              className="grid size-6 place-items-center rounded-md bg-ink text-[0.625rem] font-bold text-canvas"
            >
              VN
            </span>
            <span className="text-sm font-medium tracking-[-0.01em]">{LEGAL.brand}</span>
          </Link>
          <nav className="-mr-1 flex items-center gap-0.5 overflow-x-auto">
            {LEGAL_ROUTES.map((route) => (
              <Link
                key={route.href}
                href={route.href}
                className="whitespace-nowrap rounded-md px-2.5 py-1.5 text-[0.8125rem] text-ink-soft transition-colors hover:bg-line-soft hover:text-ink"
              >
                {route.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {pending.length > 0 ? (
        <div className="border-b border-warn-line bg-warn-soft">
          <p className="mx-auto max-w-3xl px-5 py-2.5 text-[0.8125rem] leading-relaxed text-warn">
            <span className="font-medium">Documento incompleto.</span> {pending.length}{' '}
            {pending.length === 1 ? 'campo obrigatório' : 'campos obrigatórios'} ainda não
            {pending.length === 1 ? ' foi' : ' foram'} preenchido
            {pending.length === 1 ? '' : 's'} em <code className="font-mono">lib/legal.ts</code>:{' '}
            {pending.join(', ')}. Preencha antes de submeter o app à revisão da Meta.
          </p>
        </div>
      ) : null}

      <main className="mx-auto max-w-3xl px-5 py-12 sm:py-16">{children}</main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-3xl flex-col gap-3 px-5 py-8 text-[0.8125rem] text-ink-faint sm:flex-row sm:items-center sm:justify-between">
          <p>
            {LEGAL.appName} — ferramenta interna de {LEGAL.instagramHandle}.
          </p>
          <p>
            Atualizado em{' '}
            <time dateTime={LEGAL.lastUpdatedISO}>{LEGAL.lastUpdatedLabel}</time>
          </p>
        </div>
      </footer>
    </div>
  )
}
