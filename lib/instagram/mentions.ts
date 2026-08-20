import 'server-only'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from './account'
import { metaGet } from './meta-client'
import type { MencaoNormalizada } from './webhooks'
import { JANELA_PRIVATE_REPLY_HORAS } from '../campaigns/eligibility'

/**
 * Menções ao @vamonessasp como fonte de oportunidade.
 *
 * O webhook `mentions` entrega só media_id/comment_id. A identidade de quem
 * mencionou vem da hidratação com os campos oficiais mentioned_comment /
 * mentioned_media do IG User. O que a API não devolver fica NULL — uma menção
 * sem IGSID nunca entra na lista de DM (SEM_IGSID, como nos comentários).
 *
 * STORY_MENTION não passa por aqui: chega pelo webhook de `messages`, que
 * exige Advanced Access (App Review pendente). O schema já a comporta; o
 * ingest dela liga sozinho quando assinarmos `messages`.
 */

export async function persistirMencoes(mencoes: MencaoNormalizada[]): Promise<number> {
  if (mencoes.length === 0) return 0
  const conta = await getConnectedAccount()
  if (!conta) return 0
  const token = await getPageToken(conta.id)

  let gravadas = 0
  for (const m of mencoes) {
    let username: string | null = null
    let igsid: string | null = null
    let texto: string | null = null

    try {
      if (m.externalCommentId) {
        // Endpoint oficial para ler um comentário em que fomos mencionados.
        const r = (await metaGet(conta.instagramUserId, token, {
          fields: `mentioned_comment.comment_id(${m.externalCommentId}){id,text,username,from,timestamp}`,
        })) as { mentioned_comment?: { text?: string; username?: string; from?: { id?: string } } }
        texto = r.mentioned_comment?.text ?? null
        username = r.mentioned_comment?.username ?? null
        igsid = r.mentioned_comment?.from?.id ?? null
      } else if (m.externalMediaId) {
        const r = (await metaGet(conta.instagramUserId, token, {
          fields: `mentioned_media.media_id(${m.externalMediaId}){id,caption,username,owner}`,
        })) as { mentioned_media?: { caption?: string; username?: string; owner?: { id?: string } } }
        texto = r.mentioned_media?.caption ?? null
        username = r.mentioned_media?.username ?? null
        igsid = r.mentioned_media?.owner?.id ?? null
      }
    } catch {
      // Hidratação falhou (permissão, conteúdo apagado): grava o evento cru
      // mesmo assim — auditável, nunca elegível para DM sem IGSID.
    }

    const { error } = await db()
      .from('instagram_mentions')
      .upsert(
        {
          mention_type: m.externalCommentId ? 'COMMENT_MENTION' : 'CAPTION_MENTION',
          external_media_id: m.externalMediaId,
          external_comment_id: m.externalCommentId,
          instagram_user_id: igsid,
          username,
          text: texto,
          mentioned_at: new Date().toISOString(),
          eligibility_expires_at: new Date(
            Date.now() + JANELA_PRIVATE_REPLY_HORAS * 3_600_000,
          ).toISOString(),
          dm_status: igsid ? 'ELIGIBLE' : 'BLOCKED',
          dm_skip_reason: igsid ? null : 'SEM_IGSID',
          raw_payload: m as never,
        },
        { onConflict: 'mention_type,external_media_id,external_comment_id,instagram_user_id' },
      )
    if (!error) gravadas += 1

    if (igsid && username) {
      await db()
        .from('instagram_users')
        .upsert({ instagram_user_id: igsid, username }, { onConflict: 'instagram_user_id', ignoreDuplicates: true })
    }
  }
  // Pessoa nova cruzada com a lista guardada da exportação (regra de 20/08).
  if (gravadas > 0) await db().rpc('classificar_follow_por_export')
  return gravadas
}
