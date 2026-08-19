'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin } from '@/lib/auth/guarda'
import { db } from '@/lib/db'
import { criarCampanha, definirKillSwitch, previaCampanha } from '@/lib/campaigns/create'

/**
 * Server actions da tela de comentários.
 *
 * A seleção que chega do navegador é uma INTENÇÃO. A autoridade é o servidor:
 * criarCampanha revalida cada comentário, e o worker revalida outra vez no
 * instante do envio.
 */

export interface RespostaEnvio {
  ok: boolean
  campanhaId?: string
  enfileirados?: number
  recusados?: number
  dedupePorPessoa?: number
  erro?: string
}

export async function enviarSelecao(formData: FormData): Promise<RespostaEnvio> {
  // Enfileirar mensagem real para pessoas reais é a ação mais consequente do
  // sistema. Conferida aqui, não na tela.
  try {
    await exigirAdmin('enfileirar mensagens')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const mensagem = String(formData.get('mensagem') ?? '')
  const nome = String(formData.get('nome') ?? '').trim() || 'Campanha sem nome'
  const ids = String(formData.get('ids') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  try {
    const r = await criarCampanha({ nome, mensagem, commentIds: ids })
    revalidatePath('/comentarios')
    revalidatePath('/campanhas')
    return {
      ok: true,
      campanhaId: r.campanhaId,
      enfileirados: r.enfileirados,
      recusados: r.recusados.length,
      dedupePorPessoa: r.dedupePorPessoa,
    }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha inesperada.' }
  }
}

export async function alternarKillSwitch(ligado: boolean) {
  await exigirAdmin('mexer no kill switch')
  await definirKillSwitch(ligado)
  revalidatePath('/comentarios')
  revalidatePath('/configuracoes/instagram')
}

/**
 * Prévia da seleção: quantas pessoas REALMENTE receberão, calculado pelo
 * servidor com as mesmas regras do envio (dedupe global, 60 dias, follow,
 * blacklist, janela). O modal mostra este número, não o da seleção da tela.
 */
export async function previaSelecao(idsCsv: string): Promise<{
  elegiveis: number
  removidos: Array<[string, number]>
}> {
  await exigirAdmin('pré-validar campanha')
  const ids = idsCsv.split(',').map((s) => s.trim()).filter(Boolean)
  const r = await previaCampanha(ids)
  return {
    elegiveis: r.elegiveis,
    removidos: Object.entries(r.removidosPorMotivo).sort((a, b) => b[1] - a[1]),
  }
}

/** Limpa da lista quem repete: mantém o comentário mais recente de cada
 *  pessoa, marca o resto SKIPPED_DUPLICATE. Nada é apagado. ADMIN. */
export async function limparDuplicadosAction(): Promise<{ ok: boolean; n?: number; erro?: string }> {
  try {
    await exigirAdmin('limpar duplicados')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const { data, error } = await db().rpc('limpar_duplicados')
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/comentarios')
  return { ok: true, n: Number(data ?? 0) }
}

/** Limpa da lista quem já foi atendido: DM dentro da janela ou já segue. ADMIN. */
export async function limparJaAtendidosAction(): Promise<{
  ok: boolean
  dmRecente?: number
  jaSegue?: number
  erro?: string
}> {
  try {
    await exigirAdmin('limpar já atendidos')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const { data, error } = await db().rpc('limpar_ja_atendidos')
  if (error) return { ok: false, erro: error.message }
  const r = (Array.isArray(data) ? data[0] : data) as { dm_recente: number; ja_segue: number } | null
  revalidatePath('/comentarios')
  return { ok: true, dmRecente: Number(r?.dm_recente ?? 0), jaSegue: Number(r?.ja_segue ?? 0) }
}
