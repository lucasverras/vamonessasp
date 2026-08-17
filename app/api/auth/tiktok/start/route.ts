import { NextResponse } from 'next/server'
import { sessaoAtual } from '@/lib/auth/guarda'
import { criarStateTikTok, urlDeAutorizacaoTikTok } from '@/lib/tiktok/auth'

export const dynamic = 'force-dynamic'

/**
 * Inicia o OAuth do TikTok. Mesmo desenho do Instagram: `state` assinado em
 * cookie httpOnly, conferido no callback (CSRF).
 *
 * Conectar uma conta é ação de ADMIN — um operador não deve conseguir trocar
 * a conta TikTok do painel.
 */
export async function GET(request: Request) {
  const sessao = await sessaoAtual()
  if (sessao?.papel !== 'ADMIN') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  const { state, signed } = criarStateTikTok()

  const response = NextResponse.redirect(urlDeAutorizacaoTikTok(state))
  response.cookies.set('tt_oauth_state', signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
  })
  return response
}
