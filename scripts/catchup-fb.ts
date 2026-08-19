/** Resgate único: comentários de FB dos últimos 7 dias que o webhook perdeu
 *  (o objeto page só foi registrado em 19/08). Idempotente: upsert por id. */
import { db } from '../lib/db'
import { getConnectedAccount, getPageToken } from '../lib/instagram/account'
import { persistirComentariosFb, type ComentarioFbWebhook } from '../lib/facebook/comments'

async function main() {
  const conta = await getConnectedAccount()
  const token = await getPageToken(conta!.id)
  const desde = Math.floor(Date.now() / 1000) - 7 * 86_400
  const r = await fetch(
    `https://graph.facebook.com/v25.0/${conta!.facebookPageId}/published_posts?fields=id,created_time,comments.limit(50){id,message,from,created_time}&since=${desde}&limit=25&access_token=${token}`,
  )
  const j = (await r.json()) as {
    data?: Array<{ id: string; comments?: { data?: Array<{ id: string; message?: string; from?: { id?: string; name?: string }; created_time?: string }> } }>
    error?: { message: string }
  }
  if (j.error) throw new Error(j.error.message)

  const itens: ComentarioFbWebhook[] = []
  for (const post of j.data ?? []) {
    for (const c of post.comments?.data ?? []) {
      itens.push({
        externalCommentId: c.id,
        externalPostId: post.id,
        fromId: c.from?.id ?? null,
        fromName: c.from?.name ?? null,
        message: c.message ?? null,
        createdTime: c.created_time ? Math.floor(new Date(c.created_time).getTime() / 1000) : null,
      })
    }
  }
  const gravados = await persistirComentariosFb(itens)
  console.log(`encontrados: ${itens.length} · gravados (novos): ${gravados}`)
  process.exit(0)
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1) })
