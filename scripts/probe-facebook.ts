/**
 * Descoberta empírica do que a Graph API entrega para a PÁGINA Vamo Nessa SP.
 *
 * Só leitura. Nenhuma publicação, nenhuma alteração de vínculo, nenhuma escrita.
 *
 * A regra do projeto vale aqui igual: HTTP 200 sem o campo pedido NÃO é
 * disponibilidade. Cada teste registra se a CHAVE pedida voltou no corpo.
 */
import { getPageToken } from '../lib/instagram/account'
import { db } from '../lib/db'

const V = process.env.PROBE_V ?? 'v25.0'
const BASE = `https://graph.facebook.com/${V}`

type R = {
  o: string
  status: number
  ok: boolean
  chaves?: string[]
  n?: number
  erro?: string
  code?: number
  sub?: number
  amostra?: unknown
}

async function get(path: string, params: Record<string, string>, token: string): Promise<R> {
  const u = new URL(`${BASE}/${path}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  u.searchParams.set('access_token', token)
  const r = await fetch(u)
  const j = (await r.json()) as Record<string, unknown>
  const o = `GET /${path}?${new URLSearchParams(params)}`
  if (j.error) {
    const e = j.error as Record<string, unknown>
    return {
      o,
      status: r.status,
      ok: false,
      erro: String(e.message).slice(0, 220),
      code: Number(e.code),
      sub: e.error_subcode ? Number(e.error_subcode) : undefined,
    }
  }
  const data = j.data as unknown[] | undefined
  return {
    o,
    status: r.status,
    ok: true,
    n: Array.isArray(data) ? data.length : undefined,
    chaves: Array.isArray(data)
      ? data.length
        ? Object.keys(data[0] as object)
        : []
      : Object.keys(j),
    amostra: Array.isArray(data) ? data[0] : j,
  }
}

function mostra(r: R) {
  if (!r.ok) {
    console.log(`  ✗ [${r.code}${r.sub ? `/${r.sub}` : ''}] ${r.o}\n      ${r.erro}`)
  } else {
    const cnt = r.n !== undefined ? ` n=${r.n}` : ''
    console.log(`  ✓${cnt} ${r.o}\n      campos: ${(r.chaves ?? []).join(', ') || '(vazio)'}`)
  }
}

async function main() {
  const { data: acc } = await db()
    .from('instagram_accounts')
    .select('id,facebook_page_id,facebook_page_name')
    .limit(1)
    .single()
  const PAGE = acc!.facebook_page_id as string
  const token = await getPageToken(acc!.id as string)

  console.log(`\nPágina: ${acc!.facebook_page_name} (${PAGE})  ·  API ${V}\n`)

  console.log('── 1. A Página responde, e com quais campos ──')
  mostra(await get(PAGE, { fields: 'id,name,fan_count,followers_count,link,category' }, token))

  console.log('\n── 2. Onde estão os vídeos/Reels ──')
  const listas = [
    ['video_reels', 'id,description,created_time,permalink_url,length,views'],
    ['videos', 'id,description,created_time,permalink_url,length,views'],
    ['published_posts', 'id,message,created_time,permalink_url,attachments'],
    ['posts', 'id,message,created_time,permalink_url'],
    ['feed', 'id,message,created_time,permalink_url'],
  ] as const
  const achados: Array<{ edge: string; r: R }> = []
  for (const [edge, fields] of listas) {
    const r = await get(`${PAGE}/${edge}`, { fields, limit: '5' }, token)
    mostra(r)
    if (r.ok && (r.n ?? 0) > 0) achados.push({ edge, r })
  }

  if (!achados.length) {
    console.log('\nNenhuma edge de conteúdo retornou item. Parando: sem ID não há o que medir.')
    return
  }

  const primeiro = achados[0]!
  const item = primeiro.r.amostra as Record<string, unknown>
  const ID = String(item.id)
  console.log(`\n→ usando ${primeiro.edge} · id=${ID}`)

  console.log('\n── 3. Enum interno de métricas (nome inválido de propósito) ──')
  const enumr = await get(
    `${ID}/video_insights`,
    { metric: 'metrica_que_nao_existe_vamonessa' },
    token,
  )
  mostra(enumr)

  console.log('\n── 4. Métricas de vídeo, uma a uma ──')
  const METRICAS = [
    'total_video_views',
    'total_video_impressions',
    'total_video_views_unique',
    'total_video_view_total_time',
    'total_video_avg_time_watched',
    'total_video_reactions_by_type_total',
    'total_video_stories_by_action_type',
    'total_video_complete_views',
    'total_video_10s_views',
    'blue_reels_play_count',
    'fb_reels_total_plays',
    'post_impressions',
    'post_impressions_unique',
    'post_video_views',
    'post_reactions_by_type_total',
  ]
  const disponiveis: string[] = []
  for (const m of METRICAS) {
    const r = await get(`${ID}/video_insights`, { metric: m }, token)
    if (r.ok && (r.n ?? 0) > 0) {
      disponiveis.push(m)
      const a = r.amostra as Record<string, unknown>
      console.log(`  ✓ ${m} = ${JSON.stringify((a.values as unknown[])?.[0] ?? a.value)}`)
    } else if (r.ok) {
      console.log(`  ⚠ ${m} → 200 com data vazio (NÃO é disponibilidade)`)
    } else {
      console.log(`  ✗ ${m} → [${r.code}] ${r.erro?.slice(0, 90)}`)
    }
  }

  console.log('\n── 5. Insights do post (outra rota) ──')
  mostra(
    await get(
      `${ID}/insights`,
      { metric: 'post_impressions,post_impressions_unique,post_video_views' },
      token,
    ),
  )

  console.log('\n── 6. Campos diretos do objeto ──')
  for (const f of [
    'views',
    'post_views',
    'video_insights',
    'likes.summary(true)',
    'comments.summary(true)',
    'reactions.summary(true)',
    'shares',
    'length',
    'thumbnails',
  ]) {
    const r = await get(ID, { fields: f }, token)
    const chave = f.split('.')[0]!.split('(')[0]!
    if (r.ok) {
      const presente = (r.chaves ?? []).includes(chave)
      console.log(
        `  ${presente ? '✓' : '⚠ 200 sem a chave —'} ${f}${presente ? ` = ${JSON.stringify((r.amostra as Record<string, unknown>)[chave]).slice(0, 140)}` : ''}`,
      )
    } else console.log(`  ✗ ${f} → [${r.code}] ${r.erro?.slice(0, 90)}`)
  }

  console.log('\n── 7. Resumo ──')
  console.log(`  edges com conteúdo: ${achados.map((a) => a.edge).join(', ')}`)
  console.log(`  métricas de vídeo confirmadas: ${disponiveis.join(', ') || 'NENHUMA'}`)
}

main().catch((e) => {
  console.error('falhou:', e instanceof Error ? e.message : e)
  process.exit(1)
})
