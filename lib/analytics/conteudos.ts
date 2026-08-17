import 'server-only'
import { db } from '../db'

/**
 * Leitura consolidada da tela de Conteúdos.
 *
 * Uma chamada de RPC devolve tudo: o banco agrega, a tela exibe. Zero N+1.
 *
 * Regra de soma: TOTAL é a SOMA DAS VISUALIZAÇÕES nas plataformas onde o
 * número EXISTE. Plataforma sem dado fica fora da soma — ausência nunca vira
 * zero, e a soma nunca é apresentada como "pessoas únicas".
 */

export interface ConteudoConsolidado {
  content_id: string
  title: string | null
  thumbnail_url: string | null
  permalink: string | null
  published_at: string
  ig_views: number | null
  ig_reach: number | null
  ig_likes: number | null
  ig_comments: number | null
  ig_shares: number | null
  ig_saved: number | null
  fb_views: number | null
  fb_likes: number | null
  fb_comments: number | null
  fb_shares: number | null
  tt_views: number | null
  tt_likes: number | null
  tt_comments: number | null
  tt_shares: number | null
  plataformas: string[]
  /** Somas calculadas aqui, uma vez, com a regra documentada acima. */
  total_views: number | null
  total_interacoes: number | null
}

export type Periodo = 'hoje' | '7d' | '30d' | 'mes' | 'mes-anterior' | 'tudo'
export type Plataforma = 'todos' | 'instagram' | 'facebook' | 'tiktok'
export type Ordenacao = 'recentes' | 'antigos' | 'total' | 'ig' | 'fb' | 'tt' | 'interacoes'

export function inicioDoPeriodo(p: Periodo): { desde: Date; ate: Date | null } {
  const agora = new Date()
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())
  switch (p) {
    case 'hoje':
      return { desde: hoje, ate: null }
    case '7d':
      return { desde: new Date(agora.getTime() - 7 * 86_400_000), ate: null }
    case '30d':
      return { desde: new Date(agora.getTime() - 30 * 86_400_000), ate: null }
    case 'mes':
      return { desde: new Date(agora.getFullYear(), agora.getMonth(), 1), ate: null }
    case 'mes-anterior':
      return {
        desde: new Date(agora.getFullYear(), agora.getMonth() - 1, 1),
        ate: new Date(agora.getFullYear(), agora.getMonth(), 1),
      }
    case 'tudo':
      return { desde: new Date(0), ate: null }
  }
}

const somaOuNull = (vals: Array<number | null>): number | null => {
  const presentes = vals.filter((v): v is number => v !== null && v !== undefined)
  return presentes.length === 0 ? null : presentes.reduce((a, b) => a + b, 0)
}

export async function listarConteudos(periodo: Periodo): Promise<ConteudoConsolidado[]> {
  const { desde, ate } = inicioDoPeriodo(periodo)
  const { data, error } = await db().rpc('conteudos_consolidados', {
    desde_param: desde.toISOString(),
  })
  if (error) throw new Error(`Falha ao consolidar conteúdos: ${error.message}`)

  return ((data ?? []) as Omit<ConteudoConsolidado, 'total_views' | 'total_interacoes'>[])
    .filter((c) => (ate ? new Date(c.published_at) < ate : true))
    .map((c) => ({
      ...c,
      total_views: somaOuNull([c.ig_views, c.fb_views, c.tt_views]),
      total_interacoes: somaOuNull([
        c.ig_likes, c.ig_comments, c.ig_shares, c.ig_saved,
        c.fb_likes, c.fb_comments, c.fb_shares,
        c.tt_likes, c.tt_comments, c.tt_shares,
      ]),
    }))
}

export function ordenar(itens: ConteudoConsolidado[], por: Ordenacao): ConteudoConsolidado[] {
  const v = (n: number | null) => n ?? -1
  const s = [...itens]
  switch (por) {
    case 'recentes':
      return s.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at))
    case 'antigos':
      return s.sort((a, b) => +new Date(a.published_at) - +new Date(b.published_at))
    case 'total':
      return s.sort((a, b) => v(b.total_views) - v(a.total_views))
    case 'ig':
      return s.sort((a, b) => v(b.ig_views) - v(a.ig_views))
    case 'fb':
      return s.sort((a, b) => v(b.fb_views) - v(a.fb_views))
    case 'tt':
      return s.sort((a, b) => v(b.tt_views) - v(a.tt_views))
    case 'interacoes':
      return s.sort((a, b) => v(b.total_interacoes) - v(a.total_interacoes))
  }
}

/** Publicações do Facebook ainda sem vínculo + a melhor sugestão de cada uma. */
export async function listarVinculosPendentes() {
  const { data: soltos } = await db()
    .from('platform_posts')
    .select('id,caption,published_at,permalink,thumbnail_url')
    .eq('platform', 'facebook')
    .is('content_id', null)
    .order('published_at', { ascending: false })
    .limit(30)

  if (!soltos?.length) return []

  const { data: igs } = await db()
    .from('platform_posts')
    .select('content_id,caption,published_at')
    .eq('platform', 'instagram')
    .not('content_id', 'is', null)

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
  const jac = (a: string, b: string) => {
    const A = new Set(norm(a).split(' ').filter((w) => w.length > 3))
    const B = new Set(norm(b).split(' ').filter((w) => w.length > 3))
    if (!A.size || !B.size) return 0
    return [...A].filter((w) => B.has(w)).length / new Set([...A, ...B]).size
  }

  return soltos.map((fb) => {
    const melhor = (igs ?? [])
      .map((ig) => ({ ig, sim: jac(fb.caption ?? '', ig.caption ?? '') }))
      .sort((a, b) => b.sim - a.sim)[0]
    return {
      id: fb.id as string,
      caption: (fb.caption as string | null) ?? null,
      published_at: fb.published_at as string | null,
      permalink: fb.permalink as string | null,
      sugestaoContentId: melhor && melhor.sim >= 0.3 ? (melhor.ig.content_id as string) : null,
      sugestaoCaption: melhor && melhor.sim >= 0.3 ? ((melhor.ig.caption as string | null) ?? null) : null,
      sugestaoSim: melhor ? Number(melhor.sim.toFixed(2)) : 0,
    }
  })
}
