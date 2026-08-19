import 'server-only'
import { db } from '../db'

/**
 * Importa a lista de seguidores da EXPORTAÇÃO OFICIAL do Instagram
 * ("Baixar suas informações" → Seguidores e seguindo → followers_1.json).
 *
 * É o caminho legítimo para o dado que a API esconde atrás do Advanced Access:
 * o dono da conta baixa os próprios dados — sem scraping, sem automação de
 * navegador, dentro dos Termos. O cruzamento é por USERNAME (a exportação não
 * traz IGSID), então:
 *
 *   está na lista  → FOLLOWS      (fonte export:<data> — nunca recebe DM)
 *   não está       → NOT_FOLLOWING (DM automática liberada)
 *
 * Limite honesto: é uma FOTO. Quem seguiu depois da exportação aparece como
 * não-seguidor até a próxima importação — recomenda-se re-exportar semanal.
 * Username trocado desde a exportação escapa do cruzamento (raro em 7 dias).
 */

export interface ResultadoImportacao {
  seguidoresNoArquivo: number
  marcadosComoSeguidores: number
  marcadosComoNaoSeguidores: number
  dmsPuladasDeSeguidores: number
}

/** Aceita o followers_1.json cru, o wrapper {relationships_followers}, ou texto plano (um @ por linha). */
export function extrairUsernames(conteudo: string): string[] {
  const nomes = new Set<string>()
  const texto = conteudo.trim()
  try {
    const j = JSON.parse(texto) as unknown
    const lista = Array.isArray(j)
      ? j
      : ((j as Record<string, unknown>).relationships_followers as unknown[] | undefined) ?? []
    for (const item of lista) {
      const dados = (item as { string_list_data?: Array<{ value?: string }> }).string_list_data
      for (const d of dados ?? []) {
        if (d.value) nomes.add(d.value.trim().toLowerCase().replace(/^@/, ''))
      }
    }
  } catch {
    // não é JSON: trata como lista de texto, um username por linha
    for (const linha of texto.split(/\r?\n/)) {
      const u = linha.trim().toLowerCase().replace(/^@/, '')
      if (u && /^[a-z0-9._]{1,30}$/.test(u)) nomes.add(u)
    }
  }
  return [...nomes]
}

export async function importarSeguidores(
  conteudo: string,
  importadoPor: string,
): Promise<ResultadoImportacao> {
  const seguidores = extrairUsernames(conteudo)
  if (seguidores.length === 0) {
    throw new Error(
      'Nenhum username encontrado no arquivo. Envie o followers_1.json da exportação, ou uma lista com um @ por linha.',
    )
  }

  const fonte = `export:${new Date().toISOString().slice(0, 10)}:${importadoPor}`
  const agora = new Date().toISOString()
  const setSeguidores = new Set(seguidores)

  // Todos os usuários que o painel conhece (quem já comentou/mencionou).
  const { data: conhecidos } = await db()
    .from('instagram_users')
    .select('instagram_user_id,username,follow_status,follow_status_source')

  const viraSeguidor: string[] = []
  const viraNaoSeguidor: string[] = []
  for (const u of conhecidos ?? []) {
    const nome = (u.username ?? '').toLowerCase()
    if (!nome) continue
    if (setSeguidores.has(nome)) viraSeguidor.push(u.instagram_user_id)
    // Marcação manual do Lucas não é rebaixada pela foto da exportação.
    else if (!String(u.follow_status_source ?? '').startsWith('manual')) {
      viraNaoSeguidor.push(u.instagram_user_id)
    }
  }

  const LOTE = 500
  for (let i = 0; i < viraSeguidor.length; i += LOTE) {
    await db()
      .from('instagram_users')
      .update({ follow_status: 'FOLLOWS', follow_status_checked_at: agora, follow_status_source: fonte })
      .in('instagram_user_id', viraSeguidor.slice(i, i + LOTE))
  }
  for (let i = 0; i < viraNaoSeguidor.length; i += LOTE) {
    await db()
      .from('instagram_users')
      .update({ follow_status: 'NOT_FOLLOWING', follow_status_checked_at: agora, follow_status_source: fonte })
      .in('instagram_user_id', viraNaoSeguidor.slice(i, i + LOTE))
  }

  // DMs pendentes de quem AGORA sabemos que segue: puladas na hora.
  let puladas = 0
  for (let i = 0; i < viraSeguidor.length; i += LOTE) {
    const { data } = await db()
      .from('comment_actions')
      .update({ status: 'SKIPPED', skip_reason: 'SKIPPED_ALREADY_FOLLOWING', updated_at: agora })
      .in('instagram_user_id', viraSeguidor.slice(i, i + LOTE))
      .eq('action_type', 'PRIVATE_REPLY')
      .in('status', ['PENDING_APPROVAL', 'QUEUED'])
      .select('id')
    puladas += data?.length ?? 0
  }

  return {
    seguidoresNoArquivo: seguidores.length,
    marcadosComoSeguidores: viraSeguidor.length,
    marcadosComoNaoSeguidores: viraNaoSeguidor.length,
    dmsPuladasDeSeguidores: puladas,
  }
}
