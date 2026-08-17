import 'server-only'
import { db } from '../db'

export type Filtro = 'todos' | 'elegiveis' | 'enviados' | 'falharam' | 'expirados'

const MAPA: Record<Exclude<Filtro, 'todos'>, string> = {
  elegiveis: 'ELIGIBLE',
  enviados: 'SENT',
  falharam: 'FAILED',
  expirados: 'EXPIRED',
}

export interface ComentarioLinha {
  id: string
  username: string | null
  text: string | null
  commented_at: string
  eligibility_status: string
  eligibility_expires_at: string
  not_eligible_reason: string | null
  conteudo: string | null
  permalink: string | null
  thumbnail: string | null
  blacklist: boolean
  /** Pré-calculados no servidor: Date.now() no render é impuro e instável. */
  faz: string
  restam: string | null
}

function relativo(ms: number): string {
  const min = Math.floor(ms / 60_000)
  if (min < 60) return `há ${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

function janela(ms: number): string | null {
  const h = Math.floor(ms / 3_600_000)
  if (h <= 0) return null
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`
}

export async function listarComentarios(filtro: Filtro = 'elegiveis', limite = 300) {
  let q = db()
    .from('instagram_comments')
    .select(
      'id,username,text,commented_at,eligibility_status,eligibility_expires_at,not_eligible_reason,instagram_user_id,instagram_media:media_id(caption,permalink,thumbnail_url)',
    )
    .eq('is_from_account', false)
    .is('deleted_at', null)
    .order('commented_at', { ascending: false })
    .limit(limite)

  if (filtro !== 'todos') q = q.eq('eligibility_status', MAPA[filtro])

  const { data, error } = await q
  // Uma query com erro devolvia data=null e a tela dizia "nenhum comentário",
  // apresentando uma FALHA como se fosse um resultado. Nunca em silêncio.
  if (error) throw new Error(`Falha ao listar comentários: ${error.message}`)

  const igsids = [...new Set((data ?? []).map((c) => c.instagram_user_id).filter(Boolean))]
  const { data: pessoas } = igsids.length
    ? await db()
        .from('instagram_users')
        .select('instagram_user_id,is_blacklisted')
        .in('instagram_user_id', igsids as string[])
    : { data: [] }
  const bloqueados = new Set(
    (pessoas ?? []).filter((p) => p.is_blacklisted).map((p) => p.instagram_user_id),
  )

  const agora = Date.now()

  return (data ?? []).map((c) => {
    const m = c.instagram_media as unknown as {
      caption?: string
      permalink?: string
      thumbnail_url?: string
    } | null
    return {
      id: c.id,
      username: c.username,
      text: c.text,
      commented_at: c.commented_at,
      eligibility_status: c.eligibility_status,
      eligibility_expires_at: c.eligibility_expires_at,
      not_eligible_reason: c.not_eligible_reason,
      conteudo: m?.caption ?? null,
      permalink: m?.permalink ?? null,
      thumbnail: m?.thumbnail_url ?? null,
      blacklist: bloqueados.has(c.instagram_user_id),
      faz: relativo(agora - new Date(c.commented_at).getTime()),
      restam: janela(new Date(c.eligibility_expires_at).getTime() - agora),
    } satisfies ComentarioLinha
  })
}

export async function contarPorStatus() {
  const { data, error } = await db().rpc('contar_comentarios_por_status')
  if (error) throw new Error(`Falha ao contar comentários: ${error.message}`)
  const mapa = new Map<string, number>(
    ((data ?? []) as Array<{ status: string; total: number }>).map((r) => [r.status, r.total]),
  )
  const total = [...mapa.values()].reduce((a, b) => a + b, 0)
  return {
    todos: total,
    elegiveis: mapa.get('ELIGIBLE') ?? 0,
    enviados: mapa.get('SENT') ?? 0,
    falharam: mapa.get('FAILED') ?? 0,
    expirados: mapa.get('EXPIRED') ?? 0,
  }
}

/** Quantas pessoas ÚNICAS ainda podem receber, e quantas horas restam. */
export async function resumoOportunidade() {
  const { data, error } = await db().rpc('resumo_oportunidade')
  if (error) throw new Error(`Falha ao resumir oportunidade: ${error.message}`)
  const r = (data ?? [])[0] as
    | { pessoas: number; comentarios: number; expira_em: string | null }
    | undefined
  return {
    pessoas: r?.pessoas ?? 0,
    comentarios: r?.comentarios ?? 0,
    proximaExpiracao: r?.expira_em ?? null,
    horasParaExpirar: r?.expira_em
      ? Math.floor((new Date(r.expira_em).getTime() - Date.now()) / 3_600_000)
      : null,
  }
}
