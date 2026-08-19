import 'server-only'
import { revalidar, type MotivoInelegivel } from './eligibility'

/**
 * evaluateDmEligibility — a FACHADA ÚNICA da regra de DM (spec Parte 3).
 *
 * A regra mora em UM lugar (revalidar, em eligibility.ts) e é consumida por
 * quatro chamadores — prévia da UI, criação de campanha, aprovação explícita e
 * worker — sempre através desta função ou de revalidar diretamente. Este
 * módulo dá o contrato da spec: {status, reason} com o enum padronizado.
 *
 * A ordem é a da spec: própria conta → identidade → janela Meta → segue? →
 * 60 dias? → QUALIFIED.
 */

export type RejectionReason =
  | 'ALREADY_FOLLOWING'
  | 'RECENT_PRIVATE_REPLY'
  | 'DUPLICATE_USER'
  | 'META_NOT_ELIGIBLE'
  | 'FOLLOW_STATUS_UNKNOWN'
  | 'SENSITIVE_INTERACTION'
  | 'BLOCKED_USER'
  | 'OUR_OWN_ACCOUNT'
  | 'EXPIRED'
  | 'INVALID_IDENTITY'
  | 'ERROR'

export type DmEligibility =
  | { status: 'QUALIFIED'; reason: 'ELIGIBLE' }
  | { status: 'REJECTED'; reason: RejectionReason; detail?: string }

/** Tradução 1:1 do vocabulário interno para o enum da spec — o MESMO mapa da
 *  função SQL motivo_padrao(); teste automatizado garante a paridade. */
export const MOTIVO_PARA_ENUM: Record<MotivoInelegivel, RejectionReason> = {
  FORA_DA_JANELA: 'META_NOT_ELIGIBLE',
  JA_RESPONDIDO: 'DUPLICATE_USER',
  SEM_IGSID: 'INVALID_IDENTITY',
  COMENTARIO_PROPRIO: 'OUR_OWN_ACCOUNT',
  COMENTARIO_APAGADO: 'META_NOT_ELIGIBLE',
  PESSOA_NA_BLACKLIST: 'BLOCKED_USER',
  JA_RECEBEU_DESTE_CONTEUDO: 'DUPLICATE_USER',
  JA_NA_FILA: 'DUPLICATE_USER',
  JA_SEGUE: 'ALREADY_FOLLOWING',
  DM_RECENTE: 'RECENT_PRIVATE_REPLY',
}

export async function evaluateDmEligibility(
  commentId: string,
  opts?: { ignorarAcaoId?: string },
): Promise<DmEligibility> {
  const v = await revalidar(commentId, opts?.ignorarAcaoId)
  if (v.pode) return { status: 'QUALIFIED', reason: 'ELIGIBLE' }
  return {
    status: 'REJECTED',
    reason: v.motivo ? MOTIVO_PARA_ENUM[v.motivo] : 'ERROR',
    detail: v.detalhe,
  }
}
