import { NextResponse, type NextRequest } from 'next/server'

/**
 * Portão de acesso mínimo.
 *
 * O painel está num domínio público. Sem isto, qualquer pessoa que descobrisse a
 * URL poderia disparar sincronizações e consumir nosso rate limit da Meta.
 *
 * É deliberadamente simples — um código compartilhado em cookie httpOnly — e
 * será substituído por Supabase Auth com magic link e allowlist de e-mails.
 * Não é autenticação de verdade: é uma tranca enquanto a porta não chega.
 *
 * Páginas legais e webhooks ficam FORA: as legais precisam ser públicas por
 * exigência da Meta e da LGPD, e o webhook é autenticado por assinatura HMAC.
 */

const PUBLIC_PATHS = ['/privacy', '/terms', '/data-deletion', '/entrar']
const PUBLIC_PREFIXES = ['/api/webhooks/', '/api/cron/', '/_next/', '/favicon']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (pathname === '/') return NextResponse.next()
  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()

  // O callback do OAuth chega pela Meta, sem nosso cookie: é protegido pelo
  // `state` assinado, verificado na própria rota.
  if (pathname === '/api/auth/instagram/callback') return NextResponse.next()

  const expected = process.env.PANEL_ACCESS_CODE
  if (!expected) {
    return new NextResponse(
      'PANEL_ACCESS_CODE não configurado no ambiente. O painel está bloqueado por segurança.',
      { status: 503 },
    )
  }

  if (request.cookies.get('painel')?.value === expected) return NextResponse.next()

  return new NextResponse(
    'Acesso restrito. Abra /entrar?code=SEU_CODIGO uma vez para liberar este navegador.',
    { status: 401, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  )
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
