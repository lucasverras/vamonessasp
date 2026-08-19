'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin } from '@/lib/auth/guarda'
import { criarCampanha, getAutomacao } from '@/lib/campaigns/create'
import { db } from '@/lib/db'

/**
 * [ENVIAR PARA N]: cria a campanha a partir da lista de QUALIFICADOS do
 * banco — a mesma RPC que a tela mostra. O N do botão e o N do envio são o
 * mesmo cálculo; e cada envio ainda é revalidado no worker.
 */
export async function enviarParaQualificados(): Promise<{
  ok: boolean
  enfileirados?: number
  recusados?: number
  erro?: string
}> {
  let sessao
  try {
    sessao = await exigirAdmin('enviar para qualificados')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const [{ data: qualificados, error }, cfg] = await Promise.all([
    db().rpc('oportunidades_dm'),
    getAutomacao(),
  ])
  if (error) return { ok: false, erro: error.message }

  const commentIds = ((qualificados ?? []) as Array<{ comment_id: string | null }>)
    .map((q) => q.comment_id)
    .filter((id): id is string => Boolean(id))
  if (commentIds.length === 0) return { ok: false, erro: 'Nenhum qualificado com comentário para responder.' }

  const template = (cfg?.dm_template ?? '').trim()
  if (template.length < 10) return { ok: false, erro: 'Template da DM não configurado.' }

  try {
    const r = await criarCampanha({
      nome: `Aquisição ${new Date().toLocaleDateString('pt-BR')}`,
      mensagem: template,
      commentIds,
      criadoPor: sessao.usuario,
    })
    revalidatePath('/aquisicao')
    revalidatePath('/comentarios')
    return { ok: true, enfileirados: r.enfileirados, recusados: r.recusados.length }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao criar campanha.' }
  }
}
