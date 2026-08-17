/* eslint-disable @typescript-eslint/no-explicit-any -- script de evidência
   one-shot: explora respostas de formato desconhecido de propósito. */
/**
 * Parte 2: objeto de POST (não de vídeo), volume real e viabilidade do
 * matching Instagram ↔ Facebook com os dados que temos.
 */
import { getPageToken } from '../lib/instagram/account'
import { db } from '../lib/db'

const V = 'v25.0'
const BASE = `https://graph.facebook.com/${V}`

async function get(path: string, params: Record<string, string>, token: string) {
  const u = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('access_token', token)
  const r = await fetch(u)
  return (await r.json()) as Record<string, any>
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

function jaccard(a: string, b: string) {
  const A = new Set(norm(a).split(' ').filter((w) => w.length > 3))
  const B = new Set(norm(b).split(' ').filter((w) => w.length > 3))
  if (!A.size || !B.size) return 0
  const inter = [...A].filter((w) => B.has(w)).length
  return inter / new Set([...A, ...B]).size
}

async function main() {
  const { data: acc } = await db()
    .from('instagram_accounts')
    .select('id,facebook_page_id')
    .limit(1)
    .single()
  const PAGE = acc!.facebook_page_id as string
  const token = await getPageToken(acc!.id as string)

  console.log('── A. Objeto de POST: reactions / shares / comments ──')
  const posts = await get(
    `${PAGE}/published_posts`,
    { fields: 'id,message,created_time,permalink_url,shares,comments.summary(true),reactions.summary(true),attachments{media_type,target}', limit: '3' },
    token,
  )
  if (posts.error) console.log(`  ✗ [${posts.error.code}] ${posts.error.message}`)
  else
    for (const p of posts.data ?? []) {
      console.log(
        `  ${p.id} · ${(p.message ?? '').replace(/\s+/g, ' ').slice(0, 48)}` +
          `\n     shares=${JSON.stringify(p.shares ?? null)} reactions=${p.reactions?.summary?.total_count ?? 'ausente'} comments=${p.comments?.summary?.total_count ?? 'ausente'} tipo=${p.attachments?.data?.[0]?.media_type ?? '—'}`,
      )
    }

  console.log('\n── B. Insights da PÁGINA (outro escopo?) ──')
  const pi = await get(
    `${PAGE}/insights`,
    { metric: 'page_fans,page_impressions,page_post_engagements', period: 'day' },
    token,
  )
  console.log(
    pi.error ? `  ✗ [${pi.error.code}] ${pi.error.message.slice(0, 150)}` : `  ✓ ${(pi.data ?? []).map((m: any) => m.name).join(', ')}`,
  )

  console.log('\n── C. Volume real de Reels na Página ──')
  let url: string | null = `${BASE}/${PAGE}/video_reels?fields=id,description,created_time,views,post_views,length,permalink_url&limit=100&access_token=${token}`
  const reels: any[] = []
  let paginas = 0
  while (url && paginas < 12) {
    const r: any = await (await fetch(url)).json()
    if (r.error) {
      console.log(`  ✗ na página ${paginas}: [${r.error.code}] ${r.error.message}`)
      break
    }
    reels.push(...(r.data ?? []))
    url = r.paging?.next ?? null
    paginas++
  }
  const comViews = reels.filter((r) => typeof r.views === 'number')
  console.log(`  ${reels.length} reels em ${paginas} páginas`)
  console.log(`  com "views": ${comViews.length} · soma ${comViews.reduce((s, r) => s + r.views, 0).toLocaleString('pt-BR')}`)
  console.log(`  com "post_views": ${reels.filter((r) => typeof r.post_views === 'number').length}`)
  if (reels.length) {
    const d = reels.map((r) => r.created_time).sort()
    console.log(`  período: ${d[0]?.slice(0, 10)} → ${d.at(-1)?.slice(0, 10)}`)
    const top = [...comViews].sort((a, b) => b.views - a.views)[0]
    if (top)
      console.log(
        `  maior: ${top.views.toLocaleString('pt-BR')} views / post_views=${top.post_views ?? '—'} · ${(top.description ?? '').replace(/\s+/g, ' ').slice(0, 50)}`,
      )
  }

  console.log('\n── D. Matching IG ↔ FB com dados reais ──')
  const { data: igs } = await db()
    .from('instagram_media')
    .select('id,caption,published_at,instagram_media_id')
    .is('deleted_at', null)
    .order('published_at', { ascending: false })
    .limit(300)

  let exatos = 0
  let ambiguos = 0
  let semPar = 0
  const exemplos: string[] = []
  for (const ig of igs ?? []) {
    const tIg = new Date(ig.published_at).getTime()
    // Candidatos: qualquer reel do FB publicado numa janela de ±3 dias.
    const cand = reels
      .map((r) => ({
        r,
        dh: Math.abs(new Date(r.created_time).getTime() - tIg) / 3_600_000,
        sim: jaccard(ig.caption ?? '', r.description ?? ''),
      }))
      .filter((c) => c.dh <= 72)
      .sort((a, b) => b.sim - a.sim)

    const forte = cand.filter((c) => c.sim >= 0.6)
    if (forte.length === 1) {
      exatos++
      if (exemplos.length < 3)
        exemplos.push(
          `    ✓ ${(ig.caption ?? '').replace(/\s+/g, ' ').slice(0, 42)}\n        ↔ ${(forte[0]!.r.description ?? '').replace(/\s+/g, ' ').slice(0, 42)}  (sim ${forte[0]!.sim.toFixed(2)}, Δ${forte[0]!.dh.toFixed(1)}h)`,
        )
    } else if (forte.length > 1) ambiguos++
    else semPar++
  }
  console.log(`  ${igs?.length ?? 0} mídias do Instagram vs ${reels.length} reels do Facebook`)
  console.log(`  par único e forte (sim≥0.60, ≤72h): ${exatos}`)
  console.log(`  ambíguo (mais de um candidato forte): ${ambiguos}`)
  console.log(`  sem candidato: ${semPar}`)
  if (exemplos.length) console.log(exemplos.join('\n'))
}

main().catch((e) => {
  console.error('falhou:', e instanceof Error ? e.message : e)
  process.exit(1)
})
