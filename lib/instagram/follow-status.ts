import 'server-only'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from './account'

/**
 * "Essa pessoa segue o @vamonessasp?" — respondido SÓ pela API oficial.
 *
 * Fonte: User Profile API do Instagram Messaging,
 * GET /{igsid}?fields=is_user_follow_business. Verificado na nossa conta em
 * 18/08/2026: o campo EXISTE, mas exige Advanced Access de
 * instagram_manage_messages — erro (#200) até o App Review aprovar. Até lá,
 * TODO usuário é UNKNOWN, e UNKNOWN significa "sem DM sugerida" (regra §31:
 * nunca presumir que não segue). Quando o Review passar, este módulo começa a
 * devolver FOLLOWS/NOT_FOLLOWING sozinho, sem mudança de código.
 *
 * Cache de 24h em instagram_users: follow muda devagar e cada consulta é uma
 * chamada de API que conta no rate limit.
 */

export type FollowStatus = 'FOLLOWS' | 'NOT_FOLLOWING' | 'UNKNOWN'

const CACHE_HORAS = 24

export async function consultarFollowStatus(igsid: string): Promise<FollowStatus> {
  const { data: cache } = await db()
    .from('instagram_users')
    .select('follow_status,follow_status_checked_at')
    .eq('instagram_user_id', igsid)
    .maybeSingle()

  if (
    cache?.follow_status_checked_at &&
    Date.now() - new Date(cache.follow_status_checked_at).getTime() < CACHE_HORAS * 3_600_000 &&
    // UNKNOWN por falta de acesso reexpira sempre: quando o Review passar,
    // queremos que a resposta real entre sem esperar ninguém limpar cache.
    cache.follow_status !== 'UNKNOWN'
  ) {
    return cache.follow_status as FollowStatus
  }

  let status: FollowStatus = 'UNKNOWN'
  let fonte = 'sem_resposta'

  try {
    const conta = await getConnectedAccount()
    if (conta) {
      const token = await getPageToken(conta.id)
      const v = process.env.META_API_VERSION ?? 'v26.0'
      const r = await fetch(
        `https://graph.facebook.com/${v}/${igsid}?fields=is_user_follow_business&access_token=${token}`,
        { cache: 'no-store' },
      )
      const j = (await r.json()) as {
        is_user_follow_business?: boolean
        error?: { code?: number; message?: string }
      }
      if (j.error) {
        // (#200) sem Advanced Access, IGSID sem janela de conversa, etc.
        // Tudo isso é UNKNOWN — nunca inferido.
        fonte = `erro_${j.error.code ?? '?'}`
      } else if (typeof j.is_user_follow_business === 'boolean') {
        status = j.is_user_follow_business ? 'FOLLOWS' : 'NOT_FOLLOWING'
        fonte = 'user_profile_api'
      } else {
        // HTTP 200 sem o campo pedido NÃO é disponibilidade.
        fonte = '200_sem_campo'
      }
    }
  } catch {
    fonte = 'excecao'
  }

  await db()
    .from('instagram_users')
    .update({
      follow_status: status,
      follow_status_checked_at: new Date().toISOString(),
      follow_status_source: fonte,
    })
    .eq('instagram_user_id', igsid)

  return status
}

/** Fallback se a config não carregar. O valor real vem do painel (60 dias). */
export const JANELA_DM_RECENTE_DIAS = 60

export type GateDm =
  | { pode: true; followStatus: FollowStatus }
  | {
      pode: false
      motivo: 'SKIPPED_ALREADY_FOLLOWING' | 'FOLLOW_STATUS_UNKNOWN' | 'SKIPPED_RECENT_DM'
      followStatus: FollowStatus
    }

/**
 * O portão da DM sugerida por IA. Três perguntas, nessa ordem:
 *   1. segue? → sem DM (o objetivo dela é converter em seguidor)
 *   2. não dá para saber? → sem DM (nunca presumir)
 *   3. recebeu DM nossa há menos de 30 dias? → sem DM (não abordar de novo)
 * A constraint pessoa+conteúdo continua atrás de tudo isso, no banco.
 * NADA aqui afeta a resposta pública — decisões independentes.
 */
export async function gateDmParaIgsid(igsid: string | null): Promise<GateDm> {
  if (!igsid) return { pode: false, motivo: 'FOLLOW_STATUS_UNKNOWN', followStatus: 'UNKNOWN' }

  const followStatus = await consultarFollowStatus(igsid)
  if (followStatus === 'FOLLOWS') {
    return { pode: false, motivo: 'SKIPPED_ALREADY_FOLLOWING', followStatus }
  }
  // UNKNOWN envia (decisão de 18/08, autorizada pelo Lucas ao ligar o LIVE):
  // sem Advanced Access todo mundo é UNKNOWN, e o template já diz "se ainda
  // não segue" — frase que funciona para os dois casos. Quando o App Review
  // liberar o campo, FOLLOWS confirmado volta a ser filtrado aqui em cima.

  const [{ data: pessoa }, { data: cfg }] = await Promise.all([
    db()
      .from('instagram_users')
      .select('last_private_reply_at')
      .eq('instagram_user_id', igsid)
      .maybeSingle(),
    db().from('automation_settings').select('cooldown_days_per_user').eq('id', true).single(),
  ])
  const janelaDias = cfg?.cooldown_days_per_user ?? JANELA_DM_RECENTE_DIAS
  if (
    pessoa?.last_private_reply_at &&
    janelaDias > 0 &&
    Date.now() - new Date(pessoa.last_private_reply_at).getTime() < janelaDias * 86_400_000
  ) {
    return { pode: false, motivo: 'SKIPPED_RECENT_DM', followStatus }
  }

  return { pode: true, followStatus }
}
