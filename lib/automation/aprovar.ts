import 'server-only'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'
import { MetaError, describeFailure, ehErroDePolitica } from '../instagram/errors'
import { enviarRespostaPrivada } from '../instagram/private-replies'
import { enviarRespostaPublica } from '../instagram/public-replies'
import { validarRespostaPublica } from '../ai/respostas'
import { revalidar } from '../campaigns/eligibility'

/**
 * Envio por aprovação explícita — o ÚNICO caminho de saída no modo
 * APPROVAL_REQUIRED.
 *
 * A idempotência não é um if: o claim é um UPDATE condicional
 * (status IN PENDING_APPROVAL/QUEUED → SENDING) e só quem MUDOU a linha envia.
 * Duas abas, duplo clique, lote repetido: o segundo não muda nada e recebe
 * "Já processado". A unique parcial no banco continua atrás disso tudo.
 *
 * O clique substitui o next_attempt_at (intervenção humana explícita) e fica
 * registrado em manual_approval_override. O kill switch continua SUPREMO:
 * aprovação com switch travado NÃO envia e a ação volta a aguardar.
 */

export interface ResultadoAprovacao {
  ok: boolean
  status:
    | 'ENVIADA'
    | 'JA_PROCESSADA'
    | 'BLOQUEADA_KILL_SWITCH'
    | 'INELEGIVEL'
    | 'VALIDACAO'
    | 'FALHA_META'
  detalhe?: string
}

