'use client'

import { useState, useTransition } from 'react'
import { Check, MessageSquare, Pencil, Send, Trash2, UserCheck, X } from 'lucide-react'
import {
  aprovarEEnviar,
  aprovarLote,
  descartar,
  editarEEnviar,
  marcarComoSeguidor,
  salvarEdicao,
} from '@/app/(painel)/aprovacoes/acoes'

export interface ItemAprovacao {
  id: string
  tipo: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'
  username: string | null
  comentario: string | null
  conteudo: string | null
  thumbnail: string | null
  quando: string
  sugestao: string
  editada: boolean
  intent: string | null
  confianca: number | null
  motivo: string | null
  origem: 'novo' | 'campanha'
  /** Por que a DM correspondente NÃO foi sugerida (segue / desconhecido / recente). */
  dmInfo: string | null
}

export function AprovacoesLista({ itens }: { itens: ItemAprovacao[] }) {
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [resultadoLote, setResultadoLote] = useState<string | null>(null)
  const [pendente, startTransition] = useTransition()

  const alternar = (id: string) =>
    setSelecionados((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const executarLote = () => {
    const ids = [...selecionados]
    setConfirmando(false)
    startTransition(async () => {
      const r = await aprovarLote(ids)
      const partes = [`${r.enviadas} enviada${r.enviadas === 1 ? '' : 's'}`]
      if (r.jaProcessadas) partes.push(`${r.jaProcessadas} já processada(s)`)
      if (r.falhas.length) partes.push(`${r.falhas.length} falhou/falharam`)
      setResultadoLote(partes.join(' · '))
      setSelecionados(new Set())
    })
  }

  return (
    <div>
      {/* Barra de lote: aparece só com seleção. A confirmação é explícita e
          mostra o número exato — nunca "todos", sempre o lote visível. */}
      {selecionados.size > 0 ? (
        <div className="sticky top-2 z-20 mb-4 flex flex-wrap items-center gap-3 rounded-card border border-accent/30 bg-canvas px-4 py-3 shadow-lg">
          <span className="tnum text-[0.875rem] font-semibold">
            {selecionados.size} selecionado{selecionados.size === 1 ? '' : 's'}
          </span>
          {!confirmando ? (
            <button
              onClick={() => setConfirmando(true)}
              disabled={pendente}
              className="rounded-full bg-accent px-4 py-1.5 text-[0.8125rem] font-semibold text-void disabled:opacity-50"
            >
              Aprovar selecionados
            </button>
          ) : (
            <span className="flex items-center gap-2 text-[0.8125rem]">
              Você está prestes a aprovar e enviar {selecionados.size} resposta
              {selecionados.size === 1 ? '' : 's'}.
              <button
                onClick={executarLote}
                disabled={pendente}
                className="rounded-full bg-accent px-3 py-1.5 font-semibold text-void disabled:opacity-50"
              >
                {pendente ? 'Enviando…' : `Aprovar e enviar ${selecionados.size}`}
              </button>
              <button onClick={() => setConfirmando(false)} className="rounded-full border border-line px-3 py-1.5">
                Cancelar
              </button>
            </span>
          )}
          <button
            onClick={() => setSelecionados(new Set())}
            className="ml-auto text-[0.75rem] text-ink-faint hover:text-ink"
          >
            limpar
          </button>
        </div>
      ) : null}

      {resultadoLote ? (
        <p className="mb-4 rounded-card border border-line bg-canvas px-4 py-2.5 text-[0.8125rem]">
          Resultado do lote: <strong>{resultadoLote}</strong>
        </p>
      ) : null}

      <div className="mb-3 flex items-center gap-3">
        <label className="flex items-center gap-2 text-[0.75rem] text-ink-faint">
          <input
            type="checkbox"
            checked={itens.length > 0 && selecionados.size === itens.length}
            onChange={(e) =>
              setSelecionados(e.target.checked ? new Set(itens.map((i) => i.id)) : new Set())
            }
            className="size-4 accent-[var(--color-accent)]"
          />
          Selecionar todos desta página ({itens.length})
        </label>
      </div>

      <ul className="space-y-3">
        {itens.map((item) => (
          <Item
            key={item.id}
            item={item}
            selecionado={selecionados.has(item.id)}
            aoAlternar={() => alternar(item.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function Item({
  item,
  selecionado,
  aoAlternar,
}: {
  item: ItemAprovacao
  selecionado: boolean
  aoAlternar: () => void
}) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(item.sugestao)
  const [estado, setEstado] = useState<string | null>(null)
  const [feito, setFeito] = useState<'enviada' | 'descartada' | null>(null)
  const [pendente, start] = useTransition()

  // Duplo clique: o botão desabilita no primeiro clique (isPending) e o
  // servidor recusa o segundo de qualquer forma — defesa nas duas pontas.
  const aprovar = () =>
    start(async () => {
      const r = await aprovarEEnviar(item.id)
      if (r.ok) setFeito('enviada')
      else setEstado(r.detalhe ?? r.status)
    })

  const enviarEditada = () =>
    start(async () => {
      const r = await editarEEnviar(item.id, texto)
      if (r.ok) setFeito('enviada')
      else setEstado(r.detalhe ?? r.status)
    })

  const salvar = () =>
    start(async () => {
      const r = await salvarEdicao(item.id, texto)
      if (r.ok) {
        setEditando(false)
        setEstado('Edição salva — continua na fila.')
      } else setEstado(r.erro)
    })

  const jogarFora = () =>
    start(async () => {
      const r = await descartar(item.id)
      if (r.ok) setFeito('descartada')
      else setEstado(r.erro)
    })

  const ehSeguidor = () =>
    start(async () => {
      const r = await marcarComoSeguidor(item.id)
      if (r.ok) setFeito('descartada')
      else setEstado(r.erro)
    })

  if (feito) {
    return (
      <li className="flex items-center gap-2.5 rounded-card border border-line bg-canvas px-4 py-3 text-[0.8125rem] text-ink-faint">
        {feito === 'enviada' ? (
          <>
            <Check className="size-4 text-accent" /> Enviada para @{item.username ?? '—'}
          </>
        ) : (
          <>
            <X className="size-4" /> Descartada
          </>
        )}
      </li>
    )
  }

  return (
    <li className={`rounded-card border bg-canvas p-4 ${selecionado ? 'border-accent/50' : 'border-line'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selecionado}
          onChange={aoAlternar}
          aria-label="Selecionar"
          className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
        />
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnail} alt="" className="hidden size-10 shrink-0 rounded object-cover sm:block" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.8125rem] font-semibold">@{item.username ?? '—'}</span>
            <span className={`rounded-full px-2 py-0.5 text-[0.625rem] font-semibold uppercase ${item.tipo === 'PRIVATE_REPLY' ? 'bg-accent-wash text-accent' : 'bg-surface text-ink-soft'}`}>
              {item.tipo === 'PRIVATE_REPLY' ? 'DM' : 'resposta pública'}
            </span>
            {item.origem === 'campanha' ? (
              <span className="rounded-full bg-warn-wash px-2 py-0.5 text-[0.625rem] font-medium text-warn">
                campanha pausada
              </span>
            ) : null}
            {item.editada ? (
              <span className="rounded-full bg-surface px-2 py-0.5 text-[0.625rem] text-ink-faint">editada</span>
            ) : null}
            <span className="ml-auto text-[0.6875rem] text-ink-faint">{item.quando}</span>
          </div>

          <p className="mt-2 border-l-2 border-line pl-3 text-[0.875rem] italic leading-relaxed text-ink-soft">
            {item.comentario ?? '—'}
          </p>
          {item.conteudo ? (
            <p className="mt-1 truncate text-[0.6875rem] text-ink-faint">
              em: {item.conteudo.replace(/\s+/g, ' ').slice(0, 80)}
            </p>
          ) : null}

          {editando ? (
            <div className="mt-3">
              <textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-accent/50 bg-void px-3 py-2 text-[0.875rem] leading-relaxed outline-none focus:border-accent"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={enviarEditada} disabled={pendente} className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-[0.75rem] font-semibold text-void disabled:opacity-50">
                  <Send className="size-3" /> Salvar e enviar
                </button>
                <button onClick={salvar} disabled={pendente} className="rounded-full border border-line px-3.5 py-1.5 text-[0.75rem] font-medium">
                  Salvar
                </button>
                <button onClick={() => { setEditando(false); setTexto(item.sugestao) }} className="px-2 text-[0.75rem] text-ink-faint">
                  cancelar
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-lg bg-surface/60 px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-ink-faint">
                <MessageSquare className="size-3" /> resposta que será enviada
              </p>
              <p className="mt-1 whitespace-pre-line text-[0.9375rem] leading-relaxed">{texto}</p>
            </div>
          )}

          {item.dmInfo ? (
            <p className="mt-2 text-[0.6875rem] text-ink-faint">{item.dmInfo}</p>
          ) : null}

          {item.motivo ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-[0.6875rem] text-ink-faint">contexto da decisão</summary>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-faint">
                {item.intent ? `intenção ${item.intent}` : ''}
                {item.confianca !== null ? ` · ${Math.round(item.confianca * 100)}%` : ''} · {item.motivo}
              </p>
            </details>
          ) : null}

          {estado ? <p className="mt-2 text-[0.75rem] font-medium text-warn">{estado}</p> : null}

          {!editando ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={aprovar}
                disabled={pendente}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-50"
              >
                <Check className="size-3.5 stroke-[2.5]" />
                {pendente ? 'Enviando…' : 'Aprovar e enviar'}
              </button>
              <button
                onClick={() => setEditando(true)}
                disabled={pendente}
                className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-soft hover:border-ink-faint"
              >
                <Pencil className="size-3.5" /> Editar
              </button>
              <button
                onClick={jogarFora}
                disabled={pendente}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] text-ink-faint hover:text-danger"
              >
                <Trash2 className="size-3.5" /> Descartar
              </button>
              {item.tipo === 'PRIVATE_REPLY' ? (
                <button
                  onClick={ehSeguidor}
                  disabled={pendente}
                  title="Marca a pessoa como seguidora: pula todas as DMs pendentes dela e nunca mais sugere"
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] text-ink-faint hover:text-accent"
                >
                  <UserCheck className="size-3.5" /> É seguidor
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </li>
  )
}
