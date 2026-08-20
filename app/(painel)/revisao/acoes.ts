'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin, exigirSessao } from '@/lib/auth/guarda'
import { db } from '@/lib/db'
import { revalidar } from '@/lib/campaigns/eligibility'

/**
 * Aprovação e rejeição das sugestões da IA.
 *
 * Aprovar é a ÚNICA ponte de SHADOW para a fila: move a ação para QUEUED, e daí
 * o worker a trata como qualquer outra — kill switch, orçamento, revalidação no
 * instante do envio. Nenhum atalho.
 *
 * O texto gerado nunca é sobrescrito: `generated_text` guarda o que a IA
 * escreveu e `final_text` o que você aprovou. Sem isso não há como medir se as
 * edições humanas estão diminuindo com o tempo — que é o dado que autoriza a
 * automação da Etapa 6.
 */

export interface Resultado {
  ok: boolean
  erro?: string
  motivo?: string
}

export async function aprovar(acaoId: string, textoFinal: string): Promise<Resultado> {
  // Aprovar coloca mensagem real na fila de envio: qualquer papel logado pode
  // revisar, mas fica REGISTRADO quem foi — auditoria exige nome, não "operador".
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sessão expirada.' }
  }

  const texto = textoFinal.trim()
  if (texto.length < 3) return { ok: false, erro: 'Texto vazio.' }

  const { data: acao } = await db()
    .from('comment_actions')
    .select('id,comment_id,action_type,status,generated_text')
    .eq('id', acaoId)
    .maybeSingle()

  if (!acao) return { ok: false, erro: 'Ação não encontrada.' }
  if (acao.status !== 'SHADOW' && acao.status !== 'PENDING_APPROVAL') {
    return { ok: false, erro: `Ação já está em ${acao.status}.` }
  }

  // A elegibilidade é revalidada AQUI e será revalidada DE NOVO pelo worker.
  // Entre aprovar e enviar a janela de 7 dias pode fechar.
  if (acao.action_type === 'PRIVATE_REPLY') {
    // Decisão individual sua nesta pessoa — UNKNOWN pode.
    const veredito = await revalidar(acao.comment_id, acao.id, { permitirFollowDesconhecido: true })
    if (!veredito.pode) {
      await db()
        .from('comment_actions')
        .update({
          status: veredito.motivo === 'FORA_DA_JANELA' ? 'EXPIRED' : 'SKIPPED',
          skip_reason: [veredito.motivo, veredito.detalhe].filter(Boolean).join(' — '),
        })
        .eq('id', acao.id)
      revalidatePath('/revisao')
      return { ok: false, motivo: veredito.motivo ?? 'inelegível' }
    }
  }

  const { error } = await db()
    .from('comment_actions')
    .update({
      status: 'QUEUED',
      mode: 'MANUAL',
      final_text: texto,
      edited_by: texto === acao.generated_text ? null : sessao.usuario,
      approved_by: sessao.usuario,
      approved_at: new Date().toISOString(),
      // Editou = a resposta é humana; aprovou sem tocar = continua da IA.
      reply_source: texto === acao.generated_text ? 'AI' : 'HUMAN',
      responded_by: sessao.usuario,
      skip_reason: null,
      next_attempt_at: new Date().toISOString(),
    })
    .eq('id', acao.id)

  if (error) return { ok: false, erro: error.message }

  revalidatePath('/revisao')
  revalidatePath('/comentarios')
  return { ok: true }
}

export async function rejeitar(acaoId: string, motivo: string): Promise<Resultado> {
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sessão expirada.' }
  }

  const { error } = await db()
    .from('comment_actions')
    .update({
      status: 'REJECTED',
      rejected_by: sessao.usuario,
      rejected_reason: motivo.trim() || 'sem motivo informado',
    })
    .eq('id', acaoId)
    .in('status', ['SHADOW', 'PENDING_APPROVAL'])

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/revisao')
  return { ok: true }
}

/** Bloqueia a pessoa permanentemente e descarta o que estava pendente para ela. */
export async function bloquearPessoa(acaoId: string, motivo: string): Promise<Resultado> {
  const { data: acao } = await db()
    .from('comment_actions')
    .select('comment_id')
    .eq('id', acaoId)
    .maybeSingle()
  if (!acao) return { ok: false, erro: 'Ação não encontrada.' }

  const { data: c } = await db()
    .from('instagram_comments')
    .select('instagram_user_id')
    .eq('id', acao.comment_id)
    .maybeSingle()
  if (!c?.instagram_user_id) return { ok: false, erro: 'Comentário sem IGSID.' }

  await db()
    .from('instagram_users')
    .update({
      is_blacklisted: true,
      blacklist_reason: motivo.trim() || 'bloqueado na revisão',
      blacklisted_at: new Date().toISOString(),
      blacklisted_by: (await exigirSessao()).usuario,
    })
    .eq('instagram_user_id', c.instagram_user_id)

  // Nada pendente para essa pessoa deve sobreviver ao bloqueio.
  const { data: comentarios } = await db()
    .from('instagram_comments')
    .select('id')
    .eq('instagram_user_id', c.instagram_user_id)

  if (comentarios?.length) {
    await db()
      .from('comment_actions')
      .update({ status: 'SKIPPED', skip_reason: 'PESSOA_NA_BLACKLIST' })
      .in(
        'comment_id',
        comentarios.map((x) => x.id),
      )
      .in('status', ['SHADOW', 'PENDING_APPROVAL', 'QUEUED'])
  }

  revalidatePath('/revisao')
  revalidatePath('/comentarios')
  return { ok: true }
}

