'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { AlertCircle, ArrowRight } from 'lucide-react'
import { entrar, type EstadoLogin } from './acoes'

function Botao() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="group mt-1 inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-5 py-3 text-[0.875rem] font-semibold text-void transition-all hover:-translate-y-px disabled:translate-y-0 disabled:opacity-55"
    >
      {pending ? 'Verificando…' : 'Entrar'}
      {!pending ? (
        <ArrowRight className="size-4 stroke-[2.25] transition-transform group-hover:translate-x-0.5" />
      ) : null}
    </button>
  )
}

export default function Entrar() {
  const [estado, acao] = useActionState<EstadoLogin, FormData>(entrar, { erro: null })

  return (
    <main className="grid min-h-dvh place-items-center px-5 py-12">
      <div className="rise w-full max-w-[380px]">
        <div className="mb-8">
          <p className="text-[0.6875rem] font-medium uppercase tracking-[0.14em] text-accent">
            Vamo Nessa
          </p>
          <h1 className="mt-1.5 font-display text-[2rem] font-semibold leading-none tracking-[-0.035em]">
            Growth OS
          </h1>
          <p className="mt-2.5 text-[0.875rem] leading-relaxed text-ink-faint">
            Painel interno. Entre com seu usuário para continuar.
          </p>
        </div>

        <form action={acao} className="flex flex-col gap-3.5">
          <label className="block">
            <span className="mb-1.5 block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              Usuário
            </span>
            <input
              name="usuario"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              autoFocus
              className="w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[0.9375rem] outline-none transition-colors placeholder:text-ink-faint/60 focus:border-accent"
              placeholder="seu usuário"
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              Senha
            </span>
            <input
              name="senha"
              type="password"
              autoComplete="current-password"
              required
              className="tnum w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[0.9375rem] outline-none transition-colors placeholder:text-ink-faint/60 focus:border-accent"
              placeholder="••••••"
            />
          </label>

          {estado.erro ? (
            <p
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-wash/50 px-3.5 py-2.5 text-[0.8125rem] leading-relaxed text-danger"
            >
              <AlertCircle className="mt-px size-4 shrink-0" />
              {estado.erro}
            </p>
          ) : null}

          <Botao />
        </form>

        <p className="mt-7 text-center text-[0.75rem] leading-relaxed text-ink-faint">
          <a href="/privacy" className="transition-colors hover:text-ink-soft">
            Privacidade
          </a>
          <span className="px-2 opacity-40">·</span>
          <a href="/terms" className="transition-colors hover:text-ink-soft">
            Termos
          </a>
          <span className="px-2 opacity-40">·</span>
          <a href="/data-deletion" className="transition-colors hover:text-ink-soft">
            Excluir dados
          </a>
        </p>
      </div>
    </main>
  )
}
