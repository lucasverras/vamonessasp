'use server'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { autenticar } from '@/lib/auth/guarda'
import { assinarSessao, COOKIE_SESSAO, DURACAO_SESSAO_DIAS } from '@/lib/auth/sessao'

export interface EstadoLogin {
  erro: string | null
}

export async function entrar(_anterior: EstadoLogin, form: FormData): Promise<EstadoLogin> {
  const usuario = String(form.get('usuario') ?? '')
  const senha = String(form.get('senha') ?? '')

  const cabecalhos = await headers()
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    cabecalhos.get('x-real-ip') ??
    null

  const r = await autenticar(usuario, senha, ip)
  // A senha nunca é registrada em log, nem em caso de erro.
  if (!r.ok) return { erro: r.erro }

  const jar = await cookies()
  jar.set(COOKIE_SESSAO, await assinarSessao(r.usuario, r.papel), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACAO_SESSAO_DIAS * 86_400,
  })

  redirect('/')
}

export async function sair() {
  const jar = await cookies()
  jar.delete(COOKIE_SESSAO)
  redirect('/entrar')
}
