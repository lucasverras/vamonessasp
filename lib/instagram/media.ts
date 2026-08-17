import 'server-only'
import { db, startSyncRun } from '../db'
import { getConnectedAccount, getPageToken, recordConnectionError } from './account'
import { MetaError } from './errors'
import { metaGet, metaGetAll } from './meta-client'

/**
 * Sincronização de conteúdos e de insights.
 *
 * IDEMPOTÊNCIA — exigência do produto, garantida em dois níveis:
 *   mídia    → upsert por instagram_media_id (UNIQUE). Reexecutar atualiza.
 *   insights → unique (media_id, captured_at) com captured_at truncado ao
 *              minuto. Duas execuções no mesmo minuto colidem e a segunda é
 *              ignorada, em vez de criarem dois pontos para o mesmo instante.
 */

const MEDIA_FIELDS =
  'id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,shortcode,timestamp,like_count,comments_count,is_shared_to_feed'

/**
 * Métricas por tipo de mídia. Estas listas NÃO são a documentação: são o que
 * verificamos que esta conta devolve de fato, em ~900 chamadas reais.
 * Ver docs/metricas-disponibilidade.md.
 *
 * Pedir uma métrica não suportada faz a chamada INTEIRA falhar, e não apenas
 * aquela métrica — daí manter listas separadas por tipo.
 */
const METRICS: Record<string, string[]> = {
  REELS: [
    'views', 'reach', 'likes', 'comments', 'shares', 'saved', 'reposts',
    'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time',
    'reels_skip_rate',
  ],
  FEED: [
    'views', 'reach', 'likes', 'comments', 'shares', 'saved', 'reposts',
    'total_interactions', 'follows', 'profile_visits', 'profile_activity',
  ],
}

/** Campos agregados que só o Facebook Login expõe (incluem FB e impulsionamento). */
const AGGREGATE_FIELDS = 'total_views_count,total_like_count,total_comments_count,saved_count,shares_count,reposts_count'

interface ApiMedia {
  id: string
  caption?: string
  media_type?: string
  media_product_type?: string
  media_url?: string
  thumbnail_url?: string
  permalink?: string
  shortcode?: string
  timestamp: string
  is_shared_to_feed?: boolean
}

function minuteStamp(): string {
  return new Date(Math.floor(Date.now() / 60000) * 60000).toISOString()
}

