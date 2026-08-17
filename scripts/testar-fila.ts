/**
 * Prova a fila de ponta a ponta SEM enviar nada a pessoas reais.
 * O kill switch permanece ligado durante todo o teste.
 */
import { db } from '../lib/db'
import { criarCampanha } from '../lib/campaigns/create'
import { processarLote, destravarPresos } from '../lib/campaigns/worker'
import { revalidar } from '../lib/campaigns/eligibility'

async function main() {
  const { data: cfg } = await db().from('automation_settings').select('kill_switch,shadow_mode').eq('id', true).single()
  console.log(`kill_switch=${cfg!.kill_switch}  shadow_mode=${cfg!.shadow_mode}`)
  if (!cfg!.kill_switch) throw new Error('ABORTADO: kill switch está DESLIGADO — não vou arriscar envio real.')

  // Pega 3 comentários elegíveis, sendo 2 da MESMA pessoa se possível, para
  // provar o dedupe por pessoa.
  const { data: cands } = await db()
    .from('instagram_comments')
    .select('id,username,instagram_user_id')
    .eq('eligibility_status', 'ELIGIBLE').is('deleted_at', null)
    .limit(40)

  const porPessoa = new Map<string, string[]>()
  for (const c of cands ?? []) {
    const k = c.instagram_user_id!
    porPessoa.set(k, [...(porPessoa.get(k) ?? []), c.id])
  }
  const repetida = [...porPessoa.values()].find((v) => v.length > 1)
  const selecao = repetida ? [...repetida.slice(0, 2)] : []
  for (const [, ids] of porPessoa) {
    if (selecao.length >= 4) break
    if (!selecao.includes(ids[0]!)) selecao.push(ids[0]!)
  }
  console.log(`\nselecionados: ${selecao.length} comentários` + (repetida ? ' (2 são da mesma pessoa)' : ''))

  console.log('\n1. revalidação individual antes de criar')
  for (const id of selecao) {
    const v = await revalidar(id)
    console.log(`   ${id.slice(0, 8)} → pode=${v.pode} ${v.motivo ?? ''}`)
  }

  console.log('\n2. criando campanha')
  const r = await criarCampanha({ nome: 'TESTE DE FILA — não envia', mensagem: 'Mensagem de teste da fila. Nada deve sair.', commentIds: selecao })
  console.log(`   campanha=${r.campanhaId.slice(0, 8)}  enfileirados=${r.enfileirados}  dedupePessoa=${r.dedupePorPessoa}  recusados=${r.recusados.length}`)

  console.log('\n3. estado na fila')
  const { data: fila } = await db().from('comment_actions').select('status,attempts').eq('campaign_id', r.campanhaId)
  console.log(`   ${JSON.stringify(fila)}`)

  console.log('\n4. worker roda com kill switch LIGADO')
  console.log(`   ${JSON.stringify(await processarLote(10))}`)
  const { data: dep } = await db().from('comment_actions').select('status').eq('campaign_id', r.campanhaId)
  console.log(`   estados após o worker: ${JSON.stringify(dep)}  ← inalterados = nada foi enviado`)

  console.log('\n5. idempotência: tentar enfileirar OS MESMOS comentários de novo')
  const r2 = await criarCampanha({ nome: 'TESTE DE FILA — duplicado', mensagem: 'Segunda tentativa com os mesmos comentários.', commentIds: selecao })
  console.log(`   enfileirados=${r2.enfileirados}  recusados=${r2.recusados.length}`)
  console.log(`   motivos: ${JSON.stringify(r2.recusados.map((x) => x.motivo))}`)

  console.log('\n6. orçamento e destravamento')
  const { data: orc } = await db().rpc('orcamento_envio_restante')
  console.log(`   orçamento da hora=${orc}  destravados=${await destravarPresos()}`)

  console.log('\n7. limpando as campanhas de teste')
  await db().from('dm_campaigns').delete().in('id', [r.campanhaId, r2.campanhaId])
  const { count } = await db().from('comment_actions').select('id', { count: 'exact', head: true })
  console.log(`   comment_actions restantes: ${count}`)
}
main().catch((e) => { console.error('\nFALHOU:', e.message); process.exit(1) })
