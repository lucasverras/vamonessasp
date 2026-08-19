import 'server-only'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'
import { metaPost } from '../instagram/meta-client'
import { MetaError, describeFailure, ehErroDePolitica } from '../instagram/errors'

/**
 * Private Reply do FACEBOOK (Messenger) — POST /{page-id}/messages com
 * recipient {comment_id}: endpoint oficial de private replies para comentários
 * de posts de Página. Exige pages_messaging (HOJE AUSENTE do token — cada
 * tentativa falhará com #230 até a re-autorização + App Review; a
 * implementação está completa e a flag fb_private_reply_enabled é o portão).
 *
 * Regras (Lucas, 19/08):
 *  - follow_status NÃO é critério no Facebook;
 *  - cooldown de 60 dias POR USUÁRIO quando a identidade existir;
 *  - sem identidade (Meta oculta `from` sem App Review): proteção por
 *    comment_id apenas — a mais segura disponível — com a limitação REGISTRADA
 *    em cooldown_scope='COMMENT_ONLY';
 *  - nunca duas por comentário (unique no banco);
 *  - anti-loop: comentários da própria Página nunca entram (filtro no ingest);
 *  - kill switch soberano; claim atômico; erro de política trava tudo.
 */

/** Cria a oportunidade de PR para um comentário do FB (idempotente). */
export async function criarPrFbSeElegivel(commentRowId: string): Promise<void> {
  const { data: cfg } = await db()
    .from('automation_settings')
    .select('fb_private_reply_enabled,fb_dm_template,cooldown_days_per_user')
    .eq('id', true)
    .single()
  if (!cfg?.fb_private_reply_enabled) return

  const { data: c } = await db()
    .from('facebook_comments')
    .select('id,external_comment_id,platform_user_id')
    .eq('id', commentRowId)
    .maybeSingle()
  if (!c) return

  // Cooldown 60d por usuário — só aplicável quando a Meta entrega identidade.
  let scope: 'USER' | 'COMMENT_ONLY' = 'COMMENT_ONLY'
  if (c.platform_user_id) {
    scope = 'USER'
    const desde = new Date(
      Date.now() - (cfg.cooldown_days_per_user ?? 60) * 86_400_000,
    ).toISOString()
    const { count } = await db()
      .from('facebook_private_replies')
      .select('id', { count: 'exact', head: true })
      .eq('platform_user_id', c.platform_user_id)
      .eq('status', 'SENT')
      .gte('sent_at', desde)
    if ((count ?? 0) > 0) {
      await db().from('facebook_private_replies').insert({
        comment_row_id: c.id,
        external_comment_id: c.external_comment_id,
        platform_user_id: c.platform_user_id,
        status: 'SKIPPED',
        skip_reason: 'RECENT_PRIVATE_REPLY',
        cooldown_scope: scope,
      })
      return
    }
  }

  // unique em external_comment_id: reentrega do webhook colide aqui — 23505
  // é idempotência funcionando, não erro.
  await db().from('facebook_private_replies').insert({
    comment_row_id: c.id,
    external_comment_id: c.external_comment_id,
    platform_user_id: c.platform_user_id,
    template_snapshot: cfg.fb_dm_template,
    cooldown_scope: scope,
  })
}

/** Processa ELIGIBLE → envia. Chamado pelo cron; no-op com flag desligada. */
export async function processarPrivateRepliesFb(lote = 5): Promise<{
  enviadas: number
  falhas: number
  puladas: number
}> {
  const r = { enviadas: 0, falhas: 0, puladas: 0 }
  const { data: cfg } = await db()
    .from('automation_settings')
    .select('kill_switch,fb_private_reply_enabled,cooldown_days_per_user')
    .eq('id', true)
    .single()
  if (!cfg?.fb_private_reply_enabled || cfg.kill_switch) return r

  const conta = await getConnectedAccount()
  if (!conta?.facebookPageId) return r

  // Sem pages_messaging no token, TODO envio falharia com #230 — em vez de
  // fabricar FAILED em loop, as PRs esperam como ELIGIBLE e disparam sozinhas
  // quando a re-autorização + App Review trouxerem o escopo.
  if (!conta.scopes.includes('pages_messaging')) return r

  const token = await getPageToken(conta.id)

  const { data: pendentes } = await db()
    .from('facebook_private_replies')
    .select('id,external_comment_id,platform_user_id,template_snapshot,cooldown_scope')
    .eq('status', 'ELIGIBLE')
    .order('created_at')
    .limit(lote)

  for (const pr of pendentes ?? []) {
    // CLAIM atômico: só quem mover ELIGIBLE→SENDING envia.
    const { data: claimed } = await db()
      .from('facebook_private_replies')
      .update({ status: 'SENDING' })
      .eq('id', pr.id)
      .eq('status', 'ELIGIBLE')
      .select('id')
      .maybeSingle()
    if (!claimed) continue

    // Revalidação do cooldown NO INSTANTE do envio (estado pode ter mudado).
    if (pr.platform_user_id) {
      const desde = new Date(
        Date.now() - (cfg.cooldown_days_per_user ?? 60) * 86_400_000,
      ).toISOString()
      const { count } = await db()
        .from('facebook_private_replies')
        .select('id', { count: 'exact', head: true })
        .eq('platform_user_id', pr.platform_user_id)
        .eq('status', 'SENT')
        .gte('sent_at', desde)
      if ((count ?? 0) > 0) {
        await db()
          .from('facebook_private_replies')
          .update({ status: 'SKIPPED', skip_reason: 'RECENT_PRIVATE_REPLY' })
          .eq('id', pr.id)
        r.puladas++
        continue
      }
    }

    try {
      const resp = (await metaPost(`${conta.facebookPageId}/messages`, token, {
        recipient: JSON.stringify({ comment_id: pr.external_comment_id }),
        message: JSON.stringify({ text: pr.template_snapshot ?? '' }),
        messaging_type: 'RESPONSE',
      })) as { message_id?: string }
      await db()
        .from('facebook_private_replies')
        .update({
          status: 'SENT',
          sent_at: new Date().toISOString(),
          external_message_id: resp.message_id ?? null,
          error_message: null,
        })
        .eq('id', pr.id)
      r.enviadas++
    } catch (e) {
      const meta = e instanceof MetaError ? e : null
      if (ehErroDePolitica(e)) {
        await db()
          .from('automation_settings')
          .update({ kill_switch: true, updated_by: 'auto: política Meta (FB private reply)' })
          .eq('id', true)
      }
      await db()
        .from('facebook_private_replies')
        .update({
          status: 'FAILED',
          error_message: meta ? describeFailure(meta) : String(e).slice(0, 300),
        })
        .eq('id', pr.id)
      r.falhas++
      // Permissão ausente (#230) derruba TODAS: parar o lote, não martelar.
      if (meta?.code === 230 || meta?.code === 200) break
    }
  }
  return r
}