/**
 * Libera uma intenção para envio automático.
 *
 * never_auto_intents é verificado no servidor e vence esta lista: crítica,
 * situação delicada, oportunidade comercial e spam não podem ser liberadas nem
 * por engano.
 */
export async function alternarIntencaoAutomatica(
  intencao: string,
  ligar: boolean,
): Promise<Resultado> {
  // Liberar uma intenção decide o que sai sem passar por ninguém. É de ADMIN.
  try {
    await exigirAdmin('liberar automação por intenção')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const { data: cfg } = await db()
    .from('automation_settings')
    .select('auto_approve_intents,never_auto_intents')
    .eq('id', true)
    .single()

  const proibidas: string[] = cfg?.never_auto_intents ?? []
  if (ligar && proibidas.includes(intencao)) {
    return {
      ok: false,
      erro: `"${intencao}" está na lista de intenções que nunca podem ser automáticas.`,
    }
  }

  const atuais: string[] = cfg?.auto_approve_intents ?? []
  const novas = ligar
    ? [...new Set([...atuais, intencao])]
    : atuais.filter((i) => i !== intencao)

  const { error } = await db()
    .from('automation_settings')
    .update({ auto_approve_intents: novas, updated_at: new Date().toISOString() })
    .eq('id', true)

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/revisao')
  return { ok: true }
}

// ─────────────────────────────── fila "Precisa de você" (fallback humano 12.1)

import { enviarAprovada } from '@/lib/automation/aprovar'
import { lerConfigAutomacao } from '@/lib/automation/decidir'

export interface ResultadoHumano {
  ok: boolean
  detalhe: string
  dmDetalhe?: string
}

/**
 * Você responde um comentário que a IA segurou. O sistema publica SUA resposta
 * (reply_source HUMAN — as regras de estilo da automação não se aplicam ao seu
 * texto) e, se você marcou, envia também a DM de template.
 *
 * A DM aqui é AUTORIZAÇÃO HUMANA EXPLÍCITA: passa por cima do
 * FOLLOW_STATUS_UNKNOWN (decisão sua, registrada), mas NUNCA por cima da
 * constraint pessoa+conteúdo nem do kill switch.
 */
export async function responderHumano(
  analysisId: string,
  commentId: string,
  texto: string,
  enviarDm: boolean,
): Promise<ResultadoHumano> {
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { ok: false, detalhe: e instanceof Error ? e.message : 'Sessão expirada.' }
  }
  const t = texto.trim()
  if (t.length < 1) return { ok: false, detalhe: 'Escreva a resposta.' }

  const { data: c } = await db()
    .from('instagram_comments')
    .select('id,instagram_user_id,media_id')
    .eq('id', commentId)
    .maybeSingle()
  if (!c) return { ok: false, detalhe: 'Comentário não encontrado.' }

  // Cria a ação PÚBLICA humana e envia na hora pela rota de aprovação
  // (kill switch, claim atômico, revalidação — tudo igual).
  const { data: acao, error } = await db()
    .from('comment_actions')
    .insert({
      comment_id: c.id,
      analysis_id: analysisId,
      action_type: 'PUBLIC_REPLY',
      mode: 'MANUAL',
      status: 'PENDING_APPROVAL',
      generated_text: t,
      final_text: t,
      reply_source: 'HUMAN',
      responded_by: sessao.usuario,
      instagram_user_id: c.instagram_user_id,
      media_id: c.media_id,
    })
    .select('id')
    .maybeSingle()

  if (error?.code === '23505') return { ok: false, detalhe: 'Este comentário já tem resposta em andamento.' }
  if (error || !acao) return { ok: false, detalhe: error?.message ?? 'Falha ao criar ação.' }

  const envio = await enviarAprovada(acao.id, sessao.usuario, t)
  if (!envio.ok) {
    return { ok: false, detalhe: envio.detalhe ?? envio.status }
  }

  await db()
    .from('comment_analyses')
    .update({ review_outcome: 'HUMAN_REPLIED', reviewed_by: sessao.usuario, reviewed_at: new Date().toISOString() })
    .eq('id', analysisId)

  // APRENDIZADO NO ATO DA APROVAÇÃO (regra do Lucas, 19/08): a resposta que
  // ele publicou vira conhecimento DESTE conteúdo, chaveado pelo tema que
  // segurou a análise. A próxima pergunta igual já sai respondida — sem fila.
  // Auditável em respostas_aprendidas; a última aprovada vence.
  const { data: analiseInfo } = await db()
    .from('comment_analyses')
    .select('decision_reason_code,intent')
    .eq('id', analysisId)
    .maybeSingle()
  const topico = analiseInfo?.decision_reason_code || analiseInfo?.intent
  if (topico && c.media_id) {
    const { data: comentarioTxt } = await db()
      .from('instagram_comments')
      .select('text')
      .eq('id', c.id)
      .maybeSingle()
    await db()
      .from('respostas_aprendidas')
      .upsert(
        {
          media_id: c.media_id,
          topico,
          pergunta_exemplo: comentarioTxt?.text ?? null,
          resposta_aprovada: t,
          aprovado_por: sessao.usuario,
        },
        { onConflict: 'media_id,topico' },
      )
  }

  let dmDetalhe: string | undefined
  if (enviarDm) {
    const cfg = await lerConfigAutomacao()
    const template = (cfg?.dm_template ?? '').trim()
    if (!template) dmDetalhe = 'DM não enviada: template vazio.'
    else {
      const { data: dm, error: e2 } = await db()
        .from('comment_actions')
        .insert({
          comment_id: c.id,
          analysis_id: analysisId,
          action_type: 'PRIVATE_REPLY',
          mode: 'MANUAL',
          status: 'PENDING_APPROVAL',
          generated_text: template,
          final_text: template,
          reply_source: 'HUMAN',
          responded_by: sessao.usuario,
          instagram_user_id: c.instagram_user_id,
          media_id: c.media_id,
        })
        .select('id')
        .maybeSingle()
      if (e2?.code === '23505') dmDetalhe = 'DM não enviada: pessoa já tem DM deste conteúdo.'
      else if (e2 || !dm) dmDetalhe = `DM não criada: ${e2?.message ?? 'falha'}`
      else {
        const envioDm = await enviarAprovada(dm.id, sessao.usuario)
        dmDetalhe = envioDm.ok ? 'DM enviada.' : `DM: ${envioDm.detalhe ?? envioDm.status}`
      }
    }
  }

  revalidatePath('/revisao')
  revalidatePath('/aprovacoes')
  return { ok: true, detalhe: 'Resposta publicada.', dmDetalhe }
}