export async function enviarAprovada(
  acaoId: string,
  aprovadoPor: string,
  textoEditado?: string,
): Promise<ResultadoAprovacao> {
  // Kill switch ANTES do claim: aprovar com o switch travado não deve nem
  // reservar a linha — ela continua pendente, visível, com o aviso.
  const { data: cfg } = await db()
    .from('automation_settings')
    .select('kill_switch')
    .eq('id', true)
    .single()
  if (cfg?.kill_switch) {
    return {
      ok: false,
      status: 'BLOQUEADA_KILL_SWITCH',
      detalhe: 'Resposta aprovada, mas envio bloqueado pelo kill switch.',
    }
  }

  // CLAIM ATÔMICO: só uma execução consegue mover para SENDING.
  const agora = new Date().toISOString()
  const { data: claimed } = await db()
    .from('comment_actions')
    .update({
      status: 'SENDING',
      approved_by: aprovadoPor,
      approved_at: agora,
      responded_by: aprovadoPor,
      manual_approval_override: true,
      locked_by: `aprovacao-${aprovadoPor}`,
      locked_until: new Date(Date.now() + 120_000).toISOString(),
      updated_at: agora,
    })
    .eq('id', acaoId)
    .in('status', ['PENDING_APPROVAL', 'QUEUED'])
    .select('id,comment_id,action_type,generated_text,final_text,media_id,reply_source')
    .maybeSingle()

  if (!claimed) return { ok: false, status: 'JA_PROCESSADA', detalhe: 'Já processado.' }

  const devolver = async (patch: Record<string, unknown>) => {
    await db()
      .from('comment_actions')
      .update({ ...patch, locked_by: null, locked_until: null, updated_at: new Date().toISOString() })
      .eq('id', claimed.id)
  }

  const texto = (textoEditado ?? claimed.final_text ?? claimed.generated_text ?? '').trim()
  if (!texto) {
    await devolver({ status: 'PENDING_APPROVAL', skip_reason: 'SEM_TEXTO' })
    return { ok: false, status: 'VALIDACAO', detalhe: 'Texto vazio.' }
  }
  if (textoEditado !== undefined && textoEditado.trim() !== (claimed.generated_text ?? '').trim()) {
    await db()
      .from('comment_actions')
      .update({ edited_by: aprovadoPor, final_text: texto })
      .eq('id', claimed.id)
  }

  // Validações + credenciais em PARALELO: revalidar, conta/token e o registro
  // do comentário não dependem entre si — antes eram ~6 roundtrips em série
  // (3,5s medidos do clique ao SENT; a Meta é ~1s disso, o resto era fila de
  // idas ao banco). A ORDEM de segurança não muda: nada é enviado antes de
  // todas as validações voltarem.
  const [veredito0, contaP, comentarioP] = await Promise.all([
    claimed.action_type === 'PRIVATE_REPLY'
      ? // Aprovação individual: você olhou ESTA pessoa — UNKNOWN pode.
        revalidar(claimed.comment_id, claimed.id, { permitirFollowDesconhecido: true })
      : Promise.resolve(null),
    getConnectedAccount(),
    db()
      .from('instagram_comments')
      .select('instagram_comment_id,instagram_user_id,deleted_at,is_from_account')
      .eq('id', claimed.comment_id)
      .maybeSingle(),
  ])

  if (claimed.action_type === 'PRIVATE_REPLY') {
    const veredito = veredito0!
    if (!veredito.pode) {
      await devolver({
        status: veredito.motivo === 'FORA_DA_JANELA' ? 'EXPIRED' : 'SKIPPED',
        skip_reason: [veredito.motivo, veredito.detalhe].filter(Boolean).join(' — '),
      })
      return { ok: false, status: 'INELEGIVEL', detalhe: veredito.motivo ?? 'inelegível' }
    }
  } else {
    const c = comentarioP.data
    if (!c || c.deleted_at || c.is_from_account) {
      await devolver({ status: 'SKIPPED', skip_reason: 'COMENTARIO_APAGADO' })
      return { ok: false, status: 'INELEGIVEL', detalhe: 'comentário não existe mais' }
    }
    const recusa = validarRespostaPublica(texto, [], {
      autorHumano: claimed.reply_source === 'HUMAN',
    })
    if (recusa) {
      await devolver({ status: 'PENDING_APPROVAL', skip_reason: `validação: ${recusa}` })
      return { ok: false, status: 'VALIDACAO', detalhe: recusa }
    }
  }

  const conta = contaP
  if (!conta?.facebookPageId) {
    await devolver({ status: 'PENDING_APPROVAL', skip_reason: 'SEM_CONTA' })
    return { ok: false, status: 'VALIDACAO', detalhe: 'Conta desconectada.' }
  }
  const token = await getPageToken(conta.id)
  const comentario = comentarioP.data

  try {
    let externalId: string
    let recipientId: string | null = null
    if (claimed.action_type === 'PUBLIC_REPLY') {
      const r = await enviarRespostaPublica({
        pageToken: token,
        commentId: comentario!.instagram_comment_id,
        texto,
      })
      externalId = r.id
    } else {
      const r = await enviarRespostaPrivada({
        pageId: conta.facebookPageId,
        pageToken: token,
        commentId: comentario!.instagram_comment_id,
        texto,
      })
      externalId = r.message_id
      recipientId = r.recipient_id
    }

    await devolver({
      status: 'SENT',
      sent_at: new Date().toISOString(),
      external_id: externalId,
      external_recipient_id: recipientId,
      final_text: texto,
      error_code: null,
      error_message: null,
      error_class: null,
    })

    if (claimed.action_type === 'PRIVATE_REPLY') {
      await db()
        .from('instagram_comments')
        .update({ eligibility_status: 'SENT' })
        .eq('id', claimed.comment_id)
      if (comentario?.instagram_user_id) {
        await db().rpc('recalcular_contadores_pessoas', { ids: [comentario.instagram_user_id] })
      }
    }
    return { ok: true, status: 'ENVIADA' }
  } catch (erro) {
    const meta = erro instanceof MetaError ? erro : null
    const permanente = meta?.errorClass === 'PERMANENT'

    // Erro de POLÍTICA (código 10): freio automático. Insistir em loop contra
    // policy da Meta arrisca a conta inteira — melhor parar tudo e você decidir.
    if (ehErroDePolitica(erro)) {
      await db()
        .from('automation_settings')
        .update({
          kill_switch: true,
          updated_at: new Date().toISOString(),
          updated_by: 'auto: erro de política da Meta (código 10)',
        })
        .eq('id', true)
      console.error('[aprovar] erro de política — kill switch acionado automaticamente')
    }
    // Permanente (comentário removido, sem permissão): FAILED, sem loop.
    // Temporário: volta para PENDING_APPROVAL — você tenta de novo, sem retry
    // automático escondido no modo de aprovação.
    await devolver({
      status: permanente ? 'FAILED' : 'PENDING_APPROVAL',
      error_code: meta ? String(meta.code ?? meta.httpStatus) : null,
      error_message: meta ? describeFailure(meta) : String(erro).slice(0, 300),
      error_class: meta?.errorClass === 'RATE_LIMIT' ? 'TEMPORARY' : (meta?.errorClass ?? 'TEMPORARY'),
    })
    return {
      ok: false,
      status: 'FALHA_META',
      detalhe: meta ? describeFailure(meta) : 'falha temporária, tente de novo',
    }
  }
}
