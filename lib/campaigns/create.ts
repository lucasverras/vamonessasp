import 'server-only'
import { db } from '../db'
import { revalidar } from './eligibility'

/**
 * Criação de campanha a partir de uma seleção da tela.
 *
 * A seleção é uma INTENÇÃO, não uma autorização. Cada comentário é revalidado
 * aqui e será revalidado DE NOVO pelo worker no instante do envio — o intervalo
 * entre criar e processar é justamente onde a janela de 7 dias fecha.
 *
 * A mensagem é congelada em message_snapshot: editar o template depois nunca
 * altera o que foi enviado.
 */

export interface ResultadoCriacao {
  campanhaId: string
  enfileirados: number
  recusados: Array<{ commentId: string; motivo: string }>
  dedupePorPessoa: number
}

export async function criarCampanha(args: {
  nome: string
  mensagem: string
  commentIds: string[]
  criadoPor?: string
}): Promise<ResultadoCriacao> {
  const mensagem = args.mensagem.trim()
  if (mensagem.length < 10) throw new Error('A mensagem está curta demais.')
  if (args.commentIds.length === 0) throw new Error('Nenhum comentário selecionado.')

  const recusados: ResultadoCriacao['recusados'] = []
  const aprovados: string[] = []

  // Uma pessoa recebe UMA mensagem, mesmo tendo comentado várias vezes. Sem
  // isto, quem comentou três vezes receberia três DMs — o oposto do objetivo.
  const { data: comentarios } = await db()
    .from('instagram_comments')
    .select('id,instagram_user_id,media_id')
    .in('id', args.commentIds)

  // Dedupe GLOBAL por pessoa (regra de 18/08): João com 5 comentários e 1
  // menção aparece UMA vez — a janela de 60 dias em revalidar garante o resto.
  const vistos = new Set<string>()
  const porComentario = new Map<string, { uid: string | null; mid: string | null }>()
  let dedupePorPessoa = 0

  for (const c of comentarios ?? []) {
    porComentario.set(c.id, { uid: c.instagram_user_id, mid: c.media_id })
    if (c.instagram_user_id) {
      if (vistos.has(c.instagram_user_id)) {
        dedupePorPessoa += 1
        recusados.push({ commentId: c.id, motivo: 'SKIPPED_DUPLICATE' })
        continue
      }
      vistos.add(c.instagram_user_id)
    }

    const veredito = await revalidar(c.id)
    if (veredito.pode) aprovados.push(c.id)
    else
      recusados.push({
        commentId: c.id,
        motivo: [veredito.motivo, veredito.detalhe].filter(Boolean).join(' — '),
      })
  }

  const { data: campanha, error } = await db()
    .from('dm_campaigns')
    .insert({
      name: args.nome,
      message_snapshot: mensagem,
      status: aprovados.length > 0 ? 'QUEUED' : 'COMPLETED',
      total_recipients: aprovados.length,
      skipped_count: recusados.length,
      started_at: aprovados.length > 0 ? new Date().toISOString() : null,
      created_by: args.criadoPor ?? null,
    })
    .select('id')
    .single()

  if (error) throw new Error(`Falha ao criar campanha: ${error.message}`)

  // No modo APPROVAL_REQUIRED, QUEUED ficaria parado para sempre (o worker
  // não reivindica nada fora de LIVE). A campanha nasce como PENDING_APPROVAL
  // e você aprova em lote na tela de Aprovações — sem fila fantasma.
  const { data: cfgModo } = await db()
    .from('automation_settings')
    .select('reply_mode')
    .eq('id', true)
    .single()
  const statusInicial = cfgModo?.reply_mode === 'LIVE' ? 'QUEUED' : 'PENDING_APPROVAL'

  if (aprovados.length > 0) {
    const { error: erroDest } = await db()
      .from('comment_actions')
      .insert(
        aprovados.map((commentId) => ({
          comment_id: commentId,
          campaign_id: campanha.id,
          action_type: 'PRIVATE_REPLY' as const,
          mode: 'MANUAL' as const,
          status: statusInicial,
          generated_text: mensagem,
          final_text: mensagem,
          // As colunas da constraint pessoa+conteúdo. Sem elas a unique não
          // enxerga a linha (NULL não colide) — achado da auditoria.
          instagram_user_id: porComentario.get(commentId)?.uid ?? null,
          media_id: porComentario.get(commentId)?.mid ?? null,
        })),
      )
    if (erroDest) throw new Error(`Falha ao enfileirar: ${erroDest.message}`)
  }

  return {
    campanhaId: campanha.id,
    enfileirados: aprovados.length,
    recusados,
    dedupePorPessoa,
  }
}

/** Liga e desliga o envio. É o freio de mão do sistema. */
export async function definirKillSwitch(ligado: boolean, por?: string) {
  const { error } = await db()
    .from('automation_settings')
    .update({ kill_switch: ligado, updated_at: new Date().toISOString(), updated_by: por ?? null })
    .eq('id', true)
  if (error) throw new Error(error.message)
}

export async function definirShadowMode(ligado: boolean, por?: string) {
  const { error } = await db()
    .from('automation_settings')
    .update({ shadow_mode: ligado, updated_at: new Date().toISOString(), updated_by: por ?? null })
    .eq('id', true)
  if (error) throw new Error(error.message)
}

export async function getAutomacao() {
  const { data } = await db()
    .from('automation_settings')
    .select(
      'kill_switch,shadow_mode,dm_hourly_cap,dm_daily_cap,cooldown_days_per_user,require_approval,reply_mode,delay_min_seconds,delay_max_seconds,reply_praise,reply_known_questions,reply_mentions,automation_started_at,dm_template,dm_mention_template,dm_on_comment,dm_on_mention',
    )
    .eq('id', true)
    .single()
  return data
}

/**
 * PRÉVIA da campanha — mesma lógica do envio, zero efeito colateral.
 *
 * É o que a interface mostra ANTES do botão: "137 destinatários elegíveis".
 * O número que você vê é o número que o servidor calculou com as MESMAS
 * regras que valerão no envio — não uma contagem otimista da tela.
 */
export async function previaCampanha(commentIds: string[]): Promise<{
  elegiveis: number
  removidosPorMotivo: Record<string, number>
}> {
  const { data: comentarios } = await db()
    .from('instagram_comments')
    .select('id,instagram_user_id')
    .in('id', commentIds.slice(0, 500))

  const vistos = new Set<string>()
  const motivos: Record<string, number> = {}
  let elegiveis = 0

  for (const c of comentarios ?? []) {
    if (c.instagram_user_id && vistos.has(c.instagram_user_id)) {
      motivos.SKIPPED_DUPLICATE = (motivos.SKIPPED_DUPLICATE ?? 0) + 1
      continue
    }
    if (c.instagram_user_id) vistos.add(c.instagram_user_id)

    const v = await revalidar(c.id)
    if (v.pode) elegiveis += 1
    else {
      const m = v.motivo ?? 'OUTRO'
      motivos[m] = (motivos[m] ?? 0) + 1
    }
  }
  return { elegiveis, removidosPorMotivo: motivos }
}
