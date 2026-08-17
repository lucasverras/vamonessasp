'use client'

import { useMemo, useState } from 'react'
import { Ban, Check, Clock, Lock, Send, X } from 'lucide-react'
import { ModalEnvio } from './modal-envio'
import type { ComentarioLinha } from '@/lib/analytics/comentarios'

const ESTADO = {
  ELIGIBLE: { texto: 'Elegível', classe: 'text-accent bg-accent-wash', Icone: Check },
  SENT: { texto: 'Enviado', classe: 'text-ink-soft bg-surface', Icone: Send },
  FAILED: { texto: 'Falhou', classe: 'text-danger bg-danger-wash', Icone: X },
  EXPIRED: { texto: 'Expirado', classe: 'text-ink-faint bg-surface', Icone: Clock },
  NOT_ELIGIBLE: { texto: 'Inelegível', classe: 'text-ink-faint bg-surface', Icone: Ban },
} as const

export function ComentariosTabela({
  linhas,
  killSwitch,
}: {
  linhas: ComentarioLinha[]
  killSwitch: boolean
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [modalAberto, setModalAberto] = useState(false)

  // Uma pessoa recebe UMA mensagem, mesmo tendo comentado várias vezes — então
  // a contagem que importa é de pessoas, não de linhas selecionadas.
  const selecionaveis = useMemo(
    () => linhas.filter((l) => l.eligibility_status === 'ELIGIBLE' && !l.blacklist),
    [linhas],
  )

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })

  const todosMarcados = selecionaveis.length > 0 && marcados.size === selecionaveis.length

  return (
    <>
      {modalAberto ? (
        <ModalEnvio
          ids={[...marcados]}
          killSwitch={killSwitch}
          aoFechar={(enviou) => {
            setModalAberto(false)
            if (enviou) {
              setMarcados(new Set())
              // Recarrega para refletir os novos estados vindos do servidor.
              window.location.reload()
            }
          }}
        />
      ) : null}

      {selecionaveis.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() =>
              setMarcados(todosMarcados ? new Set() : new Set(selecionaveis.map((l) => l.id)))
            }
            className="rounded-lg border border-line px-3 py-1.5 text-[0.8125rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
          >
            {todosMarcados ? 'Limpar seleção' : `Selecionar todos elegíveis (${selecionaveis.length})`}
          </button>

          {marcados.size > 0 ? (
            <>
              <span className="tnum text-[0.8125rem] text-ink-soft">
                <strong className="font-semibold text-ink">{marcados.size}</strong> selecionados
              </span>
              <button
                onClick={() => setModalAberto(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-accent px-3.5 py-1.5 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
              >
                <Send className="size-3.5" />
                Enviar mensagem
              </button>
              {killSwitch ? (
                <span className="inline-flex items-center gap-1.5 text-[0.75rem] text-warn">
                  <Lock className="size-3.5" />
                  kill switch ligado — a fila é montada, nada sai
                </span>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-card border border-line">
        <ul className="divide-y divide-line-soft">
          {linhas.map((l) => {
            const e = ESTADO[l.eligibility_status as keyof typeof ESTADO] ?? ESTADO.NOT_ELIGIBLE
            const podeMarcar = l.eligibility_status === 'ELIGIBLE' && !l.blacklist
            return (
              <li
                key={l.id}
                className={`flex gap-3 bg-void/40 px-3 py-3 transition-colors sm:px-4 ${
                  marcados.has(l.id) ? 'bg-accent-wash/25' : 'hover:bg-canvas'
                }`}
              >
                <label className="flex shrink-0 items-start pt-0.5">
                  <span className="sr-only">Selecionar comentário de {l.username}</span>
                  <input
                    type="checkbox"
                    disabled={!podeMarcar}
                    checked={marcados.has(l.id)}
                    onChange={() => alternar(l.id)}
                    className="size-4 accent-[var(--color-accent)] disabled:opacity-25"
                  />
                </label>

                {l.thumbnail ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={l.thumbnail}
                    alt=""
                    className="hidden size-9 shrink-0 rounded-md object-cover sm:block"
                  />
                ) : null}

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[0.8125rem] font-semibold">@{l.username ?? '—'}</span>
                    <span className="text-[0.75rem] text-ink-faint">{l.faz}</span>
                    {l.blacklist ? (
                      <span className="rounded bg-danger-wash px-1.5 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-danger">
                        blacklist
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[0.875rem] leading-snug text-ink-soft">{l.text}</p>
                  {l.permalink ? (
                    <a
                      href={l.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 block truncate text-[0.75rem] text-ink-faint transition-colors hover:text-accent"
                    >
                      {l.conteudo?.replace(/\s+/g, ' ').slice(0, 58) || 'ver conteúdo'}
                    </a>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${e.classe}`}
                  >
                    <e.Icone className="size-3" />
                    {e.texto}
                  </span>
                  {l.restam && l.eligibility_status === 'ELIGIBLE' ? (
                    <span className="tnum text-[0.6875rem] text-ink-faint">restam {l.restam}</span>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>

        {linhas.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-ink-faint">
            Nenhum comentário neste filtro.
          </p>
        ) : null}
      </div>
    </>
  )
}
