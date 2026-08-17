import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_SESSAO, lerSessao } from '@/lib/auth/sessao'

/**
 * Portão do painel.
 *
 * Substituiu o código compartilhado: agora cada pessoa tem usuário, senha e
 * papel, e a sessão é um token assinado (HMAC) que o navegador não consegue
 * forjar — escrever `papel: ADMIN` no cookie quebra a assinatura.
 *
 * Isto barra a NAVEGAÇÃO. Não é a garantia de autorização: server actions são
 * endpoints HTTP e podem ser chamadas direto, então cada ação sensível confere
 * o papel no servidor, em `lib/auth/guarda.ts`.
 *
 * Ficam FORA: páginas legais (exigência da Meta e da LGPD), o webhook
 * (autenticado por HMAC da Meta), os crons (autenticados por CRON_SECRET) e os
 * arquivos de verificação de domínio.
 */

const PUBLIC_PATHS = ['/privacy', '/terms', '/data-deletion', '/entrar', '/api/health']
const PUBLIC_PREFIXES = ['/api/webhooks/', '/api/cron/', '/_next/', '/favicon']
const VERIFICACAO_DE_DOMINIO = /^\/[A-Za-z0-9_-]+\.txt$/

/** Rotas que só ADMIN abre. A ação correspondente confere de novo no servidor. */
const SOMENTE_ADMIN = ['/configuracoes']

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (PUBLIC_PATHS.includes(pathname)) return NextResponse.next()
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next()
  if (VERIFICACAO_DE_DOMINIO.test(pathname)) return NextResponse.next()

  // Callbacks de OAuth chegam do provedor, sem nosso cookie: são protegidos
  // pelo `state` assinado, verificado em cada rota.
  if (pathname === '/api/auth/instagram/callback') return NextResponse.next()
  if (pathname === '/api/auth/tiktok/callback') return NextResponse.next()

  const sessao = await lerSessao(request.cookies.get(COOKIE_SESSAO)?.value)

  if (!sessao) {
    const destino = new URL('/entrar', request.url)
    const resposta = NextResponse.redirect(destino)
    // Cookie inválido ou expirado é lixo: limpar evita o loop de redirecionar
    // para o login que redireciona de volta.
    resposta.cookies.delete(COOKIE_SESSAO)
    return resposta
  }

  if (sessao.papel !== 'ADMIN' && SOMENTE_ADMIN.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
}
