import 'server-only'
import { db, startSyncRun } from '../db'
import { decryptToken, fromPgBytea } from '../crypto'
import { fetchProfile } from './auth'
import { MetaError } from './errors'

/**
 * Conta conectada: leitura do estado e sincronização do perfil.
 *
 * O snapshot é o núcleo do produto — a Meta devolve o estado atual, e só nós
 * guardamos a série. Cada execução grava um ponto novo; nada é sobrescrito.
 */

export interface ConnectedAccount {
  id: string
  instagramUserId: string
  username: string
  name: string | null
  profilePictureUrl: string | null
  followersCount: number | null
  followsCount: number | null
  mediaCount: number | null
  facebookPageName: string | null
  facebookPageId: string | null
  scopes: string[]
  connectionStatus: 'CONNECTED' | 'DISCONNECTED' | 'TOKEN_EXPIRED' | 'ERROR'
  lastSyncAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  lastErrorAt: string | null
  hasToken: boolean
}

export async function getConnectedAccount(): Promise<ConnectedAccount | null> {
  const { data } = await db()
    .from('instagram_accounts')
    // String literal única: concatenar com `+` produz o tipo `string` e impede o
    // supabase-js de inferir o formato da linha, degradando tudo para erro.
    .select(
      'id,instagram_user_id,username,name,profile_picture_url,followers_count,follows_count,media_count,facebook_page_id,facebook_page_name,scopes,connection_status,last_sync_at,last_error_code,last_error_message,last_error_at,page_access_token_encrypted',
    )
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null

  return {
    id: data.id,
    instagramUserId: data.instagram_user_id,
    username: data.username,
    name: data.name,
    profilePictureUrl: data.profile_picture_url,
    followersCount: data.followers_count,
    followsCount: data.follows_count,
    mediaCount: data.media_count,
    facebookPageId: data.facebook_page_id,
    facebookPageName: data.facebook_page_name,
    scopes: data.scopes ?? [],
    connectionStatus: data.connection_status,
    lastSyncAt: data.last_sync_at,
    lastErrorCode: data.last_error_code,
    lastErrorMessage: data.last_error_message,
    lastErrorAt: data.last_error_at,
    hasToken: data.page_access_token_encrypted !== null,
  }
}

/** Devolve o Page Token em claro. Só o servidor chama isto. */
export async function getPageToken(accountId: string): Promise<string> {
  const { data, error } = await db()
    .from('instagram_accounts')
    .select('page_access_token_encrypted')
    .eq('id', accountId)
    .single()

  if (error || !data?.page_access_token_encrypted) {
    throw new Error('Conta sem token armazenado. É necessário reconectar o Instagram.')
  }
  return decryptToken(fromPgBytea(data.page_access_token_encrypted)!)
}

export async function recordConnectionError(accountId: string, error: unknown) {
  const isMeta = error instanceof MetaError
  await db()
    .from('instagram_accounts')
    .update({
      connection_status: isMeta && error.errorClass === 'TOKEN' ? 'TOKEN_EXPIRED' : 'ERROR',
      last_error_code: isMeta ? String(error.code ?? error.httpStatus) : null,
      last_error_message: error instanceof Error ? error.message.slice(0, 500) : String(error),
      last_error_at: new Date().toISOString(),
    })
    .eq('id', accountId)
}

/**
 * Atualiza o perfil e grava um snapshot.
 *
 * IDEMPOTÊNCIA: `account_snapshots` tem unique (conta, captured_at). O horário é
 * truncado ao minuto para que duas execuções no mesmo minuto — um clique duplo,
 * um retry do cron — colidam e sejam ignoradas em vez de criarem dois pontos
 * representando o mesmo instante.
 */
export async function syncAccount(source: 'cron_hourly' | 'manual' = 'manual') {
  const account = await getConnectedAccount()
  if (!account) throw new Error('Nenhuma conta do Instagram conectada.')

  const run = await startSyncRun(`account:${source}`)
  try {
    const token = await getPageToken(account.id)
    const profile = await fetchProfile(account.instagramUserId, token)
    const now = new Date()
    const minute = new Date(Math.floor(now.getTime() / 60000) * 60000).toISOString()

    await db()
      .from('instagram_accounts')
      .update({
        username: profile.username,
        name: profile.name ?? null,
        profile_picture_url: profile.profile_picture_url ?? null,
        followers_count: profile.followers_count ?? null,
        follows_count: profile.follows_count ?? null,
        media_count: profile.media_count ?? null,
        connection_status: 'CONNECTED',
        last_sync_at: now.toISOString(),
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
      })
      .eq('id', account.id)

    await db()
      .from('account_snapshots')
      .upsert(
        {
          instagram_account_id: account.id,
          followers_count: profile.followers_count ?? null,
          follows_count: profile.follows_count ?? null,
          media_count: profile.media_count ?? null,
          captured_at: minute,
          source,
        },
        { onConflict: 'instagram_account_id,captured_at', ignoreDuplicates: true },
      )

    await run.finish('SUCCESS', { records: 1, requests: 1 })
    return { username: profile.username, followers: profile.followers_count ?? null }
  } catch (error) {
    await recordConnectionError(account.id, error)
    await run.finish('FAILED', {
      errorCode: error instanceof MetaError ? String(error.code) : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

export async function getLastSyncRuns(limit = 5) {
  const { data } = await db()
    .from('sync_runs')
    .select('id,type,status,started_at,completed_at,records_processed,api_requests,error_message')
    .order('started_at', { ascending: false })
    .limit(limit)
  return data ?? []
}
