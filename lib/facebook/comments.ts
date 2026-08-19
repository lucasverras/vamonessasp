import 'server-only'
import OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'
import { metaGet, metaPost } from '../instagram/meta-client'
import { MetaError, describeFailure } from '../instagram/errors'
import { SYSTEM_PROMPT } from '../ai/prompt'
import { contemCtaDeFollow, validarRespostaPublica } from '../ai/respostas'

/**
 * Comentários da Página do Facebook — resposta PÚBLICA em REVIEW obrigatório.
 *
 * O que a auditoria de 19/08 provou na nossa conta:
 *   - leitura de comentários: funciona (texto, id, data);
 *   - AUTOR (from): OCULTO pela Meta sem App Review → sem identidade;
 *   - private reply: exige pages_messaging (4 erros #230 reais no banco).
 * Logo: SÓ resposta pública, respondendo ao TEXTO. Nenhuma DM, nenhum
 * cooldown, nenhuma qualificação — até identidade + permissão existirem.
 *
 * Endpoint de resposta (oficial): POST /{comment-id}/comments com Page token
 * (pages_manage_engagement, presente no nosso escopo de usuário).
 */

/** Número na resposta que não existe no contexto = possível invenção. */
export function respostaInventaFato(resposta: string | null, contexto: string): boolean {
  if (!resposta) return false
  const numsResposta = resposta.match(/\d+[\d.,]*/g) ?? []
  if (numsResposta.length === 0) return false
  const numsContexto = new Set((contexto.match(/\d+[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]/g, '')))
  return numsResposta.some((n) => !numsContexto.has(n.replace(/[.,]/g, '')))
}

export interface ComentarioFbWebhook {
  externalCommentId: string
  externalPostId: string | null
  fromId: string | null
  fromName: string | null
  message: string | null
  createdTime: number | null
}

/** Extrai comentários do webhook object=page, field=feed, item=comment. */
export function extrairComentariosFb(payload: unknown): ComentarioFbWebhook[] {
  const p = payload as {
    object?: string
    entry?: Array<{ changes?: Array<{ field?: string; value?: Record<string, unknown> }> }>
  }
  if (p?.object !== 'page') return []
  const out: ComentarioFbWebhook[] = []
  for (const entry of p.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== 'feed') continue
      const v = ch.value ?? {}
      if (v.item !== 'comment' || v.verb !== 'add') continue
      const from = v.from as { id?: string; name?: string } | undefined
      if (!v.comment_id) continue
      out.push({
        externalCommentId: String(v.comment_id),
        externalPostId: v.post_id ? String(v.post_id) : null,
        fromId: from?.id ?? null,
        fromName: from?.name ?? null,
        message: typeof v.message === 'string' ? v.message : null,
        createdTime: typeof v.created_time === 'number' ? v.created_time : null,
      })
    }
  }
  return out
}

export async function persistirComentariosFb(itens: ComentarioFbWebhook[]): Promise<number> {
  if (!itens.length) return 0
  const conta = await getConnectedAccount()
  const pageId = conta?.facebookPageId

  let gravados = 0
  for (const c of itens) {
    // Nossa própria Página comentando (respostas nossas) não entra no fluxo —
    // é a proteção anti-loop, igual à do Instagram.
    if (pageId && c.fromId === pageId) continue
    const { error } = await db()
      .from('facebook_comments')
      .upsert(
        {
          external_comment_id: c.externalCommentId,
          external_post_id: c.externalPostId,
          platform_user_id: c.fromId,
          user_name: c.fromName,
          message: c.message,
          commented_at: c.createdTime ? new Date(c.createdTime * 1000).toISOString() : new Date().toISOString(),
          status: 'PENDING_AI',
          raw_payload: c as never,
        },
        { onConflict: 'external_comment_id', ignoreDuplicates: true },
      )
    if (!error) gravados++
  }
  return gravados
}

const AnaliseFb = z.object({
  intencao: z.string(),
  resposta_publica: z.string().nullable(),
  decisao: z.enum(['responder', 'aguardar_revisao', 'descartar']),
  decisao_motivo: z.string(),
  /** HIGH = óbvio · MEDIUM = exige interpretação · LOW = contexto
   *  insuficiente ou tema delicado (nunca vira sugestão automática). */
  confianca: z.enum(['HIGH', 'MEDIUM', 'LOW']),
})

let cliente: OpenAI | null = null
const openai = () => (cliente ??= new OpenAI())