/** Importa todos os conteúdos, com paginação. */
export async function syncMedia() {
  const account = await getConnectedAccount()
  if (!account) throw new Error('Nenhuma conta conectada.')

  const run = await startSyncRun('media')
  try {
    const token = await getPageToken(account.id)
    const { items, complete, requests } = await metaGetAll<ApiMedia>(
      `${account.instagramUserId}/media`,
      token,
      { fields: MEDIA_FIELDS, limit: 100 },
    )

    const rows = items.map((m) => ({
      instagram_media_id: m.id,
      instagram_account_id: account.id,
      media_type: m.media_type ?? null,
      media_product_type: m.media_product_type ?? null,
      caption: m.caption ?? null,
      permalink: m.permalink ?? null,
      shortcode: m.shortcode ?? null,
      thumbnail_url: m.thumbnail_url ?? null,
      media_url: m.media_url ?? null,
      is_shared_to_feed: m.is_shared_to_feed ?? null,
      published_at: m.timestamp,
    }))

    // Lotes de 100 para não estourar o limite de payload do PostgREST.
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await db()
        .from('instagram_media')
        .upsert(rows.slice(i, i + 100), { onConflict: 'instagram_media_id' })
      if (error) throw new Error(`Falha ao gravar mídias: ${error.message}`)
    }

    // Coleta incompleta NUNCA é silenciosa: PARTIAL deixa isso visível no painel.
    await run.finish(complete ? 'SUCCESS' : 'PARTIAL', {
      records: rows.length,
      requests,
      errorMessage: complete
        ? undefined
        : 'Paginação interrompida pela trava de segurança; a importação está incompleta.',
    })

    return { total: rows.length, complete }
  } catch (error) {
    await recordConnectionError(account.id, error)
    await run.finish('FAILED', {
      errorCode: error instanceof MetaError ? String(error.code) : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

interface InsightsResponse {
  data: Array<{ name: string; values?: Array<{ value: number }>; total_value?: { value: number } }>
}

function readMetrics(res: InsightsResponse): Record<string, number> {
  const out: Record<string, number> = {}
  for (const entry of res.data ?? []) {
    const value = entry.values?.[0]?.value ?? entry.total_value?.value
    if (typeof value === 'number') out[entry.name] = value
  }
  return out
}

/**
 * Coleta insights de um conjunto de mídias.
 *
 * `since` limita a janela: insights mudam rápido nas primeiras horas e ficam
 * praticamente estáveis depois, então não faz sentido recoletar 255 conteúdos a
 * cada hora — é desperdício de rate limit.
 */
export async function syncMediaInsights(options: { limit?: number; sinceDays?: number } = {}) {
  const account = await getConnectedAccount()
  if (!account) throw new Error('Nenhuma conta conectada.')

  const run = await startSyncRun('media_insights')
  let requests = 0
  let processed = 0
  let failed = 0

  try {
    const token = await getPageToken(account.id)

    let query = db()
      .from('instagram_media')
      .select('id,instagram_media_id,media_product_type')
      .is('deleted_at', null)
      .order('published_at', { ascending: false })

    if (options.sinceDays) {
      const since = new Date(Date.now() - options.sinceDays * 86400_000).toISOString()
      query = query.gte('published_at', since)
    }
    if (options.limit) query = query.limit(options.limit)

    const { data: medias, error } = await query
    if (error) throw new Error(`Falha ao ler mídias: ${error.message}`)

    const capturedAt = minuteStamp()

    for (const media of medias ?? []) {
      const type = media.media_product_type ?? 'REELS'
      const wanted = METRICS[type] ?? METRICS.REELS!
      let values: Record<string, number> = {}
      const unavailable: string[] = []

      try {
        const res = await metaGet<InsightsResponse>(`${media.instagram_media_id}/insights`, token, {
          metric: wanted.join(','),
        })
        requests += 1
        values = readMetrics(res)
      } catch {
        // Uma métrica recusada derruba a chamada inteira. Cai para uma métrica
        // por vez para salvar o que existe e registrar exatamente o que faltou,
        // em vez de perder o conteúdo todo.
        requests += 1
        for (const metric of wanted) {
          try {
            const res = await metaGet<InsightsResponse>(
              `${media.instagram_media_id}/insights`,
              token,
              { metric },
            )
            requests += 1
            Object.assign(values, readMetrics(res))
          } catch {
            requests += 1
            unavailable.push(metric)
          }
        }
      }

      // Agregados vêm do objeto Media, não de /insights.
      let aggregates: Record<string, number> = {}
      try {
        aggregates = await metaGet<Record<string, number>>(media.instagram_media_id, token, {
          fields: AGGREGATE_FIELDS,
        })
        requests += 1
      } catch {
        requests += 1
      }

      const pick = (k: string): number | null => (k in values ? values[k]! : null)

      const { error: insertError } = await db()
        .from('media_insight_snapshots')
        .upsert(
          {
            media_id: media.id,
            views: pick('views'),
            reach: pick('reach'),
            likes: pick('likes'),
            comments: pick('comments'),
            shares: pick('shares'),
            saved: pick('saved'),
            reposts: pick('reposts'),
            total_interactions: pick('total_interactions'),
            avg_watch_time_ms: pick('ig_reels_avg_watch_time'),
            total_watch_time_ms: pick('ig_reels_video_view_total_time'),
            skip_rate: pick('reels_skip_rate'),
            follows: pick('follows'),
            profile_visits: pick('profile_visits'),
            profile_activity: pick('profile_activity'),
            total_views_count: aggregates.total_views_count ?? null,
            total_like_count: aggregates.total_like_count ?? null,
            total_comments_count: aggregates.total_comments_count ?? null,
            metrics_unavailable: unavailable,
            raw: { insights: values, aggregates },
            captured_at: capturedAt,
          },
          { onConflict: 'media_id,captured_at', ignoreDuplicates: true },
        )

      if (insertError) failed += 1
      else processed += 1
    }

    await run.finish(failed === 0 ? 'SUCCESS' : 'PARTIAL', {
      records: processed,
      requests,
      errorMessage: failed > 0 ? `${failed} mídias falharam ao gravar.` : undefined,
    })

    return { processed, failed, requests }
  } catch (error) {
    await run.finish('FAILED', {
      errorCode: error instanceof MetaError ? String(error.code) : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
