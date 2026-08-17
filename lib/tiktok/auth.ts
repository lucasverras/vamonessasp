import 'server-only'
import { createHmac, randomBytes } from 'node:crypto'
import { db } from '../db'
import { encryptToken, fromPgBytea, decryptToken, toPgBytea } from '../crypto'
import { env } from '../env'

/**
 * OAuth do TikTok — Login Kit for Web + gestão de tokens.
 *
 * Endpoints conforme a documentação oficial (verificada em 17/08/2026):
 *   autorização  https://www.tiktok.com/v2/auth/authorize/
 *   token        POST https://open.tiktokapis.com/v2/oauth/token/  (form-urlencoded)
 *   revogação    POST https://open.tiktokapis.com/v2/oauth/revoke/
 *
 * Vida dos tokens: access 24h, refresh 365 dias. Diferente da Meta, renovar é
 * rotina — qualquer chamada à Display API passa por getTikTokAccessToken(),
 * que renova sozinha quando preciso.
 */

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const TOKEN_URL = 'https://open.tiktokapis.com/v2/oauth/token/'
const REVOKE_URL = 'https://open.tiktokapis.com/v2/oauth/revoke/'

/** Só analytics: perfil, estatísticas de conta e lista de vídeos públicos. */
export const TIKTOK_SCOPES = ['user.info.basic', 'user.info.stats', 'video.list'] as const

// ---------------------------------------------------------------- state (CSRF)

export function criarStateTikTok(): { state: string; signed: string } {
  const state = randomBytes(16).toString('hex')
  const signature = createHmac('sha256', env.tiktokClientSecret).update(state).digest('hex')
  return { state, signed: `${state}.${signature}` }
}

export function conferirStateTikTok(cookieValue: string | undefined, received: string): boolean {
  if (!cookieValue) return false
  const [state, signature] = cookieValue.split('.')
  if (!state || !signature || state !== received) return false
  const expected = createHmac('sha256', env.tiktokClientSecret).update(state).digest('hex')
  return signature === expected
}

// ---------------------------------------------------------------- autorização

export function urlDeAutorizacaoTikTok(state: string): string {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_key', env.tiktokClientKey)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', TIKTOK_SCOPES.join(','))
  // Getter único: a mesma string usada na troca do code (exigência do TikTok).
  url.searchParams.set('redirect_uri', env.tiktokRedirectUri)
  url.searchParams.set('state', state)
  return url.toString()
}

// ---------------------------------------------------------------- tokens

interface RespostaToken {
  access_token: string
  expires_in: number
  refresh_token: string
  refresh_expires_in: number
  open_id: string
  scope: string
  token_type: string
  error?: string
  error_description?: string
}

async function chamarTokenEndpoint(body: Record<string, string>): Promise<RespostaToken> {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    cache: 'no-store',
  })
  const j = (await r.json()) as RespostaToken
  if (!r.ok || j.error) {
    // error_description é seguro de logar; tokens nunca aparecem aqui.
    throw new Error(`TikTok token endpoint: ${j.error ?? r.status} — ${j.error_description ?? ''}`)
  }
  return j
}

export async function trocarCodePorToken(code: string): Promise<RespostaToken> {
  return chamarTokenEndpoint({
    client_key: env.tiktokClientKey,
    client_secret: env.tiktokClientSecret,
    code,
    grant_type: 'authorization_code',
    // Obrigatório e idêntico ao da autorização — mesmo getter.
    redirect_uri: env.tiktokRedirectUri,
  })
}

export async function renovarToken(refreshToken: string): Promise<RespostaToken> {
  return chamarTokenEndpoint({
    client_key: env.tiktokClientKey,
    client_secret: env.tiktokClientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
}

// ---------------------------------------------------------------- persistência

export async function salvarConexaoTikTok(t: RespostaToken) {
  const agora = Date.now()
  const { error } = await db()
    .from('tiktok_accounts')
    .upsert(
      {
        open_id: t.open_id,
        scopes: t.scope.split(',').map((s) => s.trim()),
        access_token_encrypted: toPgBytea(encryptToken(t.access_token)),
        refresh_token_encrypted: toPgBytea(encryptToken(t.refresh_token)),
        access_token_expires_at: new Date(agora + t.expires_in * 1000).toISOString(),
        refresh_token_expires_at: new Date(agora + t.refresh_expires_in * 1000).toISOString(),
        connection_status: 'CONNECTED',
        revoked_at: null,
        revoked_reason: null,
        last_error_code: null,
        last_error_message: null,
      },
      { onConflict: 'open_id' },
    )
  if (error) throw new Error(`Falha ao salvar conexão TikTok: ${error.message}`)
}

/**
 * Devolve um access token VÁLIDO, renovando se faltar menos de 5 minutos.
 * Toda chamada à Display API deve obter o token por aqui, nunca do banco direto.
 */
export async function getTikTokAccessToken(openId?: string): Promise<{
  token: string
  openId: string
}> {
  let q = db()
    .from('tiktok_accounts')
    .select(
      'open_id,access_token_encrypted,refresh_token_encrypted,access_token_expires_at,connection_status',
    )
    .eq('connection_status', 'CONNECTED')
  if (openId) q = q.eq('open_id', openId)
  const { data: acc } = await q.limit(1).maybeSingle()

  if (!acc) throw new Error('Nenhuma conta TikTok conectada.')

  const expira = acc.access_token_expires_at ? new Date(acc.access_token_expires_at).getTime() : 0
  if (expira - Date.now() > 5 * 60_000) {
    const cifrado = fromPgBytea(acc.access_token_encrypted as string)
    if (!cifrado) throw new Error('Conta TikTok sem access token gravado.')
    return { token: decryptToken(cifrado), openId: acc.open_id as string }
  }

  const refreshCifrado = fromPgBytea(acc.refresh_token_encrypted as string)
  if (!refreshCifrado) throw new Error('Conta TikTok sem refresh token gravado.')

  const novo = await renovarToken(decryptToken(refreshCifrado))
  await salvarConexaoTikTok(novo)
  return { token: novo.access_token, openId: novo.open_id }
}

export async function revogarTikTok(openId: string): Promise<void> {
  const { token } = await getTikTokAccessToken(openId)
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: env.tiktokClientKey,
      client_secret: env.tiktokClientSecret,
      token,
    }),
    cache: 'no-store',
  })
  await marcarRevogada(openId, null)
}

/** Usada pelo webhook authorization.removed e pela revogação ativa. */
export async function marcarRevogada(openId: string, reason: number | null) {
  await db()
    .from('tiktok_accounts')
    .update({
      connection_status: 'REVOKED',
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
      // Tokens revogados são lixo perigoso: apagados, não mantidos.
      access_token_encrypted: null,
      refresh_token_encrypted: null,
      access_token_expires_at: null,
      refresh_token_expires_at: null,
    })
    .eq('open_id', openId)
}
