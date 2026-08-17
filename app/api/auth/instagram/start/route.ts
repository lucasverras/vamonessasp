import { NextResponse } from 'next/server'
import { authorizeUrl, createState } from '@/lib/instagram/auth'

export const dynamic = 'force-dynamic'

/**
 * Inicia o OAuth. Guarda o `state` assinado em cookie httpOnly para que o
 * callback consiga provar que a volta corresponde a uma ida nossa (CSRF).
 */
export async function GET() {
  const { state, signed } = createState()

  const response = NextResponse.redirect(authorizeUrl(state))
  response.cookies.set('ig_oauth_state', signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min: tempo de sobra para autorizar, curto para ser reusado
  })
  return response
}
