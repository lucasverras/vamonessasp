'use server'

import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/lib/auth/guarda'
import { enviarAprovada, type ResultadoAprovacao } from '@/lib/automation/aprovar'
import { db } from '@/lib/db'

/**
 * Ações da fila de aprovação. Todas exigem sessão e registram QUEM decidiu.
 * Aprovar/enviar é o trabalho do painel — ADMIN e OPERADOR podem; o que é
 * só-ADMIN continua sendo configuração, kill switch e campanhas.
 */

export async function aprovarEEnviar(acaoId: string): Promise<ResultadoAprovacao> {
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { ok: false, status: 'VALIDACAO', detalhe: e instanceof Error ? e.message : 'Sessão.' }
  }
  const r = await enviarAprovada(acaoId, sessao.usuario)
  revalidatePath('/aprovacoes')
  return r
}

export async function editarEEnviar(acaoId: string, texto: string): Promise<ResultadoAprovacao> {
  let sessao
  try {
    sessao = await exigirSessao()
  } catch (e) {
    return { ok: false, status: 'VALIDACAO', detalhe: e instanceof Error ? e.message : 'Sessão.' }
  }
  if (texto.trim().length < 2) return { ok: false, status: 'VALIDACAO', detalhe: 'Texto vazio.' }
  const r = await enviarAprovada(acaoId, sessao.usuario, texto)
  revalidatePath('/aprovacoes')
  return r
}

/** Salva a edição SEM enviar — continua na fila com a versão nova. */
export async function salvarEdicao(acaoId: string, texto: string) {
  const sessao = await exigirSessao()
  if (texto.trim().length < 2) return { ok: false as const, erro: 'Texto vazio.' }
  const { data } = await db()
    .from('comment_actions')
    .update({ final_text: texto.trim(), edited_by: sessao.usuario })
    .eq('id', acaoId)
    .eq('status', 'PENDING_APPROVAL')
    .select('id')
    .maybeSingle()
  revalidatePath('/aprovacoes')
  return data ? { ok: true as const } : { ok: false as const, erro: 'Já processado.' }
}

export async function descartar(acaoId: string, motivo?: string) {
  const sessao = await exigirSessao()
  const { data } = await db()
    .from('comment_actions')
    .update({
      status: 'REJECTED',
      rejected_by: sessao.usuario,
      rejected_reason: motivo?.trim() || 'descartado na aprovação',
    })
    .eq('id', acaoId)
    .in('status', ['PENDING_APPROVAL', 'QUEUED'])
    .select('id')
    .maybeSingle()
  revalidatePath('/aprovacoes')
  return data ? { ok: true as const } : { ok: false as const, erro: 'Já processado.' }
}

export interface ResultadoLoteAprovacao {
  enviadas: number
  jaProcessadas: number
  falhas: Array<{ acaoId: string; detalhe: string }>
}

/**
 * Lote: cada item processado INDIVIDUALMENTE, sem rollback dos que passaram.
 * "8 enviadas, 1 já processada, 1 falhou" é um resultado normal.
 */
export async function aprovarLote(acaoIds: string[]): Promise<ResultadoLoteAprovacao> {
  const sessao = await exigirSessao()
  const ids = [...new Set(acaoIds)].slice(0, 50)
  const resultado: ResultadoLoteAprovacao = { enviadas: 0, jaProcessadas: 0, falhas: [] }

  for (const id of ids) {
    const r = await enviarAprovada(id, sessao.usuario)
    if (r.ok) resultado.enviadas += 1
    else if (r.status === 'JA_PROCESSADA') resultado.jaProcessadas += 1
    else resultado.falhas.push({ acaoId: id, detalhe: r.detalhe ?? r.status })
  }

  revalidatePath('/aprovacoes')
  return resultado
}

/**
 * "Esse aí me segue" — você reconhece o username e marca. A pessoa vira
 * FOLLOWS (fonte: manual), a DM pendente é pulada, e NENHUMA DM futura será
 * sugerida ou enviada para ela (revalidar bloqueia FOLLOWS em todo caminho).
 */
export async function marcarComoSeguidor(acaoId: string) {
  const sessao = await exigirSessao()
  const { data: acao } = await db()
    .from('comment_actions')
    .select('id,instagram_user_id')
    .eq('id', acaoId)
    .maybeSingle()
  if (!acao?.instagram_user_id) return { ok: false as const, erro: 'Ação sem identificador.' }

  await db()
    .from('instagram_users')
    .update({
      follow_status: 'FOLLOWS',
      follow_status_checked_at: new Date().toISOString(),
      follow_status_source: `manual:${sessao.usuario}`,
    })
    .eq('instagram_user_id', acao.instagram_user_id)

  // Toda DM pendente dessa pessoa é pulada, não só esta.
  await db()
    .from('comment_actions')
    .update({ status: 'SKIPPED', skip_reason: 'SKIPPED_ALREADY_FOLLOWING' })
    .eq('instagram_user_id', acao.instagram_user_id)
    .eq('action_type', 'PRIVATE_REPLY')
    .in('status', ['PENDING_APPROVAL', 'QUEUED'])

  revalidatePath('/aprovacoes')
  revalidatePath('/comentarios')
  return { ok: true as const }
}
