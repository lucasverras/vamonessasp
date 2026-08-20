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

export async function listarComentarios(
  filtro: Filtro = 'elegiveis',
  limite = 100,
  pagina = 0,
) {
  // "Elegíveis" = AINDA VALE MANDAR: uma linha por pessoa (comentário mais
  // recente), sem quem segue, sem DM na janela, sem quem JÁ ESTÁ NA FILA.
  // Calculado no banco — a aba, o card e a Home contam a mesma coisa.
  if (filtro === 'elegiveis') {
    const { data, error } = await db().rpc('listar_elegiveis_limpos', { limite })
    if (error) throw new Error(`Falha ao listar elegíveis: ${error.message}`)
    const agora = Date.now()
    return ((data ?? []) as Array<{
      id: string
      username: string | null
      comment_text: string | null
      commented_at: string
      eligibility_status: string
      eligibility_expires_at: string
      not_eligible_reason: string | null
      caption: string | null
      permalink: string | null
      thumbnail_url: string | null
    }>).map((c) => ({
      id: c.id,
      username: c.username,
      text: c.comment_text,
      commented_at: c.commented_at,
      eligibility_status: c.eligibility_status,
      eligibility_expires_at: c.eligibility_expires_at,
      not_eligible_reason: c.not_eligible_reason,
      conteudo: c.caption,
      permalink: c.permalink,
      thumbnail: c.thumbnail_url,
      blacklist: false,
      faz: relativo(agora - new Date(c.commented_at).getTime()),
      restam: janela(new Date(c.eligibility_expires_at).getTime() - agora),
    } satisfies ComentarioLinha))
  }

  let q = db()
    .from('instagram_comments')
    .select(
      'id,username,text,commented_at,eligibility_status,eligibility_expires_at,not_eligible_reason,instagram_user_id,instagram_media:media_id(caption,permalink,thumbnail_url)',
    )
    .eq('is_from_account', false)
    .is('deleted_at', null)
    .order('commented_at', { ascending: false })
    // Paginação server-side: 100 por página em vez de 300 de uma vez —
    // payload 3x menor e TTFB proporcional. "Carregar mais" busca a próxima.
    .range(pagina * limite, pagina * limite + limite - 1)

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
  const [{ data, error }, { data: limpos }] = await Promise.all([
    db().rpc('contar_comentarios_por_status'),
    db().rpc('oportunidades_resumo'),
  ])
  if (error) throw new Error(`Falha ao contar comentários: ${error.message}`)
  const mapa = new Map<string, number>(
    ((data ?? []) as Array<{ status: string; total: number }>).map((r) => [r.status, r.total]),
  )
  const total = [...mapa.values()].reduce((a, b) => a + b, 0)
  const resumo = (Array.isArray(limpos) ? limpos[0] : limpos) as
    | { pessoas_elegiveis: number }
    | null
  return {
    todos: total,
    // A aba conta PESSOAS que ainda valem mensagem — o mesmo número da lista.
    elegiveis: Number(resumo?.pessoas_elegiveis ?? mapa.get('ELIGIBLE') ?? 0),
    enviados: mapa.get('SENT') ?? 0,
    falharam: mapa.get('FAILED') ?? 0,
    expirados: mapa.get('EXPIRED') ?? 0,
  }
}

/**
 * A oportunidade REAL, por pessoa, já com todos os filtros do banco:
 * dedupe global, quem já segue, janela de 60 dias, blacklist, expirados.
 * O número exibido é o número que pode de fato receber — nunca inflado.
 */
export async function resumoOportunidade() {
  const { data, error } = await db().rpc('oportunidades_resumo')
  if (error) throw new Error(`Falha ao resumir oportunidade: ${error.message}`)
  const r = (Array.isArray(data) ? data[0] : data) as
    | {
        comentarios_elegiveis: number
        mencoes_elegiveis: number
        pessoas_brutas: number
        pessoas_elegiveis: number
        removidas_duplicidade: number
        removidas_ja_segue: number
        removidas_follow_desconhecido: number
        removidas_dm_recente: number
        removidas_blacklist: number
        removidas_ja_na_fila: number
      }
    | undefined
  const removidas =
    Number(r?.removidas_ja_segue ?? 0) +
    Number(r?.removidas_follow_desconhecido ?? 0) +
    Number(r?.removidas_dm_recente ?? 0) +
    Number(r?.removidas_blacklist ?? 0) +
    Number(r?.removidas_ja_na_fila ?? 0)
  return {
    comentarios: Number(r?.comentarios_elegiveis ?? 0),
    mencoes: Number(r?.mencoes_elegiveis ?? 0),
    pessoasBrutas: Number(r?.pessoas_brutas ?? 0),
    pessoas: Number(r?.pessoas_elegiveis ?? 0),
    duplicatasColapsadas: Number(r?.removidas_duplicidade ?? 0),
    removidas,
    removidasDetalhe: {
      jaSegue: Number(r?.removidas_ja_segue ?? 0),
      followDesconhecido: Number(r?.removidas_follow_desconhecido ?? 0),
      dmRecente: Number(r?.removidas_dm_recente ?? 0),
      blacklist: Number(r?.removidas_blacklist ?? 0),
      jaNaFila: Number(r?.removidas_ja_na_fila ?? 0),
    },
  }
}
