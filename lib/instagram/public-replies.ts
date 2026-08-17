import 'server-only'
import { metaPost } from './meta-client'

/**
 * Resposta PÚBLICA a um comentário do Instagram.
 *
 * Endpoint oficial: POST /{ig-comment-id}/replies com `message`, usando o Page
 * Access Token (Instagram API with Facebook Login). A resposta aparece aninhada
 * sob o comentário original, como se respondida pelo app do Instagram.
 *
 * Cuidados que pertencem a quem chama, não a este módulo:
 *   • dedupe por comentário (unique parcial em comment_actions);
 *   • loop: nossa resposta volta pelo webhook como comentário NOSSO —
 *     `is_from_account` a marca e a ingestão a descarta do pipeline;
 *   • a Meta não documenta janela de 7 dias para replies públicas, mas
 *     respondemos apenas comentários recentes por decisão de produto.
 */

export interface RespostaPublica {
  id: string
}

export async function enviarRespostaPublica(args: {
  pageToken: string
  /** ID do comentário NO INSTAGRAM (instagram_comment_id), não o uuid interno. */
  commentId: string
  texto: string
}): Promise<RespostaPublica> {
  return metaPost<RespostaPublica>(`${args.commentId}/replies`, args.pageToken, {
    message: args.texto,
  })
}
