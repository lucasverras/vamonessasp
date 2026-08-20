import 'server-only'
import { db, startSyncRun } from '../db'
import { avaliarNaIngestao, expiraEm, expirarVencidos } from '../campaigns/eligibility'
import { getConnectedAccount, getPageToken } from './account'
import { MetaError } from './errors'
import { metaGetAll } from './meta-client'

/**
 * Ingestão de comentários.
 *
 * Dois caminhos que convivem sem duplicar, porque o upsert é por
 * instagram_comment_id UNIQUE:
 *
 *   webhook  → tempo real, mas sem garantia de entrega
 *   sync     → reconciliação, pega o que o webhook perdeu
 *
 * A janela varrida é de 9 dias porque a de private reply é de 7: um pouco de
 * folga para capturar comentários antigos em mídias recentes sem varrer o
 * acervo inteiro a cada 15 minutos.
 */

const JANELA_VARREDURA_DIAS = 9

export interface ComentarioNormalizado {
  instagramCommentId: string
  instagramMediaId: string
  instagramUserId: string | null
  username: string | null
  text: string | null
  parentCommentId: string | null
  commentedAt: string
  source: 'webhook' | 'sync'
}

/**
 * Grava comentários e mantém o histórico por pessoa.
 * Idempotente: reexecutar com os mesmos dados não cria linhas novas.
 */
export async function persistirComentarios(
  itens: ComentarioNormalizado[],
  contaId: string,
  igUserIdDaConta: string,
): Promise<{ gravados: number; pessoas: number }> {
  if (itens.length === 0) return { gravados: 0, pessoas: 0 }

  // 1. Pessoas primeiro: os comentários referenciam instagram_users.
  const porPessoa = new Map<string, ComentarioNormalizado>()
  for (const c of itens) {
    if (c.instagramUserId && c.instagramUserId !== igUserIdDaConta) {
      porPessoa.set(c.instagramUserId, c)
    }
  }

  if (porPessoa.size > 0) {
    const { error } = await db()
      .from('instagram_users')
      .upsert(
        [...porPessoa.values()].map((c) => ({
          instagram_user_id: c.instagramUserId!,
          username: c.username,
          last_seen_at: new Date().toISOString(),
        })),
        { onConflict: 'instagram_user_id' },
      )
    if (error) throw new Error(`Falha ao gravar pessoas: ${error.message}`)
  }

  // Pessoa nova = UNKNOWN até bater com a lista guardada da exportação.
  // Cruza AGORA, antes da análise decidir a DM (regra de 20/08: não está na
  // lista dos 30k = não segue = elegível).
  if (porPessoa.size > 0) await db().rpc('classificar_follow_por_export')

  const { data: pessoas } = await db()
    .from('instagram_users')
    .select('id,instagram_user_id')
    .in('instagram_user_id', [...porPessoa.keys()])
  const idPorIgsid = new Map((pessoas ?? []).map((p) => [p.instagram_user_id, p.id]))

  // 2. Mídias conhecidas, para ligar o comentário ao conteúdo.
  const { data: midias } = await db()
    .from('instagram_media')
    .select('id,instagram_media_id')
    .in('instagram_media_id', [...new Set(itens.map((c) => c.instagramMediaId))])
  const idPorMidia = new Map((midias ?? []).map((m) => [m.instagram_media_id, m.id]))

  const linhas = itens.map((c) => {
    const isFromAccount = c.instagramUserId === igUserIdDaConta
    const { status, motivo } = avaliarNaIngestao({
      commentedAt: c.commentedAt,
      instagramUserId: c.instagramUserId,
      isFromAccount,
    })
    return {
      instagram_comment_id: c.instagramCommentId,
      instagram_media_id: c.instagramMediaId,
      media_id: idPorMidia.get(c.instagramMediaId) ?? null,
      user_id: c.instagramUserId ? (idPorPessoaSafe(idPorIgsid, c.instagramUserId) ?? null) : null,
      instagram_user_id: c.instagramUserId,
      username: c.username,
      text: c.text,
      parent_comment_id: c.parentCommentId,
      is_from_account: isFromAccount,
      commented_at: c.commentedAt,
      source: c.source,
      eligibility_status: status,
      eligibility_expires_at: expiraEm(c.commentedAt).toISOString(),
      not_eligible_reason: motivo,
    }
  })

  // ignoreDuplicates: um comentário que já existe NÃO é reprocessado — seu
  // status de elegibilidade pode já ter evoluído para SENT, e sobrescrever com
  // ELIGIBLE reabriria a porta para envio duplicado.
  let gravados = 0
  for (let i = 0; i < linhas.length; i += 200) {
    const { data, error } = await db()
      .from('instagram_comments')
      .upsert(linhas.slice(i, i + 200), {
        onConflict: 'instagram_comment_id',
        ignoreDuplicates: true,
      })
      .select('id')
    if (error) throw new Error(`Falha ao gravar comentários: ${error.message}`)
    gravados += data?.length ?? 0
  }

  // 3. Contadores por pessoa, recalculados da fonte em vez de incrementados —
  //    incremento erra quando o mesmo lote é reprocessado.
  if (porPessoa.size > 0) {
    await db().rpc('recalcular_contadores_pessoas', {
      ids: [...porPessoa.keys()],
    })
  }

  return { gravados, pessoas: porPessoa.size }
}

function idPorPessoaSafe(mapa: Map<string, string>, igsid: string): string | undefined {
  return mapa.get(igsid)
}

