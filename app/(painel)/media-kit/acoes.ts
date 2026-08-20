'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/lib/auth/guarda'
import { coletarNumeros, registrarGeracao, salvarManual } from '@/lib/analytics/media-kit'

function intOuNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').replace(/\./g, '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n) : null
}
function decimalOuNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

export async function salvarManualAction(formData: FormData) {
  const sessao = await exigirSessao()
  await salvarManual(
    {
      parceiros: intOuNull(formData.get('parceiros')),
      tiktok_seguidores: intOuNull(formData.get('tiktok_seguidores')),
      tiktok_views_7d: intOuNull(formData.get('tiktok_views_7d')),
      tiktok_curtidas_total: intOuNull(formData.get('tiktok_curtidas_total')),
      fb_seguidores: intOuNull(formData.get('fb_seguidores')),
      foto_capa_url: String(formData.get('foto_capa_url') ?? '').trim() || null,
      foto_dupla_url: String(formData.get('foto_dupla_url') ?? '').trim() || null,
      valor_padrao: decimalOuNull(formData.get('valor_padrao')),
      whatsapp: String(formData.get('whatsapp') ?? '').trim() || null,
    },
    sessao.usuario,
  )
  revalidatePath('/media-kit')
}

/** Congela os números de AGORA e abre a versão gerada. */
export async function gerarAction(formData: FormData) {
  const sessao = await exigirSessao()
  const cliente = String(formData.get('cliente') ?? '').trim() || null
  const valor = decimalOuNull(formData.get('valor'))
  const numeros = await coletarNumeros()
  const id = await registrarGeracao({ cliente, valor, numeros, por: sessao.usuario })
  revalidatePath('/media-kit')
  redirect(`/media-kit/${id}`)
}
