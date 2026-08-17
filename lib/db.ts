import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Cliente Supabase com service role.
 *
 * Ignora RLS por definição — por isso vive atrás de `server-only` e nunca é
 * exposto a componentes de cliente. Toda escrita do sistema passa por aqui;
 * o frontend lê pelo cliente autenticado, limitado pelas policies.
 */

let cached: SupabaseClient | null = null

export function db(): SupabaseClient {
  if (!cached) {
    cached = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'X-Client-Info': 'painel-vamo-nessa' } },
    })
  }
  return cached
}

/**
 * Registra uma execução de sincronização e devolve helpers para fechá-la.
 * Todo job de sync usa isto — é o que permite responder "quando foi o último
 * sync, quantos registros, quantas chamadas à API, qual erro".
 */
export async function startSyncRun(type: string) {
  const { data, error } = await db()
    .from('sync_runs')
    .insert({ type, status: 'RUNNING' })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao registrar sync_run: ${error.message}`)
  const id = data.id as number

  return {
    id,
    async finish(
      status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
      stats: { records?: number; requests?: number; errorCode?: string; errorMessage?: string } = {},
    ) {
      await db()
        .from('sync_runs')
        .update({
          status,
          completed_at: new Date().toISOString(),
          records_processed: stats.records ?? 0,
          api_requests: stats.requests ?? 0,
          error_code: stats.errorCode ?? null,
          error_message: stats.errorMessage ?? null,
        })
        .eq('id', id)
    },
  }
}
