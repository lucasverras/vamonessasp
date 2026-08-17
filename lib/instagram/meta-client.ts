import 'server-only'
import { env } from '../env'
import { MetaError, type MetaErrorShape } from './errors'

/**
 * Cliente HTTP da Meta. Única porta de saída do sistema para a API.
 *
 * Arquitetura: NENHUM componente React importa este módulo. Só rotas de API,
 * server actions e cron jobs. O frontend lê exclusivamente do Supabase.
 *
 * Host: graph.facebook.com (Instagram API with Facebook Login).
 * Decisão e evidência em docs/decisao-login.md.
 */

const HOST = 'https://graph.facebook.com'

/** Consumo reportado pela Meta em X-Business-Use-Case-Usage. */
export interface UsageSnapshot {
  callCount?: number
  totalTime?: number
  totalCpuTime?: number
  estimatedTimeToRegainAccess?: number
}

export interface MetaResponse<T> {
  data: T
  usage: UsageSnapshot | null
}

let lastUsage: UsageSnapshot | null = null

/** Último consumo reportado. O worker usa para desacelerar antes de levar 80002. */
export function getLastUsage(): UsageSnapshot | null {
  return lastUsage
}

function parseUsage(headers: Headers): UsageSnapshot | null {
  const raw = headers.get('x-business-use-case-usage')
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<Record<string, number>>>
    const first = Object.values(parsed)[0]?.[0]
    if (!first) return null
    return {
      callCount: first.call_count,
      totalTime: first.total_time,
      totalCpuTime: first.total_cputime,
      estimatedTimeToRegainAccess: first.estimated_time_to_regain_access,
    }
  } catch {
    return null
  }
}

interface CallOptions {
  token: string
  params?: Record<string, string | number | boolean | undefined>
  method?: 'GET' | 'POST' | 'DELETE'
  body?: Record<string, unknown>
  version?: string
  /** Rótulo para log e para sync_runs. Nunca inclui token. */
  label?: string
}

async function call<T>(path: string, options: CallOptions): Promise<MetaResponse<T>> {
  const version = options.version ?? env.metaApiVersion
  const method = options.method ?? 'GET'
  const url = new URL(`${HOST}/${version}/${path.replace(/^\//, '')}`)

  for (const [k, v] of Object.entries(options.params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v))
  }

  const init: RequestInit = { method, cache: 'no-store' }
  if (method === 'GET') {
    url.searchParams.set('access_token', options.token)
  } else {
    const form = new URLSearchParams()
    for (const [k, v] of Object.entries(options.body ?? {})) {
      form.set(k, typeof v === 'string' ? v : JSON.stringify(v))
    }
    form.set('access_token', options.token)
    init.body = form
    init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' }
  }

  // Endpoint sem token e sem querystring, para log e mensagens de erro.
  const safeEndpoint = `${method} /${version}/${path}`

  const response = await fetch(url, init)
  lastUsage = parseUsage(response.headers)

  const text = await response.text()
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : {}
  } catch {
    throw new MetaError(response.status, safeEndpoint, {
      message: `Resposta não-JSON da Meta: ${text.slice(0, 200)}`,
    })
  }

  const asError = (payload as { error?: MetaErrorShape }).error
  if (asError || !response.ok) {
    throw new MetaError(response.status, safeEndpoint, asError ?? { message: text.slice(0, 200) })
  }

  return { data: payload as T, usage: lastUsage }
}

export async function metaGet<T>(
  path: string,
  token: string,
  params?: CallOptions['params'],
  version?: string,
): Promise<T> {
  const { data } = await call<T>(path, { token, params, version })
  return data
}

export async function metaPost<T>(
  path: string,
  token: string,
  body: Record<string, unknown>,
  version?: string,
): Promise<T> {
  const { data } = await call<T>(path, { token, method: 'POST', body, version })
  return data
}

interface Paged<T> {
  data: T[]
  paging?: { cursors?: { after?: string }; next?: string }
}

/**
 * Percorre todas as páginas de uma coleção.
 *
 * `maxPages` existe como trava de segurança contra loop infinito, não como
 * limite de negócio. Quando ele é atingido, o chamador PRECISA registrar que a
 * coleta ficou incompleta — truncar em silêncio faz um sync parcial parecer
 * completo, que é o pior resultado possível.
 */
export async function metaGetAll<T>(
  path: string,
  token: string,
  params?: CallOptions['params'],
  maxPages = 50,
): Promise<{ items: T[]; complete: boolean; requests: number }> {
  const items: T[] = []
  let after: string | undefined
  let pages = 0

  for (;;) {
    const page = await metaGet<Paged<T>>(path, token, { ...params, after })
    items.push(...(page.data ?? []))
    pages += 1
    after = page.paging?.cursors?.after
    if (!after || !page.paging?.next) return { items, complete: true, requests: pages }
    if (pages >= maxPages) return { items, complete: false, requests: pages }
  }
}
