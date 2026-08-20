import 'server-only'
import { db } from '../db'

/**
 * Media Kit: números ao vivo da API da Meta (já sincronizados no banco) +
 * valores manuais (o que a API não entrega) → snapshot congelado por geração.
 * Linguagem honesta: "novos seguidores" é o bruto da Meta (sem descontar
 * unfollows); alcance é "contas alcançadas" no período; nada é atribuído a
 * um vídeo específico além das métricas do próprio vídeo.
 */

const dia = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * dia).toISOString()

export interface MediaKitManual {
  parceiros: number | null
  tiktok_seguidores: number | null
  tiktok_views_7d: number | null
  tiktok_curtidas_total: number | null
  fb_seguidores: number | null
  foto_capa_url: string | null
  foto_dupla_url: string | null
  valor_padrao: number | null
  whatsapp: string | null
  updated_at: string | null
}

export interface TotaisPeriodo {
  views: number | null
  reach: number | null
  likes: number | null
  shares: number | null
  saved: number | null
  comments: number | null
  posts: number
  novosSeguidores: number
  diasComDado: number
}

export interface CaseMediaKit {
  titulo: string
  handle: string | null
  /** Nome de exibição: apelido salvo > @ humanizado > nome no título. */
  nome: string
  /** Chave do apelido (para editar na aba). */
  chave: string
  data: string
  thumbnail: string | null
  permalink: string | null
  ig_views: number | null
  ig_reach: number | null
  ig_likes: number | null
  ig_shares: number | null
  ig_saved: number | null
  fb_views: number | null
}

export interface NumerosMediaKit {
  geradoEm: string
  username: string
  seguidores: number | null
  seguidoresEm: string | null
  ig30: TotaisPeriodo
  ig90: TotaisPeriodo
  fbPosts90: number
  cases: CaseMediaKit[]
  manual: MediaKitManual
}

export interface MediaKitGerado {
  id: string
  rotulo: string
  cliente: string | null
  valor: number | null
  numeros: NumerosMediaKit
  gerado_por: string | null
  created_at: string
}

export async function getManual(): Promise<MediaKitManual> {
  const { data } = await db().from('media_kit_manual').select('*').eq('id', true).maybeSingle()
  return {
    parceiros: data?.parceiros ?? null,
    tiktok_seguidores: data?.tiktok_seguidores ?? null,
    tiktok_views_7d: data?.tiktok_views_7d !== null && data?.tiktok_views_7d !== undefined ? Number(data.tiktok_views_7d) : null,
    tiktok_curtidas_total: data?.tiktok_curtidas_total !== null && data?.tiktok_curtidas_total !== undefined ? Number(data.tiktok_curtidas_total) : null,
    fb_seguidores: data?.fb_seguidores ?? null,
    foto_capa_url: data?.foto_capa_url ?? null,
    foto_dupla_url: data?.foto_dupla_url ?? null,
    valor_padrao: data?.valor_padrao !== null && data?.valor_padrao !== undefined ? Number(data.valor_padrao) : null,
    whatsapp: data?.whatsapp ?? null,
    updated_at: data?.updated_at ?? null,
  }
}

export async function salvarManual(patch: Partial<MediaKitManual>, por: string) {
  const { error } = await db()
    .from('media_kit_manual')
    .update({ ...patch, updated_at: new Date().toISOString(), updated_by: por })
    .eq('id', true)
  if (error) throw new Error(error.message)
}

async function totaisPeriodo(dias: number): Promise<TotaisPeriodo> {
  const desde = iso(dias)
  const [totaisR, { count: posts }, { data: diarios }] = await Promise.all([
    db().rpc('overview_media_totals', { desde_param: desde }),
    db().from('instagram_media').select('id', { count: 'exact', head: true }).gte('published_at', desde).is('deleted_at', null),
    db()
      .from('account_daily_insights')
      .select('new_followers')
      .eq('is_provisional', false)
      .gte('date', desde.slice(0, 10)),
  ])
  const t = (Array.isArray(totaisR.data) ? totaisR.data[0] : totaisR.data) as Record<string, number | null> | null
  return {
    views: t?.views ?? null,
    reach: t?.reach ?? null,
    likes: t?.likes ?? null,
    shares: t?.shares ?? null,
    saved: t?.saved ?? null,
    comments: t?.comments ?? null,
    posts: posts ?? 0,
    novosSeguidores: (diarios ?? []).reduce((s, d) => s + (d.new_followers ?? 0), 0),
    diasComDado: diarios?.length ?? 0,
  }
}

function nomeDoTitulo(t: string): string | null {
  const limpo = t.replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '').replace(/\s+/g, ' ').trim()
  // "No Rei do Macarrão, ..." → nome próprio depois de no/na/do/da.
  const proprio = limpo.match(/\b(?:[Nn][oa]|[Dd][oa])\s+((?:[A-ZÀ-Ú][\wÀ-ÿ'&.-]*)(?:\s+(?:d[aeo]s?\s+)?[A-ZÀ-Ú][\wÀ-ÿ'&.-]*)*)/)
  if (proprio?.[1] && proprio[1].length >= 3) return proprio[1].replace(/[.,]$/, '')
  const trecho = limpo.split(/[!?.:\n]/)[0]?.trim() ?? ''
  const palavras = trecho.split(' ').filter(Boolean).slice(0, 6).join(' ')
  return palavras.length >= 4 ? palavras : null
}

