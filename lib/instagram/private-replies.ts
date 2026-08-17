import 'server-only'
import { metaPost } from './meta-client'

/**
 * Resposta privada a um comentário.
 *
 * Endpoint verificado em 17/08/2026: POST /{page-id}/messages com
 * recipient: { comment_id }. Regras da Meta que o código respeita:
 *
 *   • 7 dias contados da CRIAÇÃO do comentário, não do recebimento do webhook
 *   • UMA mensagem por comentário, para sempre
 *   • 750 chamadas/hora para comentários de post e reel
 *
 * A elegibilidade NÃO é checada aqui: quem chama já revalidou. Este módulo só
 * fala com a Meta, para que a regra viva num lugar só.
 */

export interface RespostaPrivada {
  recipient_id: string
  message_id: string
}

export async function enviarRespostaPrivada(args: {
  pageId: string
  pageToken: string
  commentId: string
  texto: string
}): Promise<RespostaPrivada> {
  return metaPost<RespostaPrivada>(`${args.pageId}/messages`, args.pageToken, {
    recipient: { comment_id: args.commentId },
    message: { text: args.texto },
  })
}
