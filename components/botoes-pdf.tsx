'use client'

import { useState } from 'react'
import { Download, Share2 } from 'lucide-react'

/**
 * Baixar = PDF pronto do servidor (sem depender da impressão do navegador).
 * Compartilhar = no celular, manda o arquivo direto (WhatsApp etc.) via Web
 * Share; onde não há suporte, o botão nem aparece.
 */
export function BotoesPdf({ id, nome, grande = false }: { id: string; nome: string; grande?: boolean }) {
  const [ocupado, setOcupado] = useState<'baixar' | 'compartilhar' | null>(null)
  const url = `/api/media-kit/${id}/pdf`
  const podeCompartilhar =
    typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([''], 'x.pdf', { type: 'application/pdf' })] })

  async function compartilhar() {
    setOcupado('compartilhar')
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error('falha ao gerar')
      const file = new File([await r.blob()], `${nome}.pdf`, { type: 'application/pdf' })
      await navigator.share({ files: [file], title: nome })
    } catch {
      // cancelado ou sem suporte: cai no download normal
      window.location.href = url
    } finally {
      setOcupado(null)
    }
  }

  const base = grande
    ? 'inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-base font-semibold disabled:opacity-60'
    : 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'
  return (
    <div className={grande ? 'flex flex-col gap-3' : 'flex gap-2'}>
      <a href={url} className={`${base} bg-[#266CA9] text-white`} onClick={() => setOcupado('baixar')}>
        <Download className="size-4" /> {ocupado === 'baixar' ? 'Gerando…' : 'Baixar PDF'}
      </a>
      {podeCompartilhar ? (
        <button type="button" onClick={compartilhar} disabled={ocupado !== null} className={`${base} bg-white text-[#01082D]`}>
          <Share2 className="size-4" /> {ocupado === 'compartilhar' ? 'Gerando…' : 'Compartilhar'}
        </button>
      ) : null}
    </div>
  )
}
