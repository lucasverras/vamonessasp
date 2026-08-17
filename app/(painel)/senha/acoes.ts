'use server'

import { cookies } from 'next/headers'
import { conferirSenha, gerarHash } from '@/lib/auth/senha'
import { exigirSessao } from '@/lib/auth/guarda'
import { assinarSessao, COOKIE_SESSAO, DURACAO_SESSAO_DIAS } from '@/lib/auth/sessao'
import { db } from '@/lib/db'

export interface EstadoSenha {
  erro: string | null
  ok: boolean
}

/**
 * Troca a PRÓPRIA senha. Exige a senha atual — uma sessão roubada não pode
 * trocar a senha sem conhecê-la. password_changed_at derruba as sessões
 * antigas; um cookie novo é emitido para ESTA continuar.
 *
 * Reset por esquecimento é operação de admin, fora do navegador:
 * `npm run script -- scripts/usuarios.ts criar <usuario> <senha-nova> <papel>`.
 */
export async function alterarSenha(_a: EstadoSenha, form: FormData): Promise<EstadoSenha> {
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { erro: e instanceof Error ? e.message : 'Sessão expirada.', ok: false }
  }

  const atual = String(form.get('atual') ?? '')
  const nova = String(form.get('nova') ?? '')
  if (nova.length < 8) return { erro: 'A senha nova precisa de pelo menos 8 caracteres.', ok: false }

  const { data: u } = await db()
    .from('panel_users')
    .select('password_hash')
    .eq('username', sessao.usuario)
    .single()

  if (!u || !(await conferirSenha(atual, u.password_hash as string))) {
    return { erro: 'Senha atual incorreta.', ok: false }
  }

  const { error } = await db()
    .from('panel_users')
    .update({
      password_hash: await gerarHash(nova),
      password_changed_at: new Date().toISOString(),
    })
    .eq('username', sessao.usuario)
  if (error) return { erro: error.message, ok: false }

  // Sessão nova para este navegador, com iat posterior ao corte.
  const jar = await cookies()
  jar.set(COOKIE_SESSAO, await assinarSessao(sessao.usuario, sessao.papel), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DURACAO_SESSAO_DIAS * 86_400,
  })

  return { erro: null, ok: true }
}
