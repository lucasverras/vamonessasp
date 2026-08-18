'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronDown, Send, X } from 'lucide-react'
import { naoResponder, responderHumano, salvarFatoNoConteudo } from '@/app/(painel)/revisao/acoes'

export interface ItemPrecisaDeVoce {
  analysisId: string
  commentId: string
  mediaId: string | null
  username: string | null
  texto: string | null
  quando: string
  janelaDm: string | null
  intent: string | null
  confianca: number | null
  motivo: string | null
  motivoCodigo: string | null
  fatosDisponiveis: string[]
  fatosFaltando: string[]
  sugestao: string | null
  caption: string | null
  thumbnail: string | null
  permalink: string | null
  /** DM desmarcada por padrão para crítica/delicada/comercial/spam. */
  dmPadrao: boolean
}

export function PrecisaDeVoce({ itens }: { itens: ItemPrecisaDeVoce[] }) {
  return (
    <ul className="space-y-3">
      {itens.map((i) => (
        <Item key={i.analysisId} item={i} />
      ))}
    </ul>
  )
}

function Item({ item }: { item: ItemPrecisaDeVoce }) {
  const [texto, setTexto] = useState(item.sugestao ?? '')
  const [dm, setDm] = useState(item.dmPadrao)
  const [estado, setEstado] = useState<string | null>(null)
  const [feito, setFeito] = useState<string | null>(null)
  const [salvarFato, setSalvarFato] = useState(false)
  const [campoFato, setCampoFato] = useState('notes')
  const [valorFato, setValorFato] = useState('')
  const [pendente, start] = useTransition()

  const responder = () =>
    start(async () => {
      const r = await responderHumano(item.analysisId, item.commentId, texto, dm)
      if (!r.ok) return setEstado(r.detalhe)
      // Só com confirmação explícita a resposta vira fato do conteúdo.
      if (salvarFato && valorFato.trim() && item.mediaId) {
        const f = await salvarFatoNoConteudo(item.mediaId, campoFato, valorFato)
        setFeito(
          `Resposta publicada.${r.dmDetalhe ? ` ${r.dmDetalhe}` : ''}${f.ok ? ' Fato salvo no conteúdo.' : ` (fato não salvo: ${f.erro})`}`,
        )
      } else {
        setFeito(`Resposta publicada.${r.dmDetalhe ? ` ${r.dmDetalhe}` : ''}`)
      }
    })

  const ignorar = () =>
    start(async () => {
      const r = await naoResponder(item.analysisId)
      if (r.ok) setFeito('Marcado como "não responder".')
      else setEstado(r.erro ?? 'falhou')
    })

  if (feito) {
    return (
      <li className="flex items-center gap-2.5 rounded-card border border-line bg-canvas px-4 py-3 text-[0.8125rem] text-ink-faint">
        <Check className="size-4 text-accent" /> {feito}
      </li>
    )
  }

  return (
    <li className="rounded-card border border-warn/35 bg-canvas p-4">
      <div className="flex items-start gap-3">
        {item.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.thumbnail} alt="" className="hidden size-11 shrink-0 rounded object-cover sm:block" />
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-[0.6875rem] text-ink-faint">
            <span className="text-[0.8125rem] font-semibold text-ink">@{item.username ?? '—'}</span>
            {item.intent ? (
              <span className="rounded-full bg-surface px-2 py-0.5 font-medium text-ink-soft">
                {item.intent}
                {item.confianca !== null ? ` ${Math.round(item.confianca * 100)}%` : ''}
              </span>
            ) : null}
            <span>{item.quando}</span>
            {item.janelaDm ? <span className="text-warn">{item.janelaDm}</span> : null}
          </div>

          <p className="mt-2 border-l-2 border-warn/40 pl-3 text-[0.9375rem] italic leading-relaxed">
            {item.texto}
          </p>
          {item.caption ? (
            <p className="mt-1 truncate text-[0.6875rem] text-ink-faint">
              em: {item.caption.replace(/\s+/g, ' ').slice(0, 90)}
            </p>
          ) : null}

          <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink-soft">
            <span className="font-semibold text-warn">Por que parou:</span>{' '}
            {item.motivoCodigo ? <code className="rounded bg-surface px-1 text-[0.6875rem]">{item.motivoCodigo}</code> : null}{' '}
            {item.motivo}
          </p>
          {item.fatosDisponiveis.length || item.fatosFaltando.length ? (
            <p className="mt-1 flex flex-wrap gap-1.5 text-[0.6875rem]">
              {item.fatosDisponiveis.map((f) => (
                <span key={f} className="rounded-full bg-accent-wash px-2 py-0.5 text-accent">✓ {f}</span>
              ))}
              {item.fatosFaltando.map((f) => (
                <span key={f} className="rounded-full bg-danger-wash px-2 py-0.5 text-danger">falta: {f}</span>
              ))}
            </p>
          ) : null}

          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={2}
            placeholder={item.sugestao ? undefined : 'Escreva a resposta pública…'}
            className="mt-3 w-full rounded-lg border border-line bg-void px-3 py-2 text-[0.9375rem] leading-relaxed outline-none focus:border-accent"
          />
          {item.sugestao && texto === item.sugestao ? (
            <p className="mt-1 text-[0.6875rem] text-ink-faint">sugestão da IA — edite à vontade antes de publicar</p>
          ) : null}

          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="flex items-center gap-2 text-[0.8125rem]">
              <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
              Enviar também a DM de follow (template)
            </label>
            <button
              onClick={() => setSalvarFato((v) => !v)}
              className="inline-flex items-center gap-1 text-[0.75rem] text-ink-faint hover:text-ink"
            >
              <ChevronDown className={`size-3.5 transition-transform ${salvarFato ? 'rotate-180' : ''}`} />
              Adicionar informação ao conteúdo
            </button>
          </div>

          {salvarFato ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface/50 p-2.5">
              <select
                value={campoFato}
                onChange={(e) => setCampoFato(e.target.value)}
                className="rounded-lg border border-line bg-void px-2 py-1.5 text-[0.75rem]"
              >
                <option value="notes">Observação (ex.: estacionamento)</option>
                <option value="address">Endereço</option>
                <option value="price">Preço</option>
                <option value="opening_hours">Horário</option>
              </select>
              <input
                value={valorFato}
                onChange={(e) => setValorFato(e.target.value)}
                placeholder='ex.: "Estacionamento: valet na porta"'
                className="min-w-0 flex-1 rounded-lg border border-line bg-void px-2.5 py-1.5 text-[0.8125rem]"
              />
              <span className="w-full text-[0.6875rem] text-ink-faint">
                Salvo junto com a resposta, SÓ com sua confirmação — a IA passa a usar em perguntas futuras deste conteúdo.
              </span>
            </div>
          ) : null}

          {estado ? <p className="mt-2 text-[0.75rem] font-medium text-danger">{estado}</p> : null}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={responder}
              disabled={pendente || texto.trim().length === 0}
              className="inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-50"
            >
              <Send className="size-3.5" />
              {pendente ? 'Publicando…' : 'Responder'}
            </button>
            <button
              onClick={ignorar}
              disabled={pendente}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[0.8125rem] text-ink-faint hover:text-danger"
            >
              <X className="size-3.5" /> Não responder
            </button>
          </div>
        </div>
      </div>
    </li>
  )
}
