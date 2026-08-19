'use client'

import { useState, useTransition } from 'react'
import { Check, Pencil, Send, Trash2, X } from 'lucide-react'
import { aprovarFb, descartarFb } from '@/app/(painel)/aprovacoes/acoes'

export interface ItemFb {
  id: string
  confidence: string | null
  userName: string | null
  message: string | null
  postMessage: string | null
  sugestao: string | null
  motivo: string | null
  precisaHumano: boolean
  quando: string
}

export function AprovacoesFb({ itens }: { itens: ItemFb[] }) {
  if (!itens.length) return null
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
        Facebook — respostas públicas
      </h2>
      <p className="mt-1 text-[0.8125rem] text-ink-faint">
        Mesma regra do Instagram: a IA sugere, você aprova, nunca pede follow. A Meta oculta o
        autor destes comentários (App Review pendente) — a resposta vai ao texto, não à pessoa.
      </p>
      <ul className="mt-4 space-y-3">
        {itens.map((i) => (
          <Item key={i.id} item={i} />
        ))}
      </ul>
    </section>
  )
}

function Item({ item }: { item: ItemFb }) {
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(item.sugestao ?? '')
  const [estado, setEstado] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const aprovar = () =>
    start(async () => {
      const r = await aprovarFb(item.id, editando || item.precisaHumano ? texto : undefined)
      if (r.ok) setFeito('Publicada no Facebook.')
      else setEstado(r.detalhe ?? 'falhou')
    })
  const jogarFora = () =>
    start(async () => {
      const r = await descartarFb(item.id)
      if (r.ok) setFeito('Descartada.')
      else setEstado(r.erro ?? 'falhou')
    })

  if (feito) {
    return (
      <li className="flex items-center gap-2.5 rounded-card border border-line bg-canvas px-4 py-3 text-[0.8125rem] text-ink-faint">
        {feito.startsWith('Publicada') ? <Check className="size-4 text-accent" /> : <X className="size-4" />}
        {feito}
      </li>
    )
  }

  return (
    <li className="rounded-card border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-[#1877f2]/20 px-1.5 py-0.5 text-[0.625rem] font-bold text-[#6ea8ff]">FB</span>
        <span className="text-[0.8125rem] font-semibold">{item.userName ?? 'Autor oculto pela Meta'}</span>
        {item.confidence ? (
          <span
            className={`rounded-full px-2 py-0.5 text-[0.625rem] font-semibold ${
              item.confidence === 'HIGH'
                ? 'bg-accent-wash text-accent'
                : item.confidence === 'MEDIUM'
                  ? 'bg-surface text-ink-soft'
                  : 'bg-warn-wash text-warn'
            }`}
          >
            {item.confidence}
          </span>
        ) : null}
        {item.precisaHumano ? (
          <span className="rounded-full bg-warn-wash px-2 py-0.5 text-[0.625rem] font-medium text-warn">precisa de você</span>
        ) : null}
        <span className="ml-auto text-[0.6875rem] text-ink-faint">{item.quando}</span>
      </div>
      <p className="mt-2 border-l-2 border-line pl-3 text-[0.875rem] italic leading-relaxed text-ink-soft">
        {item.message}
      </p>
      {item.postMessage ? (
        <p className="mt-1 truncate text-[0.6875rem] text-ink-faint">
          no post: {item.postMessage.replace(/\s+/g, ' ').slice(0, 80)}
        </p>
      ) : null}
      {item.motivo && item.precisaHumano ? (
        <p className="mt-1.5 text-[0.75rem] text-warn">{item.motivo}</p>
      ) : null}

      {editando || item.precisaHumano ? (
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={2}
          placeholder="Escreva a resposta pública…"
          className="mt-3 w-full rounded-lg border border-line bg-void px-3 py-2 text-[0.9375rem] outline-none focus:border-accent"
        />
      ) : (
        <div className="mt-3 rounded-lg bg-surface/60 px-3.5 py-2.5">
          <p className="text-[0.625rem] font-medium uppercase tracking-wider text-ink-faint">resposta sugerida</p>
          <p className="mt-1 text-[0.9375rem] leading-relaxed">{texto}</p>
        </div>
      )}

      {estado ? <p className="mt-2 text-[0.75rem] font-medium text-warn">{estado}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={aprovar}
          disabled={pendente || ((editando || item.precisaHumano) && texto.trim().length === 0)}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-50"
        >
          <Send className="size-3.5" /> {pendente ? 'Publicando…' : 'Aprovar e publicar'}
        </button>
        {!editando && !item.precisaHumano ? (
          <button onClick={() => setEditando(true)} disabled={pendente} className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-[0.8125rem] font-medium text-ink-soft hover:border-ink-faint">
            <Pencil className="size-3.5" /> Editar
          </button>
        ) : null}
        <button onClick={jogarFora} disabled={pendente} className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] text-ink-faint hover:text-danger">
          <Trash2 className="size-3.5" /> Descartar
        </button>
      </div>
    </li>
  )
}
