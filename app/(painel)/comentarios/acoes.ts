'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin } from '@/lib/auth/guarda'
import { criarCampanha, definirKillSwitch } from '@/lib/campaigns/create'

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
