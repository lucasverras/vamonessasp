'use client'

import { useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, Share2 } from 'lucide-react'

/**
 * O PDF é PREPARADO ao abrir a tela (fetch em segundo plano). Motivo: o iPhone
 * só aceita navigator.share() dentro do toque — se esperássemos o servidor
 * gerar o arquivo (~9 s) depois do clique, o Safari descartava o gesto, o
 * share falhava e caía no preview do PDF, sem opção de enviar. Com o arquivo
 * já em memória, Compartilhar abre a folha do iOS com o PDF anexado
 * (WhatsApp etc.) e Baixar salva em Arquivos — nenhum dos dois abre preview.
 */
export function BotoesPdf({ id, nome, grande = false }: { id: string; nome: string; grande?: boolean }) {
  const url = `/api/media-kit/${id}/pdf`
  const arquivoNome = `${nome}.pdf`
  const [file, setFile] = useState<File | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [podeCompartilhar, setPodeCompartilhar] = useState(false)
  const [tentativa, setTentativa] = useState(0)

  // Busca o PDF em segundo plano; o estado só muda nos callbacks da resposta.
  useEffect(() => {
    let vivo = true
    fetch(url, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`servidor respondeu ${r.status}`)
        const f = new File([await r.blob()], arquivoNome, { type: 'application/pdf' })
        if (!vivo) return
        setFile(f)
        setPodeCompartilhar(
          typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }),
        )
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : 'falha ao gerar')
      })
    return () => {
      vivo = false
    }
  }, [url, arquivoNome, tentativa])

  function baixar() {
    if (!file) return
    const u = URL.createObjectURL(file)
    const a = document.createElement('a')
    a.href = u
    a.download = arquivoNome
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(u), 60_000)
  }

  function compartilhar() {
    if (!file) return
    // Sem await antes: precisa acontecer dentro do gesto do usuário.
    navigator.share({ files: [file], title: nome }).catch(() => {
      /* cancelado pelo usuário — nada a fazer */
    })
  }

  const base = grande
    ? 'inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-4 text-base font-semibold disabled:opacity-60'
    : 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60'

  if (erro) {
    return (
      <div className={grande ? 'flex flex-col gap-3' : 'flex items-center gap-2'}>
        <span className="text-sm text-red-400">Não consegui gerar o PDF ({erro}).</span>
        <button type="button" onClick={() => { setErro(null); setFile(null); setTentativa((t) => t + 1) }} className={`${base} bg-white text-[#01082D]`}>
          <RefreshCw className="size-4" /> Tentar de novo
        </button>
      </div>
    )
  }

  const preparando = !file
  return (
    <div className={grande ? 'flex flex-col gap-3' : 'flex gap-2'}>
      {podeCompartilhar ? (
        <button type="button" onClick={compartilhar} disabled={preparando} className={`${base} bg-[#266CA9] text-white`}>
          {preparando ? <Loader2 className="size-4 animate-spin" /> : <Share2 className="size-4" />}
          {preparando ? 'Preparando PDF…' : 'Compartilhar'}
        </button>
      ) : null}
      <button type="button" onClick={baixar} disabled={preparando} className={`${base} ${podeCompartilhar ? 'bg-white text-[#01082D]' : 'bg-[#266CA9] text-white'}`}>
        {preparando && !podeCompartilhar ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {preparando ? (podeCompartilhar ? 'Baixar PDF' : 'Preparando PDF…') : 'Baixar PDF'}
      </button>
      {preparando ? (
        <span className={grande ? 'text-center text-[0.8125rem] text-ink-faint' : 'sr-only'}>
          gerando no servidor (~10 s)
        </span>
      ) : null}
    </div>
  )
}
