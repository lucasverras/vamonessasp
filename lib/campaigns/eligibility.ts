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
  | 'JA_RECEBEU_DESTE_CONTEUDO'
  | 'JA_NA_FILA'
  | 'JA_SEGUE'
  | 'FOLLOW_STATUS_UNKNOWN'
  | 'DM_RECENTE'

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
 * Revalidação COMPLETA de UM comentário. Backend é autoridade: nunca confiar no
 * estado que a tela enviou.
 *
 * Responde apenas "este comentário pode receber mensagem?". Deliberadamente NÃO
 * consulta o kill switch: essa é a pergunta "o sistema deve estar enviando
 * agora?", que pertence ao worker. Misturar as duas fazia o kill switch impedir
 * até MONTAR a fila — o oposto do que a interface promete, que é preparar tudo e
 * liberar depois.
 */
export async function revalidar(
  commentId: string,
  /**
   * Ação a ignorar na checagem de "já na fila".
   *
   * O worker reserva o item marcando SENDING e só então revalida — sem esta
   * exclusão ele encontra A PRÓPRIA AÇÃO e conclui que o comentário já está na
   * fila, ignorando todo envio. Auto-colisão silenciosa: nenhum erro, nenhuma
   * mensagem, e o motivo registrado parecia legítimo.
   */
  ignorarAcaoId?: string,
  /**
   * SÓ a aprovação individual (um humano olhando ESTA pessoa e clicando) pode
   * passar true. Todo caminho em massa — campanha, qualificados, worker de
   * fila de campanha — usa o default false.
   */
  opcoes?: { permitirFollowDesconhecido?: boolean },
): Promise<Veredito> {
  const { data: c } = await db()
    .from('instagram_comments')
    .select(
      'id,instagram_comment_id,instagram_user_id,media_id,is_from_account,commented_at,eligibility_expires_at,deleted_at,eligibility_status',
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

  // A REGRA DO PRODUTO: uma private reply por PESSOA+CONTEÚDO. A mesma pessoa
  // em dois Reels diferentes recebe duas — de propósito. O mesmo Reel, nunca
  // duas. A garantia final é a unique parcial no banco; esta checagem existe
  // para registrar o motivo em vez de estourar 23505.
  const { count: jaEnviadoDoPar } = await db()
    .from('comment_actions')
    .select('id', { count: 'exact', head: true })
    .eq('instagram_user_id', c.instagram_user_id)
    .eq('media_id', c.media_id)
    .eq('action_type', 'PRIVATE_REPLY')
    .eq('status', 'SENT')
  if ((jaEnviadoDoPar ?? 0) > 0) {
    return { pode: false, motivo: 'JA_RECEBEU_DESTE_CONTEUDO' }
  }

  // Reserva pendente para o mesmo PAR (não o mesmo comentário): outro
  // comentário da pessoa no mesmo Reel pode já ter reservado a DM.
  let filaQuery = db()
    .from('comment_actions')
    .select('id', { count: 'exact', head: true })
    .eq('instagram_user_id', c.instagram_user_id)
    .eq('media_id', c.media_id)
    .eq('action_type', 'PRIVATE_REPLY')
    .in('status', ['QUEUED', 'SENDING', 'PENDING_APPROVAL', 'APPROVED'])
  if (ignorarAcaoId) filaQuery = filaQuery.neq('id', ignorarAcaoId)
  const { count: jaNaFila } = await filaQuery
  if ((jaNaFila ?? 0) > 0) return { pode: false, motivo: 'JA_NA_FILA' }

  const [{ data: pessoa }, { data: cfg }] = await Promise.all([
    db()
      .from('instagram_users')
      .select('is_blacklisted,last_private_reply_at,follow_status')
      .eq('instagram_user_id', c.instagram_user_id)
      .maybeSingle(),
    db().from('automation_settings').select('cooldown_days_per_user').eq('id', true).single(),
  ])

  if (pessoa?.is_blacklisted) return { pode: false, motivo: 'PESSOA_NA_BLACKLIST' }

  // FOLLOWS é bloqueio duro em qualquer caminho.
  if (pessoa?.follow_status === 'FOLLOWS') {
    return { pode: false, motivo: 'JA_SEGUE' }
  }

  // INCIDENTE 20/08/2026: deixar UNKNOWN passar aqui mandou 118 DMs em massa
  // para gente sem prova de follow — e parte delas eram seguidores que o
  // export não casou por username. REGRA REFEITA: DM em massa SÓ para
  // NOT_FOLLOWING comprovado (export/manual/API). UNKNOWN só atravessa quando
  // um humano aprovou ESTA pessoa individualmente (permitirFollowDesconhecido).
  if (pessoa?.follow_status !== 'NOT_FOLLOWING' && !opcoes?.permitirFollowDesconhecido) {
    return {
      pode: false,
      motivo: 'FOLLOW_STATUS_UNKNOWN',
      detalhe: 'sem prova de que não segue — só por aprovação individual',
    }
  }

  // REGRA GLOBAL (18/08/2026, reverte a decisão de 17/08): UMA private reply
  // por PESSOA a cada N dias (60 por padrão), independente do conteúdo.
  // João no Reel A hoje e no Reel B em 2h → uma DM só. A janela é editável
  // no painel; a fonte de last_private_reply_at é um trigger no envio.
  const cooldownDias = cfg?.cooldown_days_per_user ?? 60
  if (pessoa?.last_private_reply_at && cooldownDias > 0) {
    const desde = Date.now() - new Date(pessoa.last_private_reply_at).getTime()
    if (desde < cooldownDias * 86_400_000) {
      return {
        pode: false,
        motivo: 'DM_RECENTE',
        detalhe: `última DM há ${Math.floor(desde / 86_400_000)} dias (janela: ${cooldownDias})`,
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
