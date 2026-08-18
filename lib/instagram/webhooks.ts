import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../env'
import type { ComentarioNormalizado } from './comments'

/**
 * Verificação e normalização dos webhooks da Meta.
 *
 * A assinatura é calculada sobre o corpo CRU. Reserializar o JSON antes de
 * verificar quebra a comparação — qualquer diferença de espaço ou ordem de
 * chaves muda o HMAC. Por isso a rota lê `await request.text()` e passa a
 * string original para cá.
 */

export function assinaturaValida(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith('sha256=')) return false

  const recebida = Buffer.from(header.slice('sha256='.length), 'hex')
  const esperada = createHmac('sha256', env.metaAppSecret).update(rawBody, 'utf8').digest()

  // Tamanhos diferentes fazem timingSafeEqual lançar; comparamos antes.
  if (recebida.length !== esperada.length) return false
  return timingSafeEqual(recebida, esperada)
}

/** Chave de deduplicação: a Meta pode reentregar o mesmo evento. */
export function chaveDeDedupe(payload: unknown, raw: string): string {
  const p = payload as WebhookPayload
  const partes: string[] = []
  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value as { id?: string }
      if (v?.id) partes.push(`${change.field}:${v.id}`)
    }
  }
  if (partes.length > 0) return partes.sort().join('|')
  // Sem id identificável, cai para o hash do corpo — pior granularidade, mas
  // ainda impede que a MESMA entrega seja processada duas vezes.
  return `hash:${createHmac('sha256', 'dedupe').update(raw).digest('hex').slice(0, 32)}`
}

interface WebhookPayload {
  object?: string
  entry?: Array<{
    id?: string
    time?: number
    changes?: Array<{ field: string; value: Record<string, unknown> }>
  }>
}

/**
 * Extrai comentários do payload.
 *
 * Formato REAL, capturado de uma entrega da Meta em 17/08/2026 — a
 * documentação não traz exemplo completo:
 *
 *   {
 *     "object": "instagram",
 *     "entry": [{
 *       "id": "<IG_USER_ID>",
 *       "time": 1787000003,
 *       "changes": [{
 *         "field": "comments",
 *         "value": {
 *           "id": "<COMMENT_ID>",
 *           "from": { "id": "<IGSID>", "username": "..." },
 *           "text": "Onde fica?",
 *           "media": { "id": "<MEDIA_ID>", "media_product_type": "REELS" }
 *         }
 *       }]
 *     }]
 *   }
 *
 * ATENÇÃO: o `value` NÃO traz timestamp nem created_time. A data do comentário
 * é derivada de `entry.time`, e a leitura defensiva abaixo — que existia por
 * precaução — acabou sendo o que fez a primeira entrega real funcionar.
 * Delay medido do comentário até o banco: 3 segundos.
 */
export function extrairComentarios(payload: unknown): ComentarioNormalizado[] {
  const p = payload as WebhookPayload
  const out: ComentarioNormalizado[] = []

  for (const entry of p?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'comments') continue

      const v = change.value as {
        id?: string
        text?: string
        created_time?: number
        timestamp?: string
        parent_id?: string
        from?: { id?: string; username?: string }
        media?: { id?: string }
      }
      if (!v.id) continue

      const quando =
        v.timestamp ??
        (typeof v.created_time === 'number'
          ? new Date(v.created_time * 1000).toISOString()
          : new Date((entry.time ?? Date.now() / 1000) * 1000).toISOString())

      out.push({
        instagramCommentId: v.id,
        instagramMediaId: v.media?.id ?? '',
        instagramUserId: v.from?.id ?? null,
        username: v.from?.username ?? null,
        text: v.text ?? null,
        parentCommentId: v.parent_id ?? null,
        commentedAt: quando,
        source: 'webhook',
      })
    }
  }

  return out.filter((c) => c.instagramMediaId !== '')
}

export function campoDoEvento(payload: unknown): string | null {
  const p = payload as WebhookPayload
  return p?.entry?.[0]?.changes?.[0]?.field ?? null
}

export interface MencaoNormalizada {
  /** comment_id presente = menção em comentário (private reply clássica
   *  funciona). Ausente = menção em legenda. */
  externalMediaId: string | null
  externalCommentId: string | null
}

/**
 * Extrai menções do field oficial `mentions` (object=instagram).
 *
 * Formato documentado pela Meta: value = { media_id, comment_id? }. O payload
 * NÃO traz autor nem texto — esses vêm de uma consulta posterior com o
 * endpoint de mentioned_comment/mentioned_media. Nada aqui é inventado: o que
 * o webhook não entrega fica null e é hidratado (ou não) pela API.
 */
export function extrairMencoes(payload: unknown): MencaoNormalizada[] {
  const p = payload as WebhookPayload
  const out: MencaoNormalizada[] = []
  for (const entry of p?.entry ?? []) {
    for (const ch of entry?.changes ?? []) {
      if (ch?.field !== 'mentions') continue
      const v = ch.value as { media_id?: string; comment_id?: string } | undefined
      if (!v?.media_id && !v?.comment_id) continue
      out.push({
        externalMediaId: v.media_id ?? null,
        externalCommentId: v.comment_id ?? null,
      })
    }
  }
  return out
}