/** Analisa pendentes do Facebook: sugere resposta pública, NUNCA publica. */
export async function analisarFacebookPendentes(limite = 10) {
  if (!process.env.OPENAI_API_KEY) return { analisados: 0 }
  const { data: pendentes } = await db()
    .from('facebook_comments')
    .select('id,external_comment_id,external_post_id,message,post_message')
    .eq('status', 'PENDING_AI')
    .not('message', 'is', null)
    .order('commented_at', { ascending: false })
    .limit(limite)
  if (!pendentes?.length) return { analisados: 0 }

  const conta = await getConnectedAccount()
  const token = conta ? await getPageToken(conta.id) : null

  let analisados = 0
  for (const c of pendentes) {
    try {
      // Contexto do post (legenda do FB), cacheado na linha.
      let postMsg = c.post_message as string | null
      if (!postMsg && c.external_post_id && token) {
        try {
          const post = (await metaGet(c.external_post_id, token, { fields: 'message' })) as {
            message?: string
          }
          postMsg = post.message ?? null
        } catch {
          postMsg = null
        }
      }

      const prompt = `<comentario plataforma="facebook">
${c.message}
</comentario>

<legenda_do_post>
${postMsg ?? '(indisponível)'}
</legenda_do_post>

Contexto: comentário na PÁGINA DO FACEBOOK Vamo Nessa SP. Gere só a
resposta_publica — as regras de público valem integralmente: responder ao que
a pessoa disse, 2 a 12 palavras quando o comentário permitir, sem CTA de
follow, espelhar emoji VARIANDO (❤️→🫶/😍, 🔥→🔥🔥/🙌🔥 — não o mesmo emoji
para todos). Endereço e preço SÓ se estiverem na legenda acima — nunca
estime, nunca invente. Localização desconhecida: sugira exatamente
"Vou confirmar certinho pra você 🙌" com decisao aguardar_revisao.
decisao: responder | aguardar_revisao (fato ausente, crítica, ironia,
política/religião/saúde/alergia/jurídico, ambíguo, baixa confiança) |
descartar (spam). confianca: HIGH/MEDIUM/LOW — na dúvida, LOW e
aguardar_revisao: perder uma resposta custa menos que responder besteira.`

      const r = await openai().responses.parse({
        model: 'gpt-5.6-terra',
        instructions: SYSTEM_PROMPT,
        input: [{ role: 'user', content: prompt }],
        text: { format: zodTextFormat(AnaliseFb, 'analise_fb') },
      })
      const a = r.output_parsed
      if (!a) throw new Error('sem saída estruturada')

      const ctaProibido = contemCtaDeFollow(a.resposta_publica)
      // Fato inventado: número (preço, nº de rua) na resposta que NÃO existe
      // no comentário nem na legenda = alucinação → humano decide.
      const inventaFato = respostaInventaFato(a.resposta_publica, `${c.message ?? ''} ${postMsg ?? ''}`)
      const status =
        a.decisao === 'descartar'
          ? 'SKIPPED'
          : a.decisao === 'aguardar_revisao' || ctaProibido || inventaFato ||
              a.confianca === 'LOW' || !a.resposta_publica
            ? 'NEEDS_HUMAN'
            : 'PENDING_APPROVAL'

      await db()
        .from('facebook_comments')
        .update({
          status,
          suggested_reply: a.resposta_publica,
          intent: a.intencao,
          confidence: a.confianca,
          decision_reason: ctaProibido
            ? 'CTA de follow vetado pelo validador'
            : inventaFato
              ? 'Número na resposta ausente do contexto — possível fato inventado'
              : a.decisao_motivo,
          post_message: postMsg,
        })
        .eq('id', c.id)

      // Private Reply do FB: oportunidade criada SÓ para casos seguros
      // (sensível/spam/revisão nunca recebem "segue a página").
      if (status === 'PENDING_APPROVAL') {
        const { criarPrFbSeElegivel } = await import('./private-replies')
        await criarPrFbSeElegivel(c.id)
      }
      analisados++
    } catch (e) {
      await db()
        .from('facebook_comments')
        .update({ status: 'NEEDS_HUMAN', error_message: e instanceof Error ? e.message.slice(0, 300) : String(e) })
        .eq('id', c.id)
    }
  }
  return { analisados }
}

/**
 * Publica a resposta APROVADA — claim atômico (PENDING_APPROVAL/NEEDS_HUMAN →
 * SENT só por um caminho), validador de público (CTA nunca passa), endpoint
 * oficial POST /{comment-id}/comments.
 */
export async function responderComentarioFb(
  id: string,
  aprovadoPor: string,
  textoFinal?: string,
): Promise<{ ok: boolean; detalhe: string }> {
  const { data: cfg } = await db().from('automation_settings').select('kill_switch').eq('id', true).single()
  if (cfg?.kill_switch) return { ok: false, detalhe: 'Kill switch ligado.' }

  const { data: claimed } = await db()
    .from('facebook_comments')
    .update({ status: 'SENT', approved_by: aprovadoPor })  // reservado; revertido se falhar
    .eq('id', id)
    .in('status', ['PENDING_APPROVAL', 'NEEDS_HUMAN'])
    .select('id,external_comment_id,suggested_reply')
    .maybeSingle()
  if (!claimed) return { ok: false, detalhe: 'Já processado.' }

  const texto = (textoFinal ?? claimed.suggested_reply ?? '').trim()
  const recusa = validarRespostaPublica(texto, [], { autorHumano: Boolean(textoFinal) })
  if (!texto || recusa) {
    await db().from('facebook_comments').update({ status: 'NEEDS_HUMAN', error_message: recusa ?? 'SEM_TEXTO' }).eq('id', id)
    return { ok: false, detalhe: recusa ?? 'Texto vazio.' }
  }

  try {
    const conta = await getConnectedAccount()
    const token = await getPageToken(conta!.id)
    const r = (await metaPost(`${claimed.external_comment_id}/comments`, token, {
      message: texto,
    })) as { id?: string }
    await db()
      .from('facebook_comments')
      .update({ final_reply: texto, sent_at: new Date().toISOString(), external_reply_id: r.id ?? null, error_message: null })
      .eq('id', id)
    return { ok: true, detalhe: 'Resposta publicada no Facebook.' }
  } catch (e) {
    const meta = e instanceof MetaError ? e : null
    await db()
      .from('facebook_comments')
      .update({ status: 'FAILED', error_message: meta ? describeFailure(meta) : String(e).slice(0, 300) })
      .eq('id', id)
    return { ok: false, detalhe: meta ? describeFailure(meta) : 'Falha ao publicar.' }
  }
}
