import 'server-only'
import { randomUUID } from 'node:crypto'
import { db } from '../db'
import { getConnectedAccount, getPageToken } from '../instagram/account'
import { MetaError, describeFailure, ehErroDePolitica } from '../instagram/errors'
import { getLastUsage } from '../instagram/meta-client'
import { enviarRespostaPrivada } from '../instagram/private-replies'
import { enviarRespostaPublica } from '../instagram/public-replies'
import { validarRespostaPublica } from '../ai/respostas'
import { revalidar, type Veredito } from './eligibility'

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
  parouPor?: 'KILL_SWITCH' | 'ORCAMENTO' | 'RATE_LIMIT' | 'TOKEN' | 'SEM_TRABALHO' | 'ERRO_DE_POLITICA'
  orcamentoRestante?: number
}

export async function processarLote(tamanhoMax = 10): Promise<ResultadoLote> {
  const vazio: ResultadoLote = { processados: 0, enviados: 0, falhas: 0, ignorados: 0 }

  const { data: cfg } = await db()
    .from('automation_settings')
    .select('kill_switch,shadow_mode,reply_mode')
    .eq('id', true)
    .single()

  // 1. Kill switch: nenhuma MENSAGEM sai. Em DRY_RUN o pipeline continua
  //    processável com o switch travado, porque o branch DRY_RUN encerra antes
  //    de qualquer chamada à Meta — é o que permite auditar T0→T4 sem destravar
  //    nada. Em LIVE (ou em qualquer estado que pudesse enviar), para aqui.
  //    Defesa em profundidade: o branch de envio LIVE reconfere o switch.
  if (cfg?.kill_switch && cfg?.reply_mode !== 'DRY_RUN') {
    return { ...vazio, parouPor: 'KILL_SWITCH' }
  }

  // Em APPROVAL_REQUIRED (e OFF) o worker automático NÃO reivindica nada: o
  // único caminho de envio é a rota de aprovação explícita, que valida e envia
  // na hora do clique. QUEUED remanescente fica intacto para quando voltar LIVE.
  if (cfg?.reply_mode !== 'LIVE' && cfg?.reply_mode !== 'DRY_RUN') {
    return { ...vazio, parouPor: 'SEM_TRABALHO' }
  }

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
    action_type: 'PUBLIC_REPLY' | 'PRIVATE_REPLY'
    media_id: string | null
    final_text: string | null
    generated_text: string | null
    attempts: number
    campaign_id: string | null
  }>
  if (itens.length === 0) return { ...vazio, parouPor: 'SEM_TRABALHO', orcamentoRestante: orcamento }

  const token = await getPageToken(conta.id)
  const r: ResultadoLote = { ...vazio, processados: itens.length, orcamentoRestante: orcamento }

  for (const item of itens) {
    // 4. Revalidação no instante do envio, POR TIPO. A private reply carrega a
    //    janela de 7 dias e a regra pessoa+conteúdo; a resposta pública só
    //    exige que o comentário ainda exista e não seja nosso — regras
    //    diferentes, funil diferente.
    const veredito =
      item.action_type === 'PUBLIC_REPLY'
        ? await revalidarPublica(item.comment_id, token, conta.instagramUserId)
        : // Passa o próprio id: sem isso o worker se vê na fila e ignora tudo.
          // Item SEM campanha só chega QUEUED por aprovação individual humana
          // (ou pelo gate que já exige NOT_FOLLOWING); item DE campanha é
          // massa — nunca envia sem prova de que a pessoa não segue.
          await revalidar(item.comment_id, item.id, {
            permitirFollowDesconhecido: !item.campaign_id,
          })
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

    // DRY_RUN: percorreu classificação, decisão, fila, atraso e revalidação —
    // e para AQUI, na beira do envio. É o modo de validar o pipeline inteiro
    // sem tocar em pessoa real, e é o default de produção até você ligar LIVE.
    if (cfg?.reply_mode === 'DRY_RUN') {
      r.ignorados += 1
      await db()
        .from('comment_actions')
        .update({
          status: 'DRY_RUN',
          skip_reason: 'MODO_DRY_RUN: teria enviado agora',
          final_text: texto,
          locked_until: null,
          locked_by: null,
        })
        .eq('id', item.id)
      continue
    }

    // Defesa em profundidade: daqui para baixo é envio REAL. O gate lá em cima
    // já barrou LIVE+kill_switch, mas uma mudança de config entre o claim e
    // este ponto não pode escapar.
    if (cfg?.kill_switch) {
      r.ignorados += 1
      await db()
        .from('comment_actions')
        .update({ status: 'QUEUED', skip_reason: null, locked_until: null, locked_by: null })
        .eq('id', item.id)
      r.parouPor = 'KILL_SWITCH'
      break
    }

    const { data: comentario } = await db()
      .from('instagram_comments')
      .select('instagram_comment_id,instagram_user_id')
      .eq('id', item.comment_id)
      .single()

    try {
      // 5. Envio, por tipo.
      if (item.action_type === 'PUBLIC_REPLY') {
        // Última validação estrutural antes de publicar: comprimento, menção a
        // IA, tom de SAC, repetição literal no mesmo conteúdo.
        const recentes = item.media_id ? await respostasRecentesNoMedia(item.media_id) : []
        const recusa = validarRespostaPublica(texto, recentes)
        if (recusa) {
          r.ignorados += 1
          await db()
            .from('comment_actions')
            .update({
              status: 'PENDING_APPROVAL',
              skip_reason: `validação final recusou: ${recusa}`,
              locked_until: null,
              locked_by: null,
            })
            .eq('id', item.id)
          continue
        }

        const resposta = await enviarRespostaPublica({
          pageToken: token,
          commentId: comentario!.instagram_comment_id,
          texto,
        })

        r.enviados += 1
        await db()
          .from('comment_actions')
          .update({
            status: 'SENT',
            sent_at: new Date().toISOString(),
            external_id: resposta.id,
            final_text: texto,
            error_code: null,
            error_message: null,
            error_class: null,
            locked_until: null,
            locked_by: null,
          })
          .eq('id', item.id)
        continue
      }

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

      // Erro de POLÍTICA da Meta: freio automático — trava o kill switch e
      // encerra o lote. Insistir contra policy arrisca a conta inteira.
      if (ehErroDePolitica(erro)) {
        await db()
          .from('automation_settings')
          .update({
            kill_switch: true,
            updated_at: new Date().toISOString(),
            updated_by: 'auto: erro de política da Meta (código 10)',
          })
          .eq('id', true)
        console.error('[worker] erro de política — kill switch acionado automaticamente')
        r.parouPor = 'ERRO_DE_POLITICA'
      }
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

/**
 * Revalidação da resposta PÚBLICA: regras próprias, não as da DM.
 * Só exige que o comentário exista, não tenha sido apagado e não seja nosso.
 * A dedupe (uma pública por comentário) é a unique parcial — esta linha,
 * já em SENDING, é por construção a única em voo para o comentário.
 */
async function revalidarPublica(commentId: string, token?: string, igUserId?: string): Promise<Veredito> {
  const { data: c } = await db()
    .from('instagram_comments')
    .select('id,is_from_account,deleted_at,instagram_comment_id,parent_comment_id')
    .eq('id', commentId)
    .maybeSingle()
  if (!c) return { pode: false, motivo: 'COMENTARIO_APAGADO', detalhe: 'não está no banco' }
  if (c.deleted_at) return { pode: false, motivo: 'COMENTARIO_APAGADO' }
  if (c.is_from_account) return { pode: false, motivo: 'COMENTARIO_PROPRIO' }
  // REGRA DO LUCAS (20/08): só o comentário principal; thread não recebe resposta.
  if (c.parent_comment_id) return { pode: false, motivo: 'RESPOSTA_EM_THREAD', detalhe: 'só o comentário principal recebe resposta' }
  // REGRA DO LUCAS (20/08): se o @vamonessasp já respondeu, descarta. Banco
  // primeiro (replies nossas chegam pelo webhook); API para comentário de topo.
  const { count } = await db()
    .from('instagram_comments')
    .select('id', { count: 'exact', head: true })
    .eq('parent_comment_id', c.instagram_comment_id)
    .eq('is_from_account', true)
  if ((count ?? 0) > 0) return { pode: false, motivo: 'JA_RESPONDIDO', detalhe: 'já respondido pelo perfil' }
  if (token && igUserId && !c.parent_comment_id) {
    try {
      const { metaGet } = await import('../instagram/meta-client')
      const r = (await metaGet<{ data?: Array<{ from?: { id?: string } }> }>(`${c.instagram_comment_id}/replies`, token, { fields: 'id,from', limit: 50 })) as { data?: Array<{ from?: { id?: string } }> }
      if ((r.data ?? []).some((x) => x.from?.id === igUserId)) return { pode: false, motivo: 'JA_RESPONDIDO', detalhe: 'já respondido pelo perfil (API)' }
    } catch { /* API indisponível: confia no banco */ }
  }
  return { pode: true, motivo: null }
}

/** Últimas respostas públicas enviadas no conteúdo, para a validação final. */
async function respostasRecentesNoMedia(mediaId: string): Promise<string[]> {
  const { data } = await db()
    .from('comment_actions')
    .select('final_text,generated_text')
    .eq('media_id', mediaId)
    .eq('action_type', 'PUBLIC_REPLY')
    .eq('status', 'SENT')
    .order('sent_at', { ascending: false })
    .limit(5)
  return (data ?? []).map((d) => (d.final_text ?? d.generated_text ?? '').trim()).filter(Boolean)
}

export async function destravarPresos(): Promise<number> {
  const { data } = await db().rpc('destravar_envios')
  return Number(data ?? 0)
}
