/**
 * Os 7 casos obrigatórios da regra global de 60 dias + lista limpa por pessoa.
 * Dados sintéticos AUDIT8, removidos no final. Nada é enviado.
 */
import { db } from '../lib/db'
import { revalidar } from '../lib/campaigns/eligibility'
import { previaCampanha } from '../lib/campaigns/create'

let falhas = 0
function caso(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas += 1
  console.log(`  ${ok ? '✓' : '✗'} ${nome.padEnd(58)} → ${String(obtido)}${ok ? '' : ` (esperado ${String(esperado)})`}`)
}

const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString()

async function main() {
  const { data: conta } = await db().from('instagram_accounts').select('id').limit(1).single()
  // 3 Reels sintéticos
  for (const n of ['A', 'B', 'C']) {
    await db().from('instagram_media').upsert(
      { instagram_media_id: `AUDIT8-m${n}`, instagram_account_id: conta!.id, media_type: 'VIDEO', media_product_type: 'REELS', caption: `Reel ${n}`, published_at: new Date().toISOString() },
      { onConflict: 'instagram_media_id' },
    )
  }
  const { data: ms } = await db().from('instagram_media').select('id,instagram_media_id').like('instagram_media_id', 'AUDIT8-m%')
  const mid = (n: string) => ms!.find((m) => m.instagram_media_id === `AUDIT8-m${n}`)!.id

  // Pessoas: joao (nunca recebeu), joao5d (DM há 5d), joao61d (DM há 61d),
  // maria (segue), ana (12 comentários)
  await db().from('instagram_users').upsert(
    [
      { instagram_user_id: 'AUDIT8-joao', username: 'joao', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString() },
      { instagram_user_id: 'AUDIT8-joao5d', username: 'joao5d', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString(), last_private_reply_at: dias(5) },
      { instagram_user_id: 'AUDIT8-joao61', username: 'joao61', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString(), last_private_reply_at: dias(61) },
      { instagram_user_id: 'AUDIT8-maria', username: 'maria', follow_status: 'FOLLOWS', follow_status_checked_at: new Date().toISOString() },
      { instagram_user_id: 'AUDIT8-ana', username: 'ana', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString() },
    ],
    { onConflict: 'instagram_user_id' },
  )

  // Comentários: joao 5x no Reel A; joao5d em 3 Reels; joao61 1x; maria 1x; ana 12x
  const comentarios: Array<{ n: string; uid: string; media: string }> = []
  for (let i = 1; i <= 5; i++) comentarios.push({ n: `joao-${i}`, uid: 'AUDIT8-joao', media: 'A' })
  for (const m of ['A', 'B', 'C']) comentarios.push({ n: `joao5d-${m}`, uid: 'AUDIT8-joao5d', media: m })
  comentarios.push({ n: 'joao61-1', uid: 'AUDIT8-joao61', media: 'B' })
  comentarios.push({ n: 'maria-1', uid: 'AUDIT8-maria', media: 'A' })
  for (let i = 1; i <= 12; i++) comentarios.push({ n: `ana-${i}`, uid: 'AUDIT8-ana', media: 'C' })

  await db().from('instagram_comments').upsert(
    comentarios.map((c) => ({
      instagram_comment_id: `AUDIT8-${c.n}`,
      media_id: mid(c.media),
      instagram_media_id: `AUDIT8-m${c.media}`,
      instagram_user_id: c.uid,
      username: c.uid.replace('AUDIT8-', ''),
      text: 'teste',
      commented_at: new Date().toISOString(),
      source: 'webhook',
      eligibility_status: 'ELIGIBLE',
      eligibility_expires_at: new Date(Date.now() + 6 * 86_400_000).toISOString(),
      analysis_status: 'ANALYZED',
      is_from_account: false,
    })),
    { onConflict: 'instagram_comment_id' },
  )

  const { data: todos } = await db().from('instagram_comments').select('id,instagram_comment_id').like('instagram_comment_id', 'AUDIT8-%')
  const ids = (todos ?? []).map((t) => t.id)
  const previa = await previaCampanha(ids)

  console.log('\n── prévia da lista limpa (mesma lógica do envio) ──')
  console.log(`  bruto: ${ids.length} comentários · elegíveis: ${previa.elegiveis} · removidos: ${JSON.stringify(previa.removidosPorMotivo)}`)

  // CASO 1: joão 5 comentários, nunca recebeu → aparece 1 vez
  // CASO 6: ana 12 comentários → 1 vez  |  CASO 4: joao61 → aparece
  // = 3 elegíveis (joao, joao61, ana)
  caso('CASO 1+6+4: joao(5x) + ana(12x) + joao61 → 3 elegíveis', previa.elegiveis, 3)

  // CASO 2+3: joao5d (DM há 5 dias) comenta em 3 Reels → NÃO aparece
  const c2 = (todos ?? []).find((t) => t.instagram_comment_id === 'AUDIT8-joao5d-B')!
  const v2 = await revalidar(c2.id)
  caso('CASO 2/3: DM há 5 dias, outro Reel → bloqueado', v2.motivo, 'DM_RECENTE')

  // CASO 4: DM há 61 dias → pode
  const c4 = (todos ?? []).find((t) => t.instagram_comment_id === 'AUDIT8-joao61-1')!
  caso('CASO 4: DM há 61 dias → elegível', (await revalidar(c4.id)).pode, true)

  // CASO 5: maria segue → não aparece
  const c5 = (todos ?? []).find((t) => t.instagram_comment_id === 'AUDIT8-maria-1')!
  caso('CASO 5: já segue → bloqueada', (await revalidar(c5.id)).motivo, 'JA_SEGUE')

  // CASO 7: os removidos somam certo (17 dup + 3 DM recente + 1 segue = 21; 24-21=3)
  const dup = previa.removidosPorMotivo.SKIPPED_DUPLICATE ?? 0
  const rec = previa.removidosPorMotivo.DM_RECENTE ?? 0
  const seg = previa.removidosPorMotivo.JA_SEGUE ?? 0
  // joao 4 extras + joao5d 2 extras + ana 11 extras = 17 duplicatas
  caso('CASO 7: removidos = duplicados(17) + DM<60d(1) + segue(1)', `${dup}/${rec}/${seg}`, '17/1/1')

  // RPC por pessoa também colapsa
  const { data: rpc } = await db().rpc('oportunidades_dm')
  const doTeste = ((rpc ?? []) as Array<{ instagram_user_id: string }>).filter((r) => r.instagram_user_id?.startsWith('AUDIT8'))
  caso('RPC oportunidades_dm: 3 pessoas do teste', doTeste.length, 3)

  // limpeza
  await db().from('comment_actions').delete().in('comment_id', ids)
  await db().from('comment_analyses').delete().in('comment_id', ids)
  await db().from('instagram_comments').delete().in('id', ids)
  await db().from('instagram_users').delete().like('instagram_user_id', 'AUDIT8%')
  for (const m of ms ?? []) {
    await db().from('platform_posts').delete().eq('legacy_media_id', m.id)
    await db().from('contents').delete().eq('seed_media_id', m.id)
  }
  await db().from('instagram_media').delete().like('instagram_media_id', 'AUDIT8%')
  const { count: sobra } = await db().from('instagram_comments').select('id', { count: 'exact', head: true }).like('instagram_comment_id', 'AUDIT8%')
  caso('limpeza completa', sobra, 0)

  console.log(`\n${falhas === 0 ? '✓ REGRA 60 DIAS: todos os casos passaram' : `✗ ${falhas} caso(s) falharam`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  process.exit(1)
})
