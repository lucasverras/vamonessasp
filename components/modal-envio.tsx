'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, Lock, X } from 'lucide-react'
import { enviarSelecao, type RespostaEnvio } from '@/app/(painel)/comentarios/acoes'

const MENSAGEM_PADRAO = `Valeu por comentar no nosso vídeo! 👀

Somos o Vamo Nessa e sempre mostramos restaurantes, rolês e lugares diferentes por SP.

Segue a gente pra não perder os próximos!`

export function ModalEnvio({
  ids,
  killSwitch,
  aoFechar,
}: {
  ids: string[]
  killSwitch: boolean
  aoFechar: (enviou: boolean) => void
}) {
  const [mensagem, setMensagem] = useState(MENSAGEM_PADRAO)
  const [nome, setNome] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [resposta, setResposta] = useState<RespostaEnvio | null>(null)
  const dialog = useRef<HTMLDivElement>(null)

  // Esc fecha, e o foco entra no diálogo — teclado precisa funcionar numa ação
  // desta gravidade.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !enviando) aoFechar(false)
    }
    document.addEventListener('keydown', onKey)
    dialog.current?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [aoFechar, enviando])

  async function submeter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setEnviando(true)
    const fd = new FormData()
    fd.set('mensagem', mensagem)
    fd.set('nome', nome)
    fd.set('ids', ids.join(','))
    setResposta(await enviarSelecao(fd))
    setEnviando(false)
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-void/70 p-0 backdrop-blur-sm sm:place-items-center sm:p-6">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label="Envio de mensagem"
        tabIndex={-1}
        className="w-full max-w-lg rounded-t-2xl border border-line bg-canvas p-5 shadow-[0_24px_64px_-16px_rgb(0_0_0/0.8)] outline-none sm:rounded-2xl"
      >
        {resposta?.ok ? (
          <>
            <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">
              Campanha criada
            </h2>
            <dl className="mt-4 space-y-2 text-[0.875rem]">
              <div className="flex justify-between">
                <dt className="text-ink-faint">Na fila</dt>
                <dd className="tnum font-semibold">{resposta.enfileirados}</dd>
              </div>
              {resposta.dedupePorPessoa ? (
                <div className="flex justify-between">
                  <dt className="text-ink-faint">Removidos por repetir a mesma pessoa</dt>
                  <dd className="tnum">{resposta.dedupePorPessoa}</dd>
                </div>
              ) : null}
              {resposta.recusados ? (
                <div className="flex justify-between">
                  <dt className="text-ink-faint">Recusados na revalidação</dt>
                  <dd className="tnum">{resposta.recusados}</dd>
                </div>
              ) : null}
            </dl>
            {killSwitch ? (
              <p className="mt-4 flex gap-2 rounded-lg border border-warn/40 bg-warn-wash px-3 py-2.5 text-[0.8125rem] leading-relaxed text-warn">
                <Lock className="mt-0.5 size-4 shrink-0" />
                <span>
                  A fila está montada, mas o <strong>kill switch está ligado</strong> — nada será
                  enviado até você desligá-lo em Configurações.
                </span>
              </p>
            ) : null}
            <button
              onClick={() => aoFechar(true)}
              className="mt-5 w-full rounded-lg bg-accent px-4 py-2.5 text-[0.875rem] font-semibold text-void"
            >
              Fechar
            </button>
          </>
        ) : (
          <form onSubmit={submeter}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">
                  Enviar mensagem
                </h2>
                <p className="tnum mt-1 text-[0.875rem] text-ink-soft">
                  {ids.length} {ids.length === 1 ? 'pessoa selecionada' : 'pessoas selecionadas'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => aoFechar(false)}
                aria-label="Fechar"
                className="-m-1 rounded-lg p-1 text-ink-faint transition-colors hover:text-ink"
              >
                <X className="size-4" />
              </button>
            </div>

            <label className="mt-5 block">
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                Nome da campanha
              </span>
              <input
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Follow V1"
                className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-[0.875rem] placeholder:text-ink-faint focus:border-accent focus:outline-none"
              />
            </label>

            <label className="mt-4 block">
              <span className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
                Mensagem
              </span>
              <textarea
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                rows={7}
                required
                minLength={10}
                className="mt-1.5 w-full resize-y rounded-lg border border-line bg-surface px-3 py-2.5 text-[0.875rem] leading-relaxed focus:border-accent focus:outline-none"
              />
            </label>
            <p className="tnum mt-1 text-right text-[0.6875rem] text-ink-faint">
              {mensagem.length} caracteres
            </p>

            <p className="mt-3 flex gap-2 rounded-lg border border-line bg-surface/60 px-3 py-2.5 text-[0.75rem] leading-relaxed text-ink-faint">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              <span>
                Cada pessoa recebe <strong className="text-ink-soft">uma única</strong> mensagem,
                para sempre. O texto é congelado na campanha e cada envio é revalidado no momento
                de sair.
              </span>
            </p>

            {resposta?.erro ? (
              <p className="mt-3 rounded-lg border border-danger/40 bg-danger-wash px-3 py-2 text-[0.8125rem] text-danger">
                {resposta.erro}
              </p>
            ) : null}

            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => aoFechar(false)}
                disabled={enviando}
                className="flex-1 rounded-lg border border-line px-4 py-2.5 text-[0.875rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={enviando || mensagem.trim().length < 10}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[0.875rem] font-semibold text-void transition-opacity disabled:opacity-40"
              >
                {enviando ? <Loader2 className="size-4 animate-spin" /> : null}
                {enviando ? 'Criando fila…' : `Enviar para ${ids.length}`}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
