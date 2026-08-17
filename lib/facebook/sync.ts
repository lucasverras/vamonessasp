import 'server-only'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'

/**
 * Sync dos Reels da PÁGINA do Facebook para o modelo multiplataforma.
 *
 * Fonte verificada na nossa conta em 17/08/2026: GET /{page}/video_reels
 * entrega id, description, created_time, permalink_url, length, views,
 * post_views e thumbnails SEM precisar de read_insights. comments.summary e
 * likes.summary vêm na mesma chamada paginada — nenhum N+1.
 *
 * `views` e `post_views` são números DIFERENTES e ambos oficiais; views vai
 * para a coluna comum, post_views fica em platform_metrics com o nome
 * original. `shares` vive no objeto de POST (outro id) e é omitido quando
 * zero — até decidirmos a semântica, fica NULL (não inventamos 0).
 *
 * Depois do sync roda o auto-match: legenda ≥ 0,60 de Jaccard + janela de
 * ±72h + candidato ÚNICO → vincula ao content do Instagram. Ambíguo ou fraco
 * fica sem vínculo, para associação manual no painel. Verificado no acervo
 * real: 163 pares únicos, 7 ambíguos, 86 sem par.
 */

interface ReelFb {
  id: string
  description?: string
  created_time?: string
  permalink_url?: string
  length?: number
  views?: number
  post_views?: number
  thumbnails?: { data?: Array<{ uri?: string; is_preferred?: boolean }> }
  comments?: { summary?: { total_count?: number } }
  likes?: { summary?: { total_count?: number } }
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function jaccard(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 3))
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 3))
  if (!A.size || !B.size) return 0
  const inter = [...A].filter((w) => B.has(w)).length
  return inter / new Set([...A, ...B]).size
}

export async function syncFacebook(): Promise<{
  reels: number
  snapshots: number
  vinculadosAuto: number
  semVinculo: number
}> {
  const conta = await getConnectedAccount()
  if (!conta?.facebookPageId) throw new Error('Conta sem Página do Facebook conectada.')
  const token = await getPageToken(conta.id)

  const v = process.env.META_API_VERSION ?? 'v26.0'
  const fields =
    'id,description,created_time,permalink_url,length,views,post_views,' +
    'thumbnails.limit(1),comments.summary(true).limit(0),likes.summary(true).limit(0)'
  let url: string | null =
    `https://graph.facebook.com/${v}/${conta.facebookPageId}/video_reels` +
    `?fields=${encodeURIComponent(fields)}&limit=100&access_token=${token}`

  const reels: ReelFb[] = []
  let paginas = 0
  while (url && paginas < 20) {
    const r = await fetch(url, { cache: 'no-store' })
    const j = (await r.json()) as { data?: ReelFb[]; paging?: { next?: string }; error?: { message: string } }
    if (j.error) throw new Error(`Facebook video_reels: ${j.error.message}`)
    reels.push(...(j.data ?? []))
    url = j.paging?.next ?? null
    paginas++
  }

  let snapshots = 0
  for (const reel of reels) {
    const { data: pp, error } = await db()
      .from('platform_posts')
      .upsert(
        {
          platform: 'facebook',
          external_post_id: reel.id,
          external_video_id: reel.id,
          permalink: reel.permalink_url ?? null,
          caption: reel.description ?? null,
          published_at: reel.created_time ?? null,
          media_type: 'REELS',
          thumbnail_url: reel.thumbnails?.data?.[0]?.uri ?? null,
          duration_s: reel.length ?? null,
        },
        { onConflict: 'platform,external_post_id' },
      )
      .select('id')
      .single()
    if (error) throw new Error(`Falha ao gravar reel FB: ${error.message}`)

    // Snapshot append-only. NULL quando o campo não veio — nunca 0 inventado.
    await db().from('platform_insight_snapshots').insert({
      platform_post_id: pp.id,
      views: reel.views ?? null,
      likes: reel.likes?.summary?.total_count ?? null,
      comments: reel.comments?.summary?.total_count ?? null,
      shares: null,
      platform_metrics: { post_views: reel.post_views ?? null },
    })
    snapshots++
  }

  // ------------------------------------------------------------ auto-match
  const { data: semGrupo } = await db()
    .from('platform_posts')
    .select('id,caption,published_at')
    .eq('platform', 'facebook')
    .is('content_id', null)

  const { data: igPosts } = await db()
    .from('platform_posts')
    .select('content_id,caption,published_at')
    .eq('platform', 'instagram')
    .not('content_id', 'is', null)

  let vinculados = 0
  for (const fb of semGrupo ?? []) {
    if (!fb.published_at) continue
    const tFb = new Date(fb.published_at).getTime()
    const fortes = (igPosts ?? [])
      .map((ig) => ({
        ig,
        sim: jaccard(fb.caption ?? '', ig.caption ?? ''),
        dh: Math.abs(new Date(ig.published_at ?? 0).getTime() - tFb) / 3_600_000,
      }))
      .filter((c) => c.dh <= 72 && c.sim >= 0.6)
      .sort((a, b) => b.sim - a.sim)

    // Só vincula com candidato ÚNICO e forte. Ambíguo é decisão humana.
    if (fortes.length === 1) {
      await db()
        .from('platform_posts')
        .update({
          content_id: fortes[0]!.ig.content_id,
          match_method: 'auto-caption',
          match_confidence: Number(fortes[0]!.sim.toFixed(2)),
          matched_by: 'sync',
        })
        .eq('id', fb.id)
      vinculados++
    }
  }

  return {
    reels: reels.length,
    snapshots,
    vinculadosAuto: vinculados,
    semVinculo: (semGrupo?.length ?? 0) - vinculados,
  }
}