interface ApiComment {
  id: string
  text?: string
  timestamp: string
  username?: string
  from?: { id: string; username?: string }
  parent_id?: string
}

/** Reconciliação: varre as mídias recentes e captura o que o webhook não trouxe. */
export async function syncComentarios() {
  const conta = await getConnectedAccount()
  if (!conta) throw new Error('Nenhuma conta conectada.')

  const run = await startSyncRun('comments')
  let requests = 0

  try {
    const token = await getPageToken(conta.id)
    const desde = new Date(Date.now() - JANELA_VARREDURA_DIAS * 86_400_000).toISOString()

    const { data: midias } = await db()
      .from('instagram_media')
      .select('instagram_media_id')
      .gte('published_at', desde)
      .is('deleted_at', null)
      .order('published_at', { ascending: false })

    const todos: ComentarioNormalizado[] = []

    for (const m of midias ?? []) {
      const { items, requests: r } = await metaGetAll<ApiComment>(
        `${m.instagram_media_id}/comments`,
        token,
        { fields: 'id,text,timestamp,username,from,parent_id', limit: 100 },
        20,
      )
      requests += r
      for (const c of items) {
        todos.push({
          instagramCommentId: c.id,
          instagramMediaId: m.instagram_media_id,
          instagramUserId: c.from?.id ?? null,
          username: c.from?.username ?? c.username ?? null,
          text: c.text ?? null,
          parentCommentId: c.parent_id ?? null,
          commentedAt: c.timestamp,
          source: 'sync',
        })
      }
    }

    const { gravados, pessoas } = await persistirComentarios(
      todos,
      conta.id,
      conta.instagramUserId,
    )
    const expirados = await expirarVencidos()

    await run.finish('SUCCESS', { records: gravados, requests })
    return { lidos: todos.length, novos: gravados, pessoas, expirados }
  } catch (error) {
    await run.finish('FAILED', {
      errorCode: error instanceof MetaError ? String(error.code) : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/**
 * Ativa os webhooks. ESCRITA de configuração — muda estado na Meta.
 *
 * São DUAS assinaturas, em lugares diferentes e com semânticas diferentes.
 * Confundi-las custou várias tentativas, então fica documentado:
 *
 *   1. OBJETO `instagram`, no nível do APP.
 *      POST /{app-id}/subscriptions com app access token e fields=comments.
 *      Diz à Meta PARA ONDE mandar e QUAIS eventos de Instagram queremos.
 *
 *   2. INSTALAÇÃO DO APP NA PÁGINA.
 *      POST /{page-id}/subscribed_apps com o Page Token.
 *      Diz à Meta DE QUAL conta entregar. Este endpoint aceita apenas campos de
 *      PÁGINA — `comments` NÃO é um deles, e a Meta responde listando os
 *      válidos. Mesmo assim `subscribed_fields` é obrigatório, então usamos
 *      `name`: instala o app com o mínimo de ruído possível, porque o nome de
 *      uma Página praticamente nunca muda. Os comentários chegam pela
 *      assinatura (1), não por este campo.
 *
 * Sem (1) a Meta não sabe para onde mandar. Sem (2) sabe, mas não envia desta
 * conta — foi exatamente o que aconteceu: assinatura ativa, zero entregas.
 */
export async function assinarWebhooks() {
  const conta = await getConnectedAccount()
  if (!conta?.facebookPageId) throw new Error('Página do Facebook não vinculada.')

  const { metaPost, metaGet } = await import('./meta-client')
  const { env, callbacks } = await import('../env')

  const resultados: Record<string, unknown> = {}
  const appToken = `${env.metaAppId}|${env.metaAppSecret}`

  try {
    // comments + mentions: menção em comentário/legenda chega pelo field
    // oficial `mentions`. Story mention chega por `messages`, que exige
    // Advanced Access — não assinamos o que ainda não podemos receber.
    resultados.objetoInstagram = await metaPost(`${env.metaAppId}/subscriptions`, appToken, {
      object: 'instagram',
      callback_url: callbacks.webhook,
      fields: 'comments,mentions',
      verify_token: env.webhookVerifyToken,
      include_values: 'true',
    })

    // OBJETO PAGE é um registro SEPARADO no nível do app — o subscribed_apps
    // da Página sozinho não entrega nada. Ficou faltando e o resultado foi
    // zero eventos de Facebook apesar da assinatura da Página estar certa
    // (diagnóstico de 19/08: comentários reais aconteciam e nada chegava).
    resultados.objetoPage = await metaPost(`${env.metaAppId}/subscriptions`, appToken, {
      object: 'page',
      callback_url: callbacks.webhook,
      fields: 'feed',
      verify_token: env.webhookVerifyToken,
      include_values: 'true',
    })
  } catch (e) {
    resultados.objetoInstagram = { erro: e instanceof Error ? e.message : String(e) }
  }

  try {
    const pageToken = await getPageToken(conta.id)
    resultados.instalacaoNaPagina = await metaPost(
      `${conta.facebookPageId}/subscribed_apps`,
      pageToken,
      { subscribed_fields: 'name' },
    )
    resultados.conferencia = await metaGet(`${conta.facebookPageId}/subscribed_apps`, pageToken)
  } catch (e) {
    resultados.instalacaoNaPagina = { erro: e instanceof Error ? e.message : String(e) }
  }

  return resultados
}
