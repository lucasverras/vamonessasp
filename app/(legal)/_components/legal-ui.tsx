import Link from 'next/link'

export function Section({
  id,
  n,
  title,
  children,
}: {
  id: string
  n: number
  title: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line-soft pt-8">
      <h2 className="group flex items-baseline gap-3 text-lg font-semibold tracking-[-0.01em] text-ink">
        <span className="font-mono text-[0.7rem] font-normal text-ink-faint tabular-nums">
          {String(n).padStart(2, '0')}
        </span>
        <Link href={`#${id}`} className="hover:text-accent">
          {title}
        </Link>
      </h2>
      <div className="mt-4 space-y-4 text-[0.9375rem] leading-relaxed text-ink-soft">
        {children}
      </div>
    </section>
  )
}

export function P({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return <p className={className}>{children}</p>
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-ink">{children}</strong>
}

export function List({ children }: { children: React.ReactNode }) {
  return (
    <ul className="space-y-2 pl-1">
      {children}
    </ul>
  )
}

export function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:left-0 before:top-[0.6875em] before:size-1 before:rounded-full before:bg-ink-faint">
      {children}
    </li>
  )
}

export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-3 [counter-reset:step]">{children}</ol>
}

export function Step({ children }: { children: React.ReactNode }) {
  return (
    <li className="relative pl-9 [counter-increment:step] before:absolute before:left-0 before:top-0 before:flex before:size-6 before:items-center before:justify-center before:rounded-full before:border before:border-line before:bg-surface before:font-mono before:text-[0.6875rem] before:text-ink-soft before:content-[counter(step)]">
      {children}
    </li>
  )
}

/** Tabela responsiva: vira lista de blocos no mobile. */
export function DataTable({
  columns,
  rows,
}: {
  columns: readonly string[]
  rows: readonly (readonly React.ReactNode[])[]
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line bg-line-soft/40">
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-line-soft last:border-0 align-top">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={
                      j === 0
                        ? 'px-4 py-3 font-medium text-ink'
                        : 'px-4 py-3 text-ink-soft'
                    }
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-line-soft sm:hidden">
        {rows.map((row, i) => (
          <div key={i} className="space-y-2 p-4">
            <p className="font-medium text-ink">{row[0]}</p>
            {row.slice(1).map((cell, j) => (
              <p key={j} className="text-sm text-ink-soft">
                <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                  {columns[j + 1]}
                </span>
                <br />
                {cell}
              </p>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'warn'
  title?: string
  children: React.ReactNode
}) {
  const styles =
    tone === 'warn'
      ? 'border-warn-line bg-warn-soft text-warn'
      : 'border-line bg-surface text-ink-soft'
  return (
    <div className={`rounded-lg border px-4 py-3.5 text-sm leading-relaxed ${styles}`}>
      {title ? <p className="mb-1 font-medium text-ink">{title}</p> : null}
      {children}
    </div>
  )
}

export function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded border border-line bg-line-soft/60 px-1.5 py-0.5 font-mono text-[0.8125em] text-ink">
      {children}
    </code>
  )
}

export function MailLink({ address }: { address: string }) {
  return (
    <a
      href={`mailto:${address}`}
      className="font-medium text-accent underline decoration-accent/35 underline-offset-2 transition-colors hover:decoration-accent"
    >
      {address}
    </a>
  )
}
