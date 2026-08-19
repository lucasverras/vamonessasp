'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCheck, Loader2, Trash2 } from 'lucide-react'
import { limparDuplicadosAction, limparJaAtendidosAction } from '@/app/(painel)/comentarios/acoes'

export interface DadosFila {
  naFila: number
  aguardandoAprovacao: number
  enviadasHoje: number
  enviadasOntem: number
  enviadasTotal: number
  falhasHoje: number
  pessoasFaltam: number
  seguidoresHoje: number | null
  seguidoresOntem: number | null
}

export function FilaEnvios({ dados, admin }: { dados: DadosFila; admin: boolean }) {
  const [resultado, setResultado] = useState<string | null>(null)
  const [pendente, start] = useTransition()
  const router = useRouter()

  const limparDup = () =>
    start(async () => {
      const r = await limparDuplicadosAction()
      setResultado(r.ok ? `${r.n} duplicados removidos da lista` : r.erro ?? 'falhou')
      router.refresh()
    })

  const limparAtendidos = () =>
    start(async () => {
      const r = await limparJaAtendidosAction()
      setResultado(
        r.ok
          ? `${(r.dmRecente ?? 0) + (r.jaSegue ?? 0)} removidos (${r.dmRecente} com DM recente, ${r.jaSegue} já seguem)`
          : r.erro ?? 'falhou',
      )
      router.refresh()
    })

  const C = [
    ['Faltam', dados.pessoasFaltam, 'pessoas elegíveis'],
    ['Aguardando OK', dados.aguardandoAprovacao, 'na aprovação'],
    ['Na fila', dados.naFila, 'prontas p/ sair'],
    ['Hoje', dados.enviadasHoje, 'enviadas'],
    ['Ontem', dados.enviadasOntem, 'enviadas'],
    ['Total', dados.enviadasTotal, 'já foram'],
  ] as const

  return (
    <section className="rise mt-5 rounded-card border border-line bg-canvas p-4" style={{ animationDelay: '80ms' }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-[1rem] font-semibold tracking-[-0.01em]">Fila & envios</h2>
        {admin ? (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={limparDup}
              disabled={pendente}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3.5" />}
              Limpar duplicados
            </button>
            <button
              onClick={limparAtendidos}
              disabled={pendente}
              className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[0.75rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink disabled:opacity-50"
            >
              {pendente ? <Loader2 className="size-3 animate-spin" /> : <CheckCheck className="size-3.5" />}
              Limpar já atendidos
            </button>
          </div>
        ) : null}
      </div>

      {resultado ? (
        <p className="mt-2 text-[0.75rem] font-medium text-accent">
          {resultado} — continuam no banco para auditoria.
        </p>
      ) : null}

      <dl className="tnum mt-3 grid grid-cols-3 gap-x-4 gap-y-3 sm:grid-cols-6">
        {C.map(([k, v, sub]) => (
          <div key={k}>
            <dt className="text-[0.625rem] uppercase tracking-wider text-ink-faint">{k}</dt>
            <dd className="font-display text-xl font-semibold leading-tight">{v.toLocaleString('pt-BR')}</dd>
            <dd className="text-[0.625rem] text-ink-faint">{sub}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-3 border-t border-line-soft pt-2.5 text-[0.75rem] text-ink-faint">
        Seguidores da conta:{' '}
        <strong className="tnum text-ink-soft">
          {dados.seguidoresHoje !== null ? `+${dados.seguidoresHoje}` : '—'} hoje (parcial)
        </strong>{' '}
        ·{' '}
        <strong className="tnum text-ink-soft">
          {dados.seguidoresOntem !== null ? `+${dados.seguidoresOntem}` : '—'} ontem
        </strong>
        {dados.falhasHoje > 0 ? (
          <span className="text-danger"> · {dados.falhasHoje} falhas hoje</span>
        ) : null}{' '}
        — crescimento da conta no período, sem atribuição individual por DM (a Meta não fornece).
      </p>
    </section>
  )
}
