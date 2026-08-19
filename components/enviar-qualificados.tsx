'use client'

import { useState, useTransition } from 'react'
import { Loader2, Send } from 'lucide-react'
import { enviarParaQualificados } from '@/app/(painel)/aquisicao/acoes'

export function BotaoEnviarQualificados({ total }: { total: number }) {
  const [confirmando, setConfirmando] = useState(false)
  const [resultado, setResultado] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const enviar = () =>
    start(async () => {
      setConfirmando(false)
      const r = await enviarParaQualificados()
      setResultado(
        r.ok
          ? `${r.enfileirados} na fila de envio${r.recusados ? ` · ${r.recusados} recusados na revalidação` : ''}`
          : r.erro ?? 'falhou',
      )
    })

  if (resultado) {
    return <p className="text-[0.8125rem] font-medium text-accent">{resultado}</p>
  }

  return confirmando ? (
    <span className="flex items-center gap-2 text-[0.8125rem]">
      Enviar a DM de aquisição para {total} pessoas?
      <button
        onClick={enviar}
        disabled={pendente}
        className="rounded-full bg-accent px-3.5 py-1.5 font-semibold text-void disabled:opacity-50"
      >
        {pendente ? <Loader2 className="size-4 animate-spin" /> : `Enviar para ${total}`}
      </button>
      <button onClick={() => setConfirmando(false)} className="rounded-full border border-line px-3 py-1.5">
        Cancelar
      </button>
    </span>
  ) : (
    <button
      onClick={() => setConfirmando(true)}
      className="inline-flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
    >
      <Send className="size-4" /> Enviar para {total}
    </button>
  )
}
