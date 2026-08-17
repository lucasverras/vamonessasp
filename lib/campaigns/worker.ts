import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'
import { MetaError, describeFailure } from '../instagram/errors'
import { getLastUsage } from '../instagram/meta-client'
import { enviarRespostaPrivada } from '../instagram/private-replies'
import { revalidar } from './eligibility'

/**
 * Worker de envio.
 *
 * Ordem das verificações é deliberada, da mais barata e mais destrutiva para a
 * mais cara:
 *
 *   1. kill switch          — desliga tudo, sem consultar nada
 *   2. orçamento da hora    — respeita o teto antes de reservar trabalho
 *   3. claim atômico        — FOR UPDATE SKIP LOCKED
 *   4. revalidação por item — backend é autoridade, nunca a tela
 *   5. envio                — só aqui falamos com a Meta
 *   6. classificação        — permanente desiste, temporário recua e volta
 *
 * Nada aqui tenta contornar limite. Ao receber rate limit, para o lote: a
 * própria Meta documenta que insistir estende o bloqueio.
 */

const BACKOFF_MINUTOS = [1, 2, 4, 8, 16, 32]
const MAX_TENTATIVAS = BACKOFF_MINUTOS.length

export interface ResultadoLote {
  processados: number
  enviados: number
  falhas: number
  ignorados: number
  parouPor?: 'KILL_SWITCH' | 'ORCAMENTO' | 'RATE_LIMIT' | 'TOKEN' | 'SEM_TRABALHO'
  orcamentoRestante?: number
}

