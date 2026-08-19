'use server'

import { revalidatePath } from 'next/cache'
import { exigirAdmin } from '@/lib/auth/guarda'
import { db } from '@/lib/db'

export interface ResultadoCfg {
  ok: boolean
  erro?: string
}

/**
 * Muda o modo da automação de respostas. ADMIN apenas.
 *
 * OFF     → análises viram registro (SHADOW); nada entra na fila sozinho.
 * DRY_RUN → pipeline inteiro roda, para na beira do envio. Default.
 * LIVE    → envia de verdade. Exige kill switch desligado por fora.
 *
 * A primeira saída de OFF grava automation_started_at: só comentários DEPOIS
 * desse instante entram no pipeline automático. Ligar a automação nunca
 * despeja o histórico.
 */
export async function definirModoAutomacao(modo: 'OFF' | 'DRY_RUN' | 'LIVE'): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('mudar o modo da automação')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  if (!['OFF', 'DRY_RUN', 'LIVE'].includes(modo)) return { ok: false, erro: 'Modo inválido.' }

  const { data: atual } = await db()
    .from('automation_settings')
    .select('automation_started_at')
    .eq('id', true)
    .single()

  const { error } = await db()
    .from('automation_settings')
    .update({
      reply_mode: modo,
      automation_started_at:
        modo === 'OFF' ? atual?.automation_started_at : (atual?.automation_started_at ?? new Date().toISOString()),
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  revalidatePath('/revisao')
  return { ok: true }
}

/** Template institucional da DM (objetivo: follow). ADMIN. */
export async function definirTemplateDm(form: FormData): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('editar o template da DM')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const texto = String(form.get('dm_template') ?? '').trim()
  if (texto.length < 10) return { ok: false, erro: 'Template curto demais.' }
  const { error } = await db()
    .from('automation_settings')
    .update({ dm_template: texto, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  return { ok: true }
}

export async function definirCadencia(form: FormData): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('mudar a cadência da automação')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }

  const minMin = Number(form.get('delay_min_minutos'))
  const maxMin = Number(form.get('delay_max_minutos'))
  if (!Number.isFinite(minMin) || !Number.isFinite(maxMin) || minMin < 0 || maxMin < minMin) {
    return { ok: false, erro: 'Janela inválida: mínimo ≥ 0 e máximo ≥ mínimo.' }
  }

  const { error } = await db()
    .from('automation_settings')
    .update({
      delay_min_seconds: Math.round(minMin * 60),
      delay_max_seconds: Math.round(maxMin * 60),
      reply_praise: form.get('reply_praise') === 'on',
      reply_known_questions: form.get('reply_known_questions') === 'on',
      reply_mentions: form.get('reply_mentions') === 'on',
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)

  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  return { ok: true }
}

/** Janela global entre DMs por pessoa + fontes de oportunidade. ADMIN. */
export async function definirRegrasDm(form: FormData): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('editar regras de DM')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const dias = Number(form.get('cooldown_dias'))
  if (!Number.isFinite(dias) || dias < 0 || dias > 365) {
    return { ok: false, erro: 'Janela inválida (0–365 dias).' }
  }
  const { error } = await db()
    .from('automation_settings')
    .update({
      cooldown_days_per_user: Math.round(dias),
      dm_on_comment: form.get('dm_on_comment') === 'on',
      dm_on_mention: form.get('dm_on_mention') === 'on',
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  return { ok: true }
}

/** Template da DM de MENÇÃO. ADMIN. */
export async function definirTemplateMencao(form: FormData): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('editar o template de menção')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const texto = String(form.get('dm_mention_template') ?? '').trim()
  if (texto.length < 10) return { ok: false, erro: 'Template curto demais.' }
  const { error } = await db()
    .from('automation_settings')
    .update({ dm_mention_template: texto, updated_at: new Date().toISOString() })
    .eq('id', true)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  return { ok: true }
}

/** Importa a exportação oficial de seguidores ("Baixar suas informações"). ADMIN. */
export async function importarSeguidoresAction(form: FormData): Promise<
  | { ok: true; seguidoresNoArquivo: number; marcadosComoSeguidores: number; marcadosComoNaoSeguidores: number; dmsPuladasDeSeguidores: number }
  | { ok: false; erro: string }
> {
  let sessao
  try {
    sessao = await exigirAdmin('importar seguidores')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const arquivo = form.get('arquivo')
  if (!(arquivo instanceof File) || arquivo.size === 0) {
    return { ok: false, erro: 'Selecione o arquivo followers_1.json da exportação.' }
  }
  if (arquivo.size > 20 * 1024 * 1024) return { ok: false, erro: 'Arquivo grande demais (20MB máx).' }
  try {
    const { importarSeguidores } = await import('@/lib/instagram/importar-seguidores')
    const r = await importarSeguidores(await arquivo.text(), sessao.usuario)
    revalidatePath('/configuracoes/instagram')
    revalidatePath('/comentarios')
    revalidatePath('/aprovacoes')
    return { ok: true, ...r }
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Falha ao importar.' }
  }
}

/** Private Reply do Facebook: flag + template. ADMIN. */
export async function definirPrFacebook(form: FormData): Promise<ResultadoCfg> {
  try {
    await exigirAdmin('configurar private reply do Facebook')
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : 'Sem permissão.' }
  }
  const texto = String(form.get('fb_dm_template') ?? '').trim()
  if (texto.length < 10) return { ok: false, erro: 'Template curto demais.' }
  const { error } = await db()
    .from('automation_settings')
    .update({
      fb_private_reply_enabled: form.get('fb_pr_enabled') === 'on',
      fb_dm_template: texto,
      updated_at: new Date().toISOString(),
    })
    .eq('id', true)
  if (error) return { ok: false, erro: error.message }
  revalidatePath('/configuracoes/instagram')
  return { ok: true }
}
