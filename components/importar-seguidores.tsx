'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, Upload } from 'lucide-react'
import { importarSeguidoresAction } from '@/app/(painel)/configuracoes/instagram/acoes-automacao'

export function ImportarSeguidores() {
  const [resultado, setResultado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, start] = useTransition()

  const enviar = (form: FormData) =>
    start(async () => {
      setErro(null)
      setResultado(null)
      const r = await importarSeguidoresAction(form)
      if (!r.ok) return setErro(r.erro)
      setResultado(
        `${r.seguidoresNoArquivo.toLocaleString('pt-BR')} seguidores no arquivo · ` +
          `${r.marcadosComoSeguidores} comentaristas marcados como SEGUIDORES (nunca recebem DM` +
          `${r.dmsPuladasDeSeguidores ? `; ${r.dmsPuladasDeSeguidores} DMs pendentes puladas` : ''}) · ` +
          `${r.marcadosComoNaoSeguidores} marcados como NÃO-seguidores — DM automática liberada para eles`,
      )
    })

  return (
    <section className="mt-6 rounded-card border border-accent/30 bg-canvas p-5">
      <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">
        Filtro de seguidores — importação oficial
      </h2>
      <p className="mt-1 max-w-xl text-[0.8125rem] leading-relaxed text-ink-faint">
        Enquanto a Meta não libera a consulta pela API, o filtro vem da SUA exportação oficial:
        no Instagram, <strong className="text-ink-soft">Configurações → Central de contas → Suas
        informações e permissões → Baixar suas informações</strong> → selecione só{' '}
        <strong className="text-ink-soft">"Seguidores e seguindo"</strong>, formato JSON. Baixe o
        ZIP, extraia e envie aqui o <code className="rounded bg-surface px-1">followers_1.json</code>.
        Quem está na lista nunca recebe DM; quem não está recebe automaticamente. Repita toda
        semana para a foto não envelhecer.
      </p>

      <form action={enviar} className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="arquivo"
          accept=".json,.txt,application/json,text/plain"
          required
          className="text-[0.8125rem] file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-2 file:text-[0.8125rem] file:font-medium file:text-ink-soft"
        />
        <button
          type="submit"
          disabled={pendente}
          className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-50"
        >
          {pendente ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
          {pendente ? 'Cruzando…' : 'Importar seguidores'}
        </button>
      </form>

      {resultado ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-wash/50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed">
          <Check className="mt-0.5 size-4 shrink-0 text-accent" />
          {resultado}
        </p>
      ) : null}
      {erro ? (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger-wash/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">
          {erro}
        </p>
      ) : null}
    </section>
  )
}
