'use client'

import { useActionState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { alterarSenha, type EstadoSenha } from './acoes'

export default function TrocarSenha() {
  const [estado, acao, pendente] = useActionState<EstadoSenha, FormData>(alterarSenha, {
    erro: null,
    ok: false,
  })

  return (
    <main className="mx-auto max-w-[420px] px-5 py-10">
      <h1 className="font-display text-[1.5rem] font-semibold tracking-[-0.02em]">Trocar senha</h1>
      <p className="mt-1 text-[0.8125rem] leading-relaxed text-ink-faint">
        Trocar a senha derruba as sessões antigas desta conta em todos os navegadores.
      </p>

      <form action={acao} className="mt-6 flex flex-col gap-3.5">
        <label className="block">
          <span className="mb-1.5 block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
            Senha atual
          </span>
          <input
            name="atual"
            type="password"
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[0.9375rem] outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
            Senha nova (mínimo 8 caracteres)
          </span>
          <input
            name="nova"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            className="w-full rounded-lg border border-line bg-canvas px-3.5 py-2.5 text-[0.9375rem] outline-none focus:border-accent"
          />
        </label>

        {estado.erro ? (
          <p role="alert" className="flex items-start gap-2 rounded-lg border border-danger/25 bg-danger-wash/50 px-3.5 py-2.5 text-[0.8125rem] text-danger">
            <AlertCircle className="mt-px size-4 shrink-0" />
            {estado.erro}
          </p>
        ) : null}
        {estado.ok ? (
          <p className="flex items-start gap-2 rounded-lg border border-accent/25 bg-accent-wash/50 px-3.5 py-2.5 text-[0.8125rem]">
            <Check className="mt-px size-4 shrink-0 text-accent" />
            Senha trocada. Sessões antigas foram derrubadas; esta continua válida.
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pendente}
          className="mt-1 rounded-full bg-accent px-5 py-2.5 text-[0.875rem] font-semibold text-void transition-transform hover:-translate-y-px disabled:opacity-55"
        >
          {pendente ? 'Trocando…' : 'Trocar senha'}
        </button>
      </form>
    </main>
  )
}
