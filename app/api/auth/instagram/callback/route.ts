import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { encryptToken, toPgBytea } from '@/lib/crypto'
import { env } from '@/lib/env'
import {
  PageSelectionError,
  exchangeCodeForUserToken,
  exchangeForLongLivedToken,
  fetchGrantedScopes,
  fetchProfile,
  resolveAccount,
  verifyState,
} from '@/lib/instagram/auth'
import { MetaError } from '@/lib/instagram/errors'

export const dynamic = 'force-dynamic'

const SETTINGS = '/configuracoes/instagram'

function fail(reason: string, detail?: string) {
  const url = new URL(SETTINGS, env.appUrl)
  url.searchParams.set('erro', reason)
  if (detail) url.searchParams.set('detalhe', detail.slice(0, 300))
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams

  // O usuário pode ter cancelado na tela da Meta.
  if (params.get('error')) {
    return fail('autorizacao_negada', params.get('error_description') ?? undefined)
  }

  const code = params.get('code')
  const state = params.get('state')
  if (!code || !state) return fail('resposta_incompleta')

  if (!verifyState(state, request.cookies.get('ig_oauth_state')?.value)) {
    return fail('state_invalido')
  }

  try {
    // 1. code → token curto → token longo (60 dias).
    //    A troca é obrigatória: o Page Token herda a validade do token de
    //    usuário, e derivado de um token curto expiraria em horas.
    const shortLived = await exchangeCodeForUserToken(code)
    const { token: userToken, expiresAt } = await exchangeForLongLivedToken(shortLived)

    // 2. Página → Page Token permanente + conta profissional do Instagram.
    const account = await resolveAccount(userToken)

    // 3. Perfil e permissões realmente concedidas.
    const [profile, scopes] = await Promise.all([
      fetchProfile(account.instagramUserId, account.pageAccessToken),
      fetchGrantedScopes(userToken),
    ])

    // 4. Persistência. Tokens criptografados; nada em texto puro.
    const now = new Date().toISOString()
    const { data: saved, error } = await db()
      .from('instagram_accounts')
      .upsert(
        {
          instagram_user_id: account.instagramUserId,
          username: profile.username,
          name: profile.name ?? null,
          profile_picture_url: profile.profile_picture_url ?? null,
          followers_count: profile.followers_count ?? null,
          follows_count: profile.follows_count ?? null,
          media_count: profile.media_count ?? null,
          facebook_page_id: account.pageId,
          facebook_page_name: account.pageName,
          page_access_token_encrypted: toPgBytea(encryptToken(account.pageAccessToken)),
          user_access_token_encrypted: toPgBytea(encryptToken(userToken)),
          user_token_expires_at: expiresAt?.toISOString() ?? null,
          scopes,
          connection_status: 'CONNECTED',
          last_error_code: null,
          last_error_message: null,
          last_error_at: null,
          updated_at: now,
        },
        { onConflict: 'instagram_user_id' },
      )
      .select('id')
      .single()

    if (error) return fail('falha_ao_salvar', error.message)

    // 5. Primeiro snapshot: marca o instante da conexão na série histórica.
    //    A partir daqui o crescimento passa a ser medido por nós.
    await db()
      .from('account_snapshots')
      .insert({
        instagram_account_id: saved.id,
        followers_count: profile.followers_count ?? null,
        follows_count: profile.follows_count ?? null,
        media_count: profile.media_count ?? null,
        source: 'oauth_connect',
      })

    const done = new URL(SETTINGS, env.appUrl)
    done.searchParams.set('conectado', profile.username)
    const response = NextResponse.redirect(done)
    response.cookies.delete('ig_oauth_state')
    return response
  } catch (error) {
    if (error instanceof PageSelectionError) {
      return fail('pagina_ambigua', error.message)
    }
    if (error instanceof MetaError) {
      console.error('[oauth] erro da Meta', error.toLog())
      return fail('erro_da_meta', error.message)
    }
    console.error('[oauth] erro inesperado', error)
    return fail('erro_inesperado')
  }
}