/** "Não responder": decisão consciente, registrada — não é pendência eterna. */
export async function naoResponder(analysisId: string): Promise<Resultado> {
  const sessao = await exigirSessao()
  const { error } = await db()
    .from('comment_analyses')
    .update({ review_outcome: 'IGNORED', reviewed_by: sessao.usuario, reviewed_at: new Date().toISOString() })
    .eq('id', analysisId)
    .is('review_outcome', null)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/revisao')
  return { ok: true }
}

const CAMPOS_FATO = ['address', 'price', 'opening_hours', 'notes'] as const
type CampoFato = (typeof CAMPOS_FATO)[number]

/**
 * "Salvar como informação do conteúdo" — SÓ com sua confirmação explícita.
 * Sua resposta nunca vira fato reutilizável sozinha.
 */
export async function salvarFatoNoConteudo(
  mediaId: string,
  campo: string,
  valor: string,
): Promise<Resultado> {
  const sessao = await exigirSessao()
  if (!CAMPOS_FATO.includes(campo as CampoFato)) return { ok: false, erro: 'Campo inválido.' }
  const v = valor.trim()
  if (!v) return { ok: false, erro: 'Valor vazio.' }

  const { data: existente } = await db()
    .from('contents')
    .select('id,notes')
    .eq('seed_media_id', mediaId)
    .maybeSingle()

  // notes acumula ("Estacionamento: valet na porta"); os demais substituem.
  const patch: Record<string, string> =
    campo === 'notes'
      ? { notes: existente?.notes ? `${existente.notes}\n${v}` : v }
      : { [campo]: v }

  const { error } = existente
    ? await db().from('contents').update(patch).eq('id', existente.id)
    : await db()
        .from('contents')
        .insert({ seed_media_id: mediaId, title: 'cadastrado na revisão', ...patch })
  if (error) return { ok: false, erro: error.message }

  console.log(`[fatos] ${sessao.usuario} salvou ${campo} no conteúdo ${mediaId.slice(0, 8)}…`)
  revalidatePath('/revisao')
  return { ok: true }
}
