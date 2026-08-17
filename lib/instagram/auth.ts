import 'server-only'
import { createHmac, randomBytes } from 'node:crypto'
import { env, callbacks } from '../env'
import { metaGet } from './meta-client'

/**
 * OAuth — Instagram API with Facebook Login.
 *
 * Cadeia completa:
 *   dialog/oauth → code → token de usuário CURTO → token de usuário LONGO (60d)
 *   → /me/accounts → Page Access Token (PERMANENTE) + conta profissional do IG
 *
 * Verificado em 17/08/2026: o Page Token derivado de um user token de longa
 * duração vem com `expires_at = 0` — não expira. Derivado de um token curto,
 * expira junto com ele. Por isso a troca pelo token longo é obrigatória e
 * acontece ANTES de derivar o Page Token.
 */

const DIALOG = 'https://www.facebook.com'

// ---------------------------------------------------------------- state (CSRF)

export function createState(): { state: string; signed: string } {
  const state = randomBytes(16).toString('hex')
  const signature = createHmac('sha256', env.metaAppSecret).update(state).digest('hex')
  return { state, signed: `${state}.${signature}` }
}

export function verifyState(received: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false
  const [state, signature] = cookieValue.split('.')
  if (!state || !signature || state !== received) return false
  const expected = createHmac('sha256', env.metaAppSecret).update(state).digest('hex')
  return signature === expected
}

export function authorizeUrl(state: string): string {
  const url = new URL(`${DIALOG}/${env.metaApiVersion}/dialog/oauth`)
  url.searchParams.set('client_id', env.metaAppId)
  url.searchParams.set('redirect_uri', callbacks.oauth)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', env.metaScopes)
  return url.toString()
}

// ---------------------------------------------------------------- troca de token

interface TokenResponse {
  access_token: string
  token_type?: string
  expires_in?: number
}

export async function exchangeCodeForUserToken(code: string): Promise<string> {
  const res = await metaGet<TokenResponse>('oauth/access_token', '', {
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: callbacks.oauth,
    code,
  })
  return res.access_token
}

/** Sem esta troca o Page Token herda a validade curta. Não é opcional. */
export async function exchangeForLongLivedToken(
  shortLived: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const res = await metaGet<TokenResponse>('oauth/access_token', '', {
    grant_type: 'fb_exchange_token',
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    fb_exchange_token: shortLived,
  })
  return {
    token: res.access_token,
    expiresAt: res.expires_in ? new Date(Date.now() + res.expires_in * 1000) : null,
  }
}

// ---------------------------------------------------------------- resolução da Página

export interface ResolvedAccount {
  pageId: string
  pageName: string
  pageAccessToken: string
  instagramUserId: string
  username: string
}

interface AccountsResponse {
  data: Array<{
    id: string
    name: string
    access_token: string
    instagram_business_account?: { id: string; username?: string }
  }>
}

export class PageSelectionError extends Error {
  readonly candidates: Array<{ pageId: string; pageName: string; igId: string; username: string }>
  constructor(message: string, candidates: PageSelectionError['candidates']) {
    super(message)
    this.name = 'PageSelectionError'
    this.candidates = candidates
  }
}

/**
 * Encontra a Página cuja conta profissional do Instagram é a que administramos.
 *
 * Esta conta tem 8 Páginas, várias com Instagram vinculado. Escolher "a primeira
 * com Instagram" já selecionou a conta errada uma vez durante os testes — por
 * isso a seleção é EXPLÍCITA: quando META_TARGET_IG_USER_ID está definido, só
 * aquele ID é aceito; sem ele, exigimos que exista exatamente uma candidata.
 * Ambiguidade vira erro, nunca um palpite.
 */
export async function resolveAccount(userToken: string): Promise<ResolvedAccount> {
  const res = await metaGet<AccountsResponse>('me/accounts', userToken, {
    fields: 'id,name,access_token,instagram_business_account{id,username}',
    limit: 100,
  })

  const candidates = (res.data ?? [])
    .filter((p) => p.instagram_business_account?.id)
    .map((p) => ({
      pageId: p.id,
      pageName: p.name,
      pageAccessToken: p.access_token,
      instagramUserId: p.instagram_business_account!.id,
      username: p.instagram_business_account!.username ?? '',
    }))

  if (candidates.length === 0) {
    throw new PageSelectionError(
      'Nenhuma Página do Facebook acessível tem uma conta profissional do Instagram vinculada. ' +
        'Verifique se as permissões instagram_basic e pages_show_list foram concedidas.',
      [],
    )
  }

  const target = process.env.META_TARGET_IG_USER_ID?.trim()
  if (target) {
    const match = candidates.find((c) => c.instagramUserId === target)
    if (!match) {
      throw new PageSelectionError(
        `Nenhuma das ${candidates.length} Páginas aponta para a conta configurada em ` +
          `META_TARGET_IG_USER_ID (${target}).`,
        candidates.map(({ pageId, pageName, instagramUserId, username }) => ({
          pageId,
          pageName,
          igId: instagramUserId,
          username,
        })),
      )
    }
    return match
  }

  if (candidates.length > 1) {
    throw new PageSelectionError(
      `${candidates.length} Páginas têm Instagram vinculado. Defina META_TARGET_IG_USER_ID ` +
        'para eliminar a ambiguidade — escolher automaticamente arriscaria conectar a conta errada.',
      candidates.map(({ pageId, pageName, instagramUserId, username }) => ({
        pageId,
        pageName,
        igId: instagramUserId,
        username,
      })),
    )
  }

  return candidates[0]!
}

// ---------------------------------------------------------------- perfil

export interface InstagramProfile {
  id: string
  username: string
  name?: string
  profile_picture_url?: string
  followers_count?: number
  follows_count?: number
  media_count?: number
}

export async function fetchProfile(
  instagramUserId: string,
  pageToken: string,
): Promise<InstagramProfile> {
  return metaGet<InstagramProfile>(instagramUserId, pageToken, {
    fields: 'id,username,name,profile_picture_url,followers_count,follows_count,media_count',
  })
}

/** Confirma quais permissões foram de fato concedidas — nem sempre são as pedidas. */
export async function fetchGrantedScopes(userToken: string): Promise<string[]> {
  const res = await metaGet<{ data: Array<{ permission: string; status: string }> }>(
    'me/permissions',
    userToken,
  )
  return (res.data ?? []).filter((p) => p.status === 'granted').map((p) => p.permission)
}
