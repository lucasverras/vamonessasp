'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { exigirSessao } from '@/lib/auth/guarda'
import { coletarNumeros, registrarGeracao } from '@/lib/analytics/media-kit'

function decimalOuNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? '').replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
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
