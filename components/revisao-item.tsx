'use client'

import { useState, useTransition } from 'react'
import { Ban, Check, Loader2, Pencil, X } from 'lucide-react'
import { aprovar, bloquearPessoa, rejeitar } from '@/app/(painel)/revisao/acoes'

/**
 * Aprovação de uma sugestão. Editar o texto é primeira classe, não exceção: a
 * distância entre o que a IA escreveu e o que você aprovou é o dado que decide
 * quando a automação pode ser liberada.
 */
export function AcaoRevisao({
  acaoId,
  tipo,
  textoGerado,
  status,
  editado,
}: {
  acaoId: string
  tipo: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'
  textoGerado: string
  status: string
  editado: boolean
}) {
  const [texto, setTexto] = useState(textoGerado)
  const [editando, setEditando] = useState(false)
  const [pendente, iniciar] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)

  const rotulo = tipo === 'PRIVATE_REPLY' ? 'mensagem privada' : 'resposta pública'
  const decidido = status !== 'SHADOW' && status !== 'PENDING_APPROVAL'

  function agir(fn: () => Promise<{ ok: boolean; erro?: string; motivo?: string }>) {
    setErro(null)
    iniciar(async () => {
      const r = await fn()
      if (!r.ok) setErro(r.erro ?? `recusado: ${r.motivo}`)
      else setFeito('ok')
    })
  }

  if (feito || decidido) {
    return (
      <p className="text-[0.75rem] text-ink-faint">
        {feito ? 'decisão registrada' : `estado: ${status}`}
        {editado ? ' · texto editado' : ''}
      </p>
    )
  }

  return (
    <div>
      {editando ? (
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={tipo === 'PRIVATE_REPLY' ? 5 : 2}
          className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-[0.875rem] leading-relaxed focus:border-accent focus:outline-none"
        />
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={() => agir(() => aprovar(acaoId, texto))}
          disabled={pendente}
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-2.5 py-1.5 text-[0.75rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-50"
        >
          {pendente ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
          Aprovar {rotulo}
        </button>
        <button
          onClick={() => setEditando((v) => !v)}
          disabled={pendente}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
        >
          <Pencil className="size-3" />
          {editando ? 'Fechar edição' : 'Editar'}
        </button>
        <button
          onClick={() => agir(() => rejeitar(acaoId, 'rejeitado na revisão'))}
          disabled={pendente}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-faint transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
        >
          <X className="size-3" />
          Rejeitar
        </button>
        {tipo === 'PRIVATE_REPLY' ? (
          <button
            onClick={() => agir(() => bloquearPessoa(acaoId, 'bloqueado na revisão'))}
            disabled={pendente}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[0.75rem] font-medium text-ink-faint transition-colors hover:border-danger/50 hover:text-danger disabled:opacity-50"
            title="Nunca mais contatar esta pessoa"
          >
            <Ban className="size-3" />
            Bloquear pessoa
          </button>
        ) : null}
      </div>

      {erro ? <p className="mt-1.5 text-[0.75rem] text-danger">{erro}</p> : null}
    </div>
  )
}

export function IntencaoAutomatica({
  intencao,
  rotulo,
  ligada,
  proibida,
  acertos,
  total,
}: {
  intencao: string
  rotulo: string
  ligada: boolean
  proibida: boolean
  acertos: number
  total: number
}) {
  const [pendente, iniciar] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const taxa = total > 0 ? Math.round((acertos / total) * 100) : null

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        proibida ? 'border-line-soft bg-surface/40' : 'border-line bg-canvas'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[0.8125rem] font-medium">{rotulo}</span>
        {proibida ? (
          <span className="shrink-0 text-[0.6875rem] text-ink-faint">nunca automático</span>
        ) : (
          <button
            onClick={() => {
              setErro(null)
              iniciar(async () => {
                const r = await import('@/app/(painel)/revisao/acoes').then((m) =>
                  m.alternarIntencaoAutomatica(intencao, !ligada),
                )
                if (!r.ok) setErro(r.erro ?? 'falhou')
              })
            }}
            disabled={pendente}
            className={`shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold transition-colors disabled:opacity-50 ${
              ligada ? 'bg-accent text-void' : 'border border-line text-ink-faint hover:text-ink'
            }`}
          >
            {ligada ? 'automático' : 'manual'}
          </button>
        )}
      </div>
      <p className="tnum mt-1 text-[0.6875rem] text-ink-faint">
        {total === 0
          ? 'sem histórico ainda'
          : `${acertos}/${total} aprovadas sem edição${taxa !== null ? ` · ${taxa}%` : ''}`}
      </p>
      {erro ? <p className="mt-1 text-[0.6875rem] text-danger">{erro}</p> : null}
    </div>
  )
}
