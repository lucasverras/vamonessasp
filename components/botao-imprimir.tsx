'use client'

import { Printer } from 'lucide-react'

/** Salvar PDF = impressão do navegador; as páginas já têm o tamanho certo. */
export function BotaoImprimir() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-lg bg-[#FF4D1C] px-4 py-2 text-sm font-semibold text-white"
    >
      <Printer className="size-4" /> Salvar PDF
    </button>
  )
}
