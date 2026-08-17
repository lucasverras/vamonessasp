'use server'

import { revalidatePath } from 'next/cache'
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
    const veredito = await revalidar(acao.comment_id, acao.id)
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
      edited_by: texto === acao.generated_text ? null : 'operador',
      approved_by: 'operador',
      approved_at: new Date().toISOString(),
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
  const { error } = await db()
    .from('comment_actions')
    .update({
      status: 'REJECTED',
      rejected_by: 'operador',
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
      blacklisted_by: 'operador',
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
