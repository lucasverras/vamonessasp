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