function humanizarHandle(h: string): string {
  return h.replace(/^@/, '').replace(/[._]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
}

export async function getApelidos(): Promise<Map<string, string>> {
  const { data } = await db().from('media_kit_apelidos').select('chave,nome')
  return new Map((data ?? []).map((a) => [String(a.chave).toLowerCase(), String(a.nome)]))
}

export async function salvarApelido(chave: string, nome: string) {
  const k = chave.trim().toLowerCase()
  if (!k) return
  if (!nome.trim()) {
    await db().from('media_kit_apelidos').delete().eq('chave', k)
    return
  }
  const { error } = await db()
    .from('media_kit_apelidos')
    .upsert({ chave: k, nome: nome.trim(), updated_at: new Date().toISOString() }, { onConflict: 'chave' })
  if (error) throw new Error(error.message)
}

/** Coleta TUDO agora — é o que vira snapshot na geração. */
export async function coletarNumeros(): Promise<NumerosMediaKit> {
  const [conta, ig30, ig90, casesR, { count: fbPosts90 }, manual, apelidos] = await Promise.all([
    db().from('instagram_accounts').select('username,followers_count,last_sync_at').limit(1).maybeSingle(),
    totaisPeriodo(30),
    totaisPeriodo(90),
    db().rpc('conteudos_consolidados', { desde_param: iso(90) }),
    db().from('platform_posts').select('id', { count: 'exact', head: true }).eq('platform', 'facebook').gte('published_at', iso(90)),
    getManual(),
    getApelidos(),
  ])
  type Linha = {
    title: string | null; thumbnail_url: string | null; permalink: string | null; published_at: string
    ig_views: number | null; ig_reach: number | null; ig_likes: number | null; ig_shares: number | null; ig_saved: number | null; fb_views: number | null
  }
  const cases = ((casesR.data ?? []) as Linha[])
    .filter((c) => (c.ig_views ?? 0) > 0)
    .sort((a, b) => (b.ig_views ?? 0) - (a.ig_views ?? 0))
    .slice(0, 6)
    .map((c) => {
      const t = (c.title ?? '').replace(/\s+/g, ' ').trim()
      const handle = t.match(/@[\w.]+/)?.[0] ?? null
      // Sem @ na legenda: nome próprio do título ("No Rei do Macarrão").
      const derivado = nomeDoTitulo(t)
      const chave = (handle ?? derivado ?? t.slice(0, 40)).toLowerCase()
      const nome = apelidos.get(chave) ?? (handle ? humanizarHandle(handle) : (derivado ?? 'Vamo Nessa'))
      return {
        titulo: t.length > 90 ? `${t.slice(0, 88).trimEnd()}…` : t,
        handle,
        nome,
        chave,
        data: c.published_at,
        thumbnail: c.thumbnail_url,
        permalink: c.permalink,
        ig_views: c.ig_views, ig_reach: c.ig_reach, ig_likes: c.ig_likes, ig_shares: c.ig_shares, ig_saved: c.ig_saved, fb_views: c.fb_views,
      }
    })
  return {
    geradoEm: new Date().toISOString(),
    username: conta.data?.username ?? 'vamonessasp',
    seguidores: conta.data?.followers_count ?? null,
    seguidoresEm: conta.data?.last_sync_at ?? null,
    ig30, ig90,
    fbPosts90: fbPosts90 ?? 0,
    cases,
    manual,
  }
}

export function rotuloMes(iso: string): string {
  return new Date(iso)
    .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
    .replace(' de ', ' ')
    .toUpperCase()
}

export async function registrarGeracao(args: { cliente: string | null; valor: number | null; numeros: NumerosMediaKit; por: string }) {
  const { data, error } = await db()
    .from('media_kit_gerados')
    .insert({
      rotulo: rotuloMes(args.numeros.geradoEm),
      cliente: args.cliente,
      valor: args.valor,
      numeros: args.numeros as unknown as Record<string, unknown>,
      gerado_por: args.por,
    })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

export async function listarGerados(limite = 20): Promise<Omit<MediaKitGerado, 'numeros'>[]> {
  const { data } = await db()
    .from('media_kit_gerados')
    .select('id,rotulo,cliente,valor,gerado_por,created_at')
    .order('created_at', { ascending: false })
    .limit(limite)
  return ((data ?? []) as Array<Record<string, unknown>>).map((g) => ({
    id: String(g.id), rotulo: String(g.rotulo), cliente: (g.cliente as string | null) ?? null,
    valor: g.valor === null || g.valor === undefined ? null : Number(g.valor),
    gerado_por: (g.gerado_por as string | null) ?? null, created_at: String(g.created_at),
  }))
}

export async function getGerado(id: string): Promise<MediaKitGerado | null> {
  const { data } = await db().from('media_kit_gerados').select('*').eq('id', id).maybeSingle()
  if (!data) return null
  return {
    id: data.id, rotulo: data.rotulo, cliente: data.cliente ?? null,
    valor: data.valor === null ? null : Number(data.valor),
    numeros: data.numeros as unknown as NumerosMediaKit,
    gerado_por: data.gerado_por ?? null, created_at: data.created_at,
  }
}

// ── formatação (pt-BR, separadores brasileiros) ──
export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : n.toLocaleString('pt-BR')
}
export function fmtCompacto(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} mi`
  if (n >= 10_000) return `${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
  return n.toLocaleString('pt-BR')
}
export function fmtBRL(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
export function fmtData(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'
}
