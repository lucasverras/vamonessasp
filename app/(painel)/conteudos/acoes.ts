'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin } from '@/lib/auth/guarda'
import { db } from '@/lib/db'

export interface ResultadoVinculo {
  ok: boolean
  erro?: string
}

/** Vincula uma publicação (FB/TikTok) a um content existente. ADMIN. */
export async function vincularConteudo(
  platformPostId: string,
  contentId: string,
): Promise<ResultadoVinculo> {
  let sessao
  try {
    sessao = await exigirAdmin('vincular conteúdos')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const { error } = await db()
    .from('platform_posts')
    .update({
      content_id: contentId,
      match_method: 'manual',
      match_confidence: null,
      matched_by: sessao.usuario,
    })
    .eq('id', platformPostId)

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/conteudos')
  return { ok: true }
}

/**
 * Desfaz um vínculo errado. A publicação NUNCA é apagada — volta a ser
 * "sem grupo" e reaparece na lista de pendentes.
 */
export async function desfazerVinculo(platformPostId: string): Promise<ResultadoVinculo> {
  let sessao
  try {
    sessao = await exigirAdmin('desfazer vínculo de conteúdo')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const { error } = await db()
    .from('platform_posts')
    .update({
      content_id: null,
      match_method: null,
      match_confidence: null,
      matched_by: sessao.usuario,
    })
    .eq('id', platformPostId)
    // Só faz sentido desfazer o que não é a origem do content (o post do IG
    // que o gerou no backfill fica).
    .neq('platform', 'instagram')

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/conteudos')
  return { ok: true }
}
