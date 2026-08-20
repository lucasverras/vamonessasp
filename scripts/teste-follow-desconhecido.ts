/**
 * Regra do incidente 20/08: DM em massa SÓ para NOT_FOLLOWING comprovado.
 * UNKNOWN: bloqueado por padrão; passa apenas com permitirFollowDesconhecido
 * (aprovação individual). Dados sintéticos AUDIT9, limpos ao final.
 */
import { db } from '../lib/db'
import { revalidar } from '../lib/campaigns/eligibility'

let falhas = 0
function caso(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas += 1
  console.log(`  ${ok ? '✓' : '✗'} ${nome.padEnd(60)} → ${String(obtido)}${ok ? '' : ` (esperado ${String(esperado)})`}`)
}

async function main() {
  const { data: conta } = await db().from('instagram_accounts').select('id').limit(1).single()
  await db().from('instagram_media').upsert(
    { instagram_media_id: 'AUDIT9-m', instagram_account_id: conta!.id, media_type: 'VIDEO', media_product_type: 'REELS', caption: 'x', published_at: new Date().toISOString() },
    { onConflict: 'instagram_media_id' },
  )
  const { data: m } = await db().from('instagram_media').select('id').eq('instagram_media_id', 'AUDIT9-m').single()
  await db().from('instagram_users').upsert(
    [
      { instagram_user_id: 'AUDIT9-unknown', username: 'a9unknown', follow_status: 'UNKNOWN' },
      { instagram_user_id: 'AUDIT9-nsegue', username: 'a9nsegue', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString() },
    ],
    { onConflict: 'instagram_user_id' },
  )
  const linha = (n: string, uid: string) => ({
    instagram_comment_id: `AUDIT9-${n}`, media_id: m!.id, instagram_media_id: 'AUDIT9-m',
    instagram_user_id: uid, username: uid.replace('AUDIT9-', 'a9'), text: 'teste',
    commented_at: new Date().toISOString(), source: 'webhook',
    eligibility_status: 'ELIGIBLE', eligibility_expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
    analysis_status: 'ANALYZED', is_from_account: false,
  })
  await db().from('instagram_comments').upsert(
    [linha('c-unknown', 'AUDIT9-unknown'), linha('c-nsegue', 'AUDIT9-nsegue'), linha('c-semrow', 'AUDIT9-semrow')],
    { onConflict: 'instagram_comment_id' },
  )
  const id = async (n: string) =>
    (await db().from('instagram_comments').select('id').eq('instagram_comment_id', `AUDIT9-${n}`).single()).data!.id as string

  const vU = await revalidar(await id('c-unknown'))
  caso('UNKNOWN em massa → bloqueado', vU.motivo, 'FOLLOW_STATUS_UNKNOWN')
  const vUi = await revalidar(await id('c-unknown'), undefined, { permitirFollowDesconhecido: true })
  caso('UNKNOWN com aprovação individual → pode', vUi.pode, true)
  const vN = await revalidar(await id('c-nsegue'))
  caso('NOT_FOLLOWING comprovado em massa → pode', vN.pode, true)
  const vS = await revalidar(await id('c-semrow'))
  caso('pessoa sem registro (sem prova) em massa → bloqueado', vS.motivo, 'FOLLOW_STATUS_UNKNOWN')

  // limpeza
  await db().from('instagram_comments').delete().like('instagram_comment_id', 'AUDIT9-%')
  await db().from('instagram_users').delete().like('instagram_user_id', 'AUDIT9-%')
  await db().from('instagram_media').delete().eq('instagram_media_id', 'AUDIT9-m')

  console.log(falhas === 0 ? '\nTODOS OS CASOS PASSARAM' : `\n${falhas} FALHAS`)
  process.exit(falhas === 0 ? 0 : 1)
}
main()
