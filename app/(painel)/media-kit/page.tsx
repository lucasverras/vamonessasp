import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import { fmtBRL, fmtData, fmtInt, getManual, listarGerados, rotuloMes } from '@/lib/analytics/media-kit'
import { db } from '@/lib/db'
import { gerarAction } from './acoes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Media Kit' }

const input =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'block text-[0.6875rem] uppercase tracking-wider text-ink-faint mb-1'

/** Só Cliente + Valor (pedido de 20/08). Números e cases vêm sozinhos na geração. */
export default async function MediaKitPage() {
  const [manual, gerados, { data: conta }] = await Promise.all([
    getManual(),
    listarGerados(),
    db().from('instagram_accounts').select('followers_count,last_sync_at').limit(1).maybeSingle(),
  ])
  const agora = new Date().toISOString()

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 sm:px-8 lg:py-11">
      <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">Media Kit</h1>
      <p className="mt-1 text-sm text-ink-soft">
        {rotuloMes(agora)} · {fmtInt(conta?.followers_count)} seguidores em {fmtData(conta?.last_sync_at)}.
        Os números entram sozinhos na hora de gerar; cada versão fica congelada.
      </p>

      <section className="mt-6 rounded-card border border-accent/40 bg-canvas p-5">
        <form action={gerarAction} className="grid gap-4 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <div>
            <label className={label} htmlFor="cliente">Cliente (opcional)</label>
            <input id="cliente" name="cliente" className={input} placeholder="Ex.: Rei do Macarrão" />
          </div>
          <div>
            <label className={label} htmlFor="valor">Valor (R$)</label>
            <input id="valor" name="valor" className={input} inputMode="decimal" defaultValue={manual.valor_padrao !== null ? manual.valor_padrao.toFixed(2).replace('.', ',') : '600,00'} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
          >
            <FileText className="size-4" /> Gerar
          </button>
        </form>
        <p className="mt-3 text-[0.8125rem] text-ink-faint">
          Abre a versão pronta; lá, <strong>Salvar PDF</strong>.
        </p>
      </section>

      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">Gerados</h2>
        {gerados.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Nenhum ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {gerados.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="font-medium">{g.rotulo}</span>
                <span className="text-ink-soft">{g.cliente ?? 'sem cliente'}</span>
                <span className="tnum text-ink-soft">{fmtBRL(g.valor)}</span>
                <span className="text-[0.75rem] text-ink-faint">{fmtData(g.created_at)}</span>
                <Link href={`/media-kit/${g.id}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
                  abrir <ExternalLink className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
