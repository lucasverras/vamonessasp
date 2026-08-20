import { db } from '../lib/db'
const dia = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * dia).toISOString()
const out: Record<string, unknown> = {}
async function sec(nome: string, fn: () => Promise<unknown>) {
  try { out[nome] = await fn() } catch (e) { out[nome] = `ERRO: ${e instanceof Error ? e.message : String(e)}` }
}
async function main() {
  await sec('conta', async () => (await db().from('instagram_accounts').select('username,followers_count,media_count,last_sync_at,facebook_page_name').limit(1).maybeSingle()).data)
  await sec('snapshots', async () => {
    const r: Record<string, unknown> = {}
    for (const d of [30, 90]) {
      const { data } = await db().from('account_snapshots').select('followers_count,captured_at').gte('captured_at', iso(d)).order('captured_at', { ascending: true }).limit(1)
      r[`primeiro_${d}d`] = data?.[0] ?? null
    }
    const { data: first } = await db().from('account_snapshots').select('followers_count,captured_at').order('captured_at', { ascending: true }).limit(1)
    r.primeiro_de_todos = first?.[0] ?? null
    return r
  })
  await sec('daily_insights_colunas', async () => Object.keys((await db().from('account_daily_insights').select('*').limit(1)).data?.[0] ?? {}))
  await sec('daily_insights', async () => {
    const r: Record<string, unknown> = {}
    for (const d of [30, 90]) {
      const { data } = await db().from('account_daily_insights').select('*').gte('date', iso(d).slice(0, 10)).eq('is_provisional', false)
      const soma: Record<string, number> = {}
      for (const row of data ?? []) for (const [k, v] of Object.entries(row)) if (typeof v === 'number') soma[k] = (soma[k] ?? 0) + v
      r[`${d}d`] = { dias: data?.length ?? 0, ...soma }
    }
    return r
  })
  await sec('media_totals', async () => {
    const r: Record<string, unknown> = {}
    for (const d of [30, 90]) {
      const { data, error } = await db().rpc('overview_media_totals', { desde_param: iso(d) })
      r[`${d}d`] = error ? error.message : (Array.isArray(data) ? data[0] : data)
    }
    return r
  })
  await sec('posts_publicados', async () => {
    const r: Record<string, number> = {}
    for (const d of [30, 90]) {
      const { count } = await db().from('instagram_media').select('id', { count: 'exact', head: true }).gte('published_at', iso(d)).is('deleted_at', null)
      r[`${d}d`] = count ?? 0
    }
    return r
  })
  await sec('top_90d', async () => {
    const { data, error } = await db().rpc('conteudos_consolidados', { desde_param: iso(90) })
    if (error) return error.message
    const rows = (data ?? []) as Array<Record<string, unknown>>
    return { colunas: Object.keys(rows[0] ?? {}), top: rows.sort((a, b) => Number(b.total_views ?? b.views ?? 0) - Number(a.total_views ?? a.views ?? 0)).slice(0, 8).map((r) => ({ caption: String(r.caption ?? '').slice(0, 70), published_at: r.published_at, views: r.total_views ?? r.views, reach: r.reach, interacoes: r.total_interacoes, platforms: r.platforms ?? r.plataformas })) }
  })
  await sec('platform_posts', async () => {
    const { data } = await db().from('platform_posts').select('*').limit(1)
    const cols = Object.keys(data?.[0] ?? {})
    const r: Record<string, unknown> = { colunas: cols }
    for (const p of ['instagram', 'facebook', 'tiktok']) {
      const { data: rows } = await db().from('platform_posts').select('*').eq('platform', p).gte('published_at', iso(90))
      const soma: Record<string, number> = {}
      for (const row of rows ?? []) for (const [k, v] of Object.entries(row)) if (typeof v === 'number') soma[k] = (soma[k] ?? 0) + v
      r[p] = { posts_90d: rows?.length ?? 0, ...soma }
    }
    return r
  })
  await sec('comentarios', async () => {
    const r: Record<string, number> = {}
    for (const d of [30, 90]) {
      const { count } = await db().from('instagram_comments').select('id', { count: 'exact', head: true }).gte('commented_at', iso(d)).eq('is_from_account', false)
      r[`ig_${d}d`] = count ?? 0
    }
    const { count: fb } = await db().from('facebook_comments').select('id', { count: 'exact', head: true })
    r.fb_total = fb ?? 0
    return r
  })
  console.log(JSON.stringify(out, null, 1))
}
main()
