import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BotoesPdf } from '@/components/botoes-pdf'
import { fmtBRL, fmtData, getGerado, nomeArquivoKit } from '@/lib/analytics/media-kit'

export const dynamic = 'force-dynamic'

/**
 * Destino após "Gerar": só o arquivo. Sem visualização (no celular ela
 * induzia ao "Imprimir/Salvar PDF" do navegador, que recorta em A4). O PDF é
 * sempre o mesmo — renderizado no servidor, 1080×1920, 8 páginas.
 */
export default async function MediaKitPronto({ params }: { params: Promise<{ id: string }> }) {
  const g = await getGerado((await params).id)
  if (!g) notFound()
  const nome = nomeArquivoKit(g.rotulo)
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-10">
      <div>
        <p className="text-[0.6875rem] uppercase tracking-[0.14em] text-ink-faint">Media kit pronto</p>
        <h1 className="mt-1 font-display text-[1.75rem] font-semibold tracking-[-0.03em]">{g.rotulo}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {g.cliente ? `${g.cliente} · ` : ''}{fmtBRL(g.valor)} · gerado {fmtData(g.created_at)} · 8 páginas
        </p>
      </div>
      <BotoesPdf id={g.id} nome={nome} grande />
      <p className="text-[0.8125rem] leading-relaxed text-ink-faint">
        O arquivo é gerado no servidor, sempre igual — no celular ou no computador. Não use o
        &ldquo;Imprimir / Salvar PDF&rdquo; do navegador: ele recorta a página em A4.
      </p>
      <div className="flex gap-4 text-sm">
        <Link href={`/media-kit/${g.id}`} className="text-ink-soft underline">visualizar páginas</Link>
        <Link href="/media-kit" className="text-ink-soft underline">voltar</Link>
      </div>
    </main>
  )
}
