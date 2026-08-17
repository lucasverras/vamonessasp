import { NextResponse, type NextRequest } from 'next/server'
import { conferirStateTikTok, salvarConexaoTikTok, trocarCodePorToken } from '@/lib/tiktok/auth'

export const dynamic = 'force-dynamic'

/**
 * Callback do OAuth do TikTok.
 *
 * Cadastrada no TikTok Developer Portal como
 * https://vamonessasp.vercel.app/api/auth/tiktok/callback — precisa bater
 * caractere a caractere com env.tiktokRedirectUri, que é a mesma string usada
 * na URL de autorização e na troca do code.
 *
 * Fica fora do portão de sessão no middleware: quem chega aqui é o navegador
 * voltando do TikTok. A prova de legitimidade é o `state` assinado.
 */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const erro = p.get('error')
  const code = p.get('code')
  const state = p.get('state')

  const paraConfiguracoes = (msg: string) => {
    const url = new URL('/configuracoes/instagram', request.url)
    url.searchParams.set('tiktok', msg)
    const r = NextResponse.redirect(url)
    r.cookies.delete('tt_oauth_state')
    return r
  }

  if (erro) {
    // O usuário recusou ou o TikTok falhou. error_description não carrega token.
    return paraConfiguracoes(`recusado: ${p.get('error_description') ?? erro}`)
  }
  if (!code || !state) return paraConfiguracoes('callback sem code ou state')

  if (!conferirStateTikTok(request.cookies.get('tt_oauth_state')?.value, state)) {
    // State inválido = a ida não foi nossa. Não trocamos o code de ninguém.
    return paraConfiguracoes('state invalido')
  }

  try {
    const tokens = await trocarCodePorToken(code)
    await salvarConexaoTikTok(tokens)
    console.log(`[tiktok] conta conectada · open_id ${tokens.open_id.slice(0, 12)}…`)
    return paraConfiguracoes('conectado')
  } catch (e) {
    console.error('[tiktok] falha na troca do code:', e instanceof Error ? e.message : e)
    return paraConfiguracoes('falha na troca do code')
  }
}
