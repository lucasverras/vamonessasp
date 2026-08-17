import 'server-only'
import { db } from '../db'

/**
 * REGRA ÚNICA de elegibilidade para Private Reply.
 *
 * Este módulo é a autoridade. A tela apenas exibe o que ele decidiu, e o worker
 * o consulta DE NOVO no instante do envio — porque entre a seleção e o
 * processamento o comentário pode ter expirado, sido apagado, já ter recebido
 * resposta, ou a pessoa pode ter entrado na blacklist.
 *
 * Regra oficial da Meta, verificada em 17/08/2026: a resposta privada só pode
 * ser enviada dentro de 7 dias da CRIAÇÃO do comentário — não do recebimento do
 * webhook — e apenas UMA vez por comentário, para sempre.
 */

/** Janela oficial. Fica nomeada para ser um lugar só, se a Meta mudar. */
export const JANELA_PRIVATE_REPLY_HORAS = 7 * 24

export type MotivoInelegivel =
  | 'FORA_DA_JANELA'
  | 'JA_RESPONDIDO'
  | 'SEM_IGSID'
  | 'COMENTARIO_PROPRIO'
  | 'COMENTARIO_APAGADO'
  | 'PESSOA_NA_BLACKLIST'
  | 'COOLDOWN_DA_PESSOA'
  | 'KILL_SWITCH_ATIVO'

export function expiraEm(comentadoEm: Date | string): Date {
  const base = typeof comentadoEm === 'string' ? new Date(comentadoEm) : comentadoEm
  return new Date(base.getTime() + JANELA_PRIVATE_REPLY_HORAS * 3_600_000)
}

/** Avaliação sem consultar o banco — usada na ingestão de cada comentário. */
export function avaliarNaIngestao(input: {
  commentedAt: string
  instagramUserId: string | null
  isFromAccount: boolean
}): { status: 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'EXPIRED'; motivo: MotivoInelegivel | null } {
  if (input.isFromAccount) return { status: 'NOT_ELIGIBLE', motivo: 'COMENTARIO_PROPRIO' }
  if (!input.instagramUserId) return { status: 'NOT_ELIGIBLE', motivo: 'SEM_IGSID' }
  if (expiraEm(input.commentedAt).getTime() <= Date.now()) {
    return { status: 'EXPIRED', motivo: 'FORA_DA_JANELA' }
  }
  return { status: 'ELIGIBLE', motivo: null }
}

export interface Veredito {
  pode: boolean
  motivo: MotivoInelegivel | null
  detalhe?: string
}

/**
 * Revalidação COMPLETA, imediatamente antes de enviar. Backend é autoridade:
 * nunca confiar no estado que a tela enviou.
 */
export async function revalidar(commentId: string): Promise<Veredito> {
  const { data: cfg } = await db()
    .from('automation_settings')
    .select('kill_switch,cooldown_days_per_user')
    .eq('id', true)
    .single()

  if (cfg?.kill_switch) return { pode: false, motivo: 'KILL_SWITCH_ATIVO' }

  const { data: c } = await db()
    .from('instagram_comments')
    .select(
      'id,instagram_comment_id,instagram_user_id,is_from_account,commented_at,eligibility_expires_at,deleted_at,eligibility_status',
    )
    .eq('id', commentId)
    .maybeSingle()

  if (!c) return { pode: false, motivo: 'COMENTARIO_APAGADO', detalhe: 'não está no banco' }
  if (c.deleted_at) return { pode: false, motivo: 'COMENTARIO_APAGADO' }
  if (c.is_from_account) return { pode: false, motivo: 'COMENTARIO_PROPRIO' }
  if (!c.instagram_user_id) return { pode: false, motivo: 'SEM_IGSID' }
  if (new Date(c.eligibility_expires_at).getTime() <= Date.now()) {
    return { pode: false, motivo: 'FORA_DA_JANELA' }
  }

  // Uma resposta por comentário, para sempre. Além da constraint no banco,
  // checamos aqui para poder registrar o motivo em vez de estourar erro.
  const { count: jaEnviado } = await db()
    .from('comment_actions')
    .select('id', { count: 'exact', head: true })
    .eq('comment_id', c.id)
    .eq('action_type', 'PRIVATE_REPLY')
    .eq('status', 'SENT')
  if ((jaEnviado ?? 0) > 0) return { pode: false, motivo: 'JA_RESPONDIDO' }

  const { data: pessoa } = await db()
    .from('instagram_users')
    .select('is_blacklisted,last_private_reply_at')
    .eq('instagram_user_id', c.instagram_user_id)
    .maybeSingle()

  if (pessoa?.is_blacklisted) return { pode: false, motivo: 'PESSOA_NA_BLACKLIST' }

  // Cooldown por pessoa: decisão nossa, mais restritiva que a Meta exige.
  // Evita que alguém que comenta em todo Reel receba mensagem toda semana.
  const cooldownDias = cfg?.cooldown_days_per_user ?? 90
  if (pessoa?.last_private_reply_at && cooldownDias > 0) {
    const desde = Date.now() - new Date(pessoa.last_private_reply_at).getTime()
    if (desde < cooldownDias * 86_400_000) {
      return {
        pode: false,
        motivo: 'COOLDOWN_DA_PESSOA',
        detalhe: `última mensagem há ${Math.floor(desde / 86_400_000)} dias`,
      }
    }
  }

  return { pode: true, motivo: null }
}

/**
 * Marca como EXPIRED quem passou da janela. Roda no cron: sem isso, a tela
 * mostraria como elegível quem já não é.
 */
export async function expirarVencidos(): Promise<number> {
  const { data } = await db()
    .from('instagram_comments')
    .update({ eligibility_status: 'EXPIRED', not_eligible_reason: 'FORA_DA_JANELA' })
    .eq('eligibility_status', 'ELIGIBLE')
    .lte('eligibility_expires_at', new Date().toISOString())
    .select('id')
  return data?.length ?? 0
}
