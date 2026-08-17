/**
 * Sessão do painel: token assinado em cookie httpOnly.
 *
 * Este módulo NÃO importa `server-only` de propósito — o middleware precisa
 * dele, e roda no runtime Edge. Por isso usa Web Crypto (disponível no Edge)
 * em vez de `node:crypto`, e lê `process.env` direto em vez de `lib/env`, que
 * é `server-only`.
 *
 * Não há segredo do cliente aqui: o token é assinado, não cifrado, e só carrega
 * usuário, papel e validade. A senha nunca entra nele.
 */

export const COOKIE_SESSAO = 'vn_sessao'
export const DURACAO_SESSAO_DIAS = 14

export type Papel = 'ADMIN' | 'OPERADOR'

export interface Sessao {
  usuario: string
  papel: Papel
  /** Epoch em segundos. */
  exp: number
}

const ENC = new TextEncoder()

function b64url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function deB64url(s: string): Uint8Array<ArrayBuffer> {
  const t = s.replace(/-/g, '+').replace(/_/g, '/')
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : ''
  const bin = atob(t + pad)
  // Alocado sobre ArrayBuffer explícito: o TS estrito distingue de
  // ArrayBufferLike, e crypto.subtle exige o primeiro.
  const out = new Uint8Array(new ArrayBuffer(bin.length))
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Chave HMAC derivada da TOKEN_ENCRYPTION_KEY com separação de domínio.
 *
 * Deriva em vez de exigir uma variável nova: uma env var a mais é um passo a
 * mais para esquecer na Vercel, e já vimos essa falha duas vezes neste projeto.
 * O sufixo garante que esta chave não é a mesma usada para cifrar tokens da
 * Meta — assinar sessão e cifrar token não compartilham material.
 */
let cache: Promise<CryptoKey> | null = null
function chave(): Promise<CryptoKey> {
  cache ??= (async () => {
    const base = process.env.TOKEN_ENCRYPTION_KEY
    if (!base) throw new Error('TOKEN_ENCRYPTION_KEY ausente: a sessão não pode ser assinada.')
    const material = await crypto.subtle.digest('SHA-256', ENC.encode(`${base}|painel-sessao-v1`))
    return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ])
  })()
  return cache
}

export async function assinarSessao(usuario: string, papel: Papel): Promise<string> {
  const s: Sessao = {
    usuario,
    papel,
    exp: Math.floor(Date.now() / 1000) + DURACAO_SESSAO_DIAS * 86_400,
  }
  const corpo = b64url(ENC.encode(JSON.stringify(s)))
  const assinatura = new Uint8Array(
    await crypto.subtle.sign('HMAC', await chave(), ENC.encode(corpo)),
  )
  return `${corpo}.${b64url(assinatura)}`
}

/** Devolve a sessão ou `null`. Nunca lança: token inválido é ausência de sessão. */
export async function lerSessao(token: string | undefined | null): Promise<Sessao | null> {
  if (!token) return null
  const ponto = token.indexOf('.')
  if (ponto <= 0) return null
  const corpo = token.slice(0, ponto)
  const assinatura = token.slice(ponto + 1)

  try {
    // Verificação da assinatura ANTES de olhar o conteúdo: sem isso qualquer
    // pessoa escreveria papel ADMIN no próprio cookie.
    const valida = await crypto.subtle.verify(
      'HMAC',
      await chave(),
      deB64url(assinatura),
      ENC.encode(corpo),
    )
    if (!valida) return null

    const s = JSON.parse(new TextDecoder().decode(deB64url(corpo))) as Sessao
    if (typeof s.exp !== 'number' || s.exp * 1000 <= Date.now()) return null
    if (s.papel !== 'ADMIN' && s.papel !== 'OPERADOR') return null
    if (typeof s.usuario !== 'string' || !s.usuario) return null
    return s
  } catch {
    return null
  }
}
