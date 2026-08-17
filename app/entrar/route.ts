import { NextResponse, type NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Libera este navegador. Sem interface: acessa-se uma vez com o código e o
 * cookie httpOnly passa a valer. Substituído por Supabase Auth em seguida.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code')
  const expected = process.env.PANEL_ACCESS_CODE

  if (!expected) return new NextResponse('PANEL_ACCESS_CODE não configurado.', { status: 503 })
  if (!code || code !== expected) {
    return new NextResponse('Código inválido.', { status: 401 })
  }

  const response = NextResponse.redirect(new URL('/configuracoes/instagram', request.url))
  response.cookies.set('painel', expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return response
}