export async function processarLote(tamanhoMax = 10): Promise<ResultadoLote> {
  const vazio: ResultadoLote = { processados: 0, enviados: 0, falhas: 0, ignorados: 0 }

  const { data: cfg } = await db()
    .from('automation_settings')
    .select('kill_switch,shadow_mode')
    .eq('id', true)
    .single()

  // 1. Kill switch: nada sai, nem é reservado.
  if (cfg?.kill_switch) return { ...vazio, parouPor: 'KILL_SWITCH' }

  // 2. Orçamento da hora.
  const { data: orcamentoRaw } = await db().rpc('orcamento_envio_restante')
  const orcamento = Number(orcamentoRaw ?? 0)
  if (orcamento <= 0) return { ...vazio, parouPor: 'ORCAMENTO', orcamentoRestante: 0 }

  const conta = await getConnectedAccount()
  if (!conta?.facebookPageId) return { ...vazio, parouPor: 'TOKEN' }

  // 3. Claim.
  const worker = `w-${randomUUID().slice(0, 8)}`
  const lote = Math.min(tamanhoMax, orcamento)
  const { data: reservados, error } = await db().rpc('reservar_envios', {
    lote,
    worker,
    lock_segundos: 120,
  })
  if (error) throw new Error(`Falha ao reservar envios: ${error.message}`)

  const itens = (reservados ?? []) as Array<{
    id: string
    comment_id: string
    final_text: string | null
    generated_text: string | null
    attempts: number
    campaign_id: string | null
  }>
  if (itens.length === 0) return { ...vazio, parouPor: 'SEM_TRABALHO', orcamentoRestante: orcamento }

  const token = await getPageToken(conta.id)
  const r: ResultadoLote = { ...vazio, processados: itens.length, orcamentoRestante: orcamento }

  for (const item of itens) {
    // 4. Revalidação no instante do envio. Entre a seleção e agora, o
    //    comentário pode ter expirado, sido apagado, já ter recebido resposta,
    //    ou a pessoa pode ter entrado na blacklist.
    // Passa o próprio id: sem isso o worker se vê na fila e ignora tudo.
    const veredito = await revalidar(item.comment_id, item.id)
    if (!veredito.pode) {
      r.ignorados += 1
      await db()
        .from('comment_actions')
        .update({
          status: veredito.motivo === 'FORA_DA_JANELA' ? 'EXPIRED' : 'SKIPPED',
          skip_reason: [veredito.motivo, veredito.detalhe].filter(Boolean).join(' — '),
          locked_until: null,
          locked_by: null,
        })
        .eq('id', item.id)
      continue
    }

    const texto = (item.final_text ?? item.generated_text ?? '').trim()
    if (!texto) {
      r.ignorados += 1
      await db()
        .from('comment_actions')
        .update({ status: 'SKIPPED', skip_reason: 'SEM_TEXTO', locked_until: null })
        .eq('id', item.id)
      continue
    }

    // Shadow mode: gera e registra, nunca envia. É o modo de partida do sistema.
    if (cfg?.shadow_mode) {
      r.ignorados += 1
      await db()
        .from('comment_actions')
        .update({ status: 'SHADOW', skip_reason: 'SHADOW_MODE', locked_until: null })
        .eq('id', item.id)
      continue
    }

    const { data: comentario } = await db()
      .from('instagram_comments')
      .select('instagram_comment_id,instagram_user_id')
      .eq('id', item.comment_id)
      .single()

    try {
      // 5. Envio.
      const resposta = await enviarRespostaPrivada({
        pageId: conta.facebookPageId,
        pageToken: token,
        commentId: comentario!.instagram_comment_id,
        texto,
      })

      r.enviados += 1
      const agora = new Date().toISOString()

      await db()
        .from('comment_actions')
        .update({
          status: 'SENT',
          sent_at: agora,
          external_id: resposta.message_id,
          external_recipient_id: resposta.recipient_id,
          final_text: texto,
          error_code: null,
          error_message: null,
          error_class: null,
          locked_until: null,
          locked_by: null,
        })
        .eq('id', item.id)

      // eligibility_status é o único campo desnormalizado no comentário — o
      // detalhe do envio (message_id, sent_at) vive em comment_actions, para não
      // haver duas verdades que possam divergir.
      const { error: erroComentario } = await db()
        .from('instagram_comments')
        .update({ eligibility_status: 'SENT' })
        .eq('id', item.comment_id)

      // NUNCA em silêncio: a mensagem JÁ SAIU. Se o estado não acompanhar, a
      // tela mostra a pessoa como disponível e alguém tenta de novo. Foi
      // exatamente isso que aconteceu no primeiro envio real, porque este
      // update escrevia colunas que não existiam e o erro era descartado.
      if (erroComentario) {
        console.error('[worker] ENVIADO mas falhou ao atualizar o comentário', {
          actionId: item.id,
          commentId: item.comment_id,
          erro: erroComentario.message,
        })
      }

      if (comentario?.instagram_user_id) {
        await db().rpc('recalcular_contadores_pessoas', {
          ids: [comentario.instagram_user_id],
        })
      }
    } catch (erro) {
      // 6. Classificação decide desistir ou tentar de novo.
      const meta = erro instanceof MetaError ? erro : null
      const classe = meta?.errorClass ?? 'TEMPORARY'
      const permanente = classe === 'PERMANENT'
      const proxima = BACKOFF_MINUTOS[Math.min(item.attempts - 1, MAX_TENTATIVAS - 1)] ?? 32
      const esgotou = item.attempts >= MAX_TENTATIVAS

      r.falhas += 1

      await db()
        .from('comment_actions')
        .update({
          status: permanente || esgotou ? 'FAILED' : 'QUEUED',
          error_code: meta ? String(meta.code ?? meta.httpStatus) : null,
          error_message: meta ? describeFailure(meta) : String(erro).slice(0, 400),
          error_class: classe === 'RATE_LIMIT' ? 'TEMPORARY' : classe,
          // Jitter evita que todo o lote volte no mesmo instante.
          next_attempt_at: new Date(
            Date.now() + proxima * 60_000 + Math.floor(Math.random() * 20_000),
          ).toISOString(),
          locked_until: null,
          locked_by: null,
        })
        .eq('id', item.id)

      if (permanente) {
        await db()
          .from('instagram_comments')
          .update({
            eligibility_status: 'FAILED',
            not_eligible_reason: meta ? describeFailure(meta) : 'erro permanente',
          })
          .eq('id', item.comment_id)
      }

      // Rate limit ou token: interrompe o lote. Insistir estende o bloqueio.
      if (classe === 'RATE_LIMIT') {
        r.parouPor = 'RATE_LIMIT'
        break
      }
      if (classe === 'TOKEN') {
        r.parouPor = 'TOKEN'
        await db()
          .from('dm_campaigns')
          .update({ status: 'PAUSED' })
          .in('status', ['RUNNING', 'QUEUED'])
        break
      }
    }

    // Desacelera preventivamente se a Meta sinalizar consumo alto.
    const uso = getLastUsage()
    if (uso?.callCount && uso.callCount > 85) {
      r.parouPor = 'RATE_LIMIT'
      break
    }
  }

  await atualizarContadoresDeCampanhas()
  return r
}

async function atualizarContadoresDeCampanhas() {
  await db().rpc('atualizar_contadores_campanhas')
}

export async function destravarPresos(): Promise<number> {
  const { data } = await db().rpc('destravar_envios')
  return Number(data ?? 0)
}
