/**
 * Provas do modo APPROVAL_REQUIRED. Nenhuma pessoa real recebe nada:
 * o único POST à Meta usa um comment_id inexistente (AUDIT3), que ela recusa
 * com [100] — o que também prova o caminho "comentário removido → FAILED".
 */
import { db } from '../lib/db'
import { decidirDestino, type ConfigAutomacao } from '../lib/automation/decidir'
import { enviarAprovada } from '../lib/automation/aprovar'
import { processarLote } from '../lib/campaigns/worker'

let falhas = 0
function caso(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas += 1
  console.log(`  ${ok ? '✓' : '✗'} ${nome.padEnd(56)} → ${String(obtido)}${ok ? '' : ` (esperado ${String(esperado)})`}`)
}

const cfg: ConfigAutomacao = {
  reply_mode: 'APPROVAL_REQUIRED',
  kill_switch: false,
  delay_min_seconds: 180,
  delay_max_seconds: 420,
  reply_praise: true,
  reply_known_questions: true,
  reply_mentions: true,
  automation_started_at: '2026-08-17T00:00:00Z',
  auto_approve_intents: [],
  never_auto_intents: ['critica', 'situacao_delicada', 'oportunidade_comercial', 'spam'],
  min_confidence_for_auto: 0.85,
}
const base = {
  cfg,
  intent: 'elogio',
  confidence: 0.95,
  decision: 'SEND_BOTH',
  requiresHuman: false,
  commentedAt: '2026-08-17T12:00:00Z',
}

async function main() {
  console.log('\n── 1. destino no modo APPROVAL_REQUIRED ──')
  caso('comentário positivo', decidirDestino(base).status, 'PENDING_APPROVAL')
  caso('pergunta com fato (localizacao 97%)', decidirDestino({ ...base, intent: 'localizacao', confidence: 0.97 }).status, 'PENDING_APPROVAL')
  caso('pergunta sem fato (HOLD da IA)', decidirDestino({ ...base, intent: 'duvida', decision: 'HOLD_FOR_REVIEW' }).status, 'PENDING_APPROVAL')
  caso('negativo (critica, requiresHuman)', decidirDestino({ ...base, intent: 'critica', requiresHuman: true }).status, 'PENDING_APPROVAL')
  // HOLD e aprovação são PENDING_APPROVAL no status, mas separados na tela
  // pela análise (requires_human/decision) — verificado no item 3 abaixo.

  console.log('\n── 2. nenhuma interação humana → 0 envios ──')
  const antes = await db().from('comment_actions').select('id', { count: 'exact', head: true }).eq('status', 'SENT')
  const lote = await processarLote(10)
  const depois = await db().from('comment_actions').select('id', { count: 'exact', head: true }).eq('status', 'SENT')
  caso('worker não reivindica nada', lote.parouPor, 'SEM_TRABALHO')
  caso('SENT não mudou', depois.count, antes.count)

  console.log('\n── 3. aprovação: claim atômico + comentário inexistente ──')
  const { data: conta } = await db().from('instagram_accounts').select('id').limit(1).single()
  await db().from('instagram_media').insert({
    instagram_media_id: 'AUDIT3-m', instagram_account_id: conta!.id,
    media_type: 'VIDEO', media_product_type: 'REELS', caption: 'AUDIT3', published_at: new Date().toISOString(),
  })
  const { data: m } = await db().from('instagram_media').select('id').eq('instagram_media_id', 'AUDIT3-m').single()
  await db().from('instagram_comments').insert({
    instagram_comment_id: 'AUDIT3-c', media_id: m!.id, instagram_media_id: 'AUDIT3-m',
    instagram_user_id: 'AUDIT3-u', username: 'audit3', text: 'teste', commented_at: new Date().toISOString(),
    source: 'webhook', eligibility_status: 'ELIGIBLE',
    eligibility_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    analysis_status: 'ANALYZED', is_from_account: false,
  })
  const { data: c } = await db().from('instagram_comments').select('id').eq('instagram_comment_id', 'AUDIT3-c').single()
  const { data: acao } = await db().from('comment_actions').insert({
    comment_id: c!.id, action_type: 'PUBLIC_REPLY', mode: 'AUTO', status: 'PENDING_APPROVAL',
    generated_text: 'resposta de teste', instagram_user_id: 'AUDIT3-u', media_id: m!.id, reply_source: 'AI',
  }).select('id').single()

  // duas "abas" aprovando simultaneamente
  const [r1, r2] = await Promise.all([
    enviarAprovada(acao!.id, 'aba-A'),
    enviarAprovada(acao!.id, 'aba-B'),
  ])
  const status = [r1.status, r2.status].sort()
  caso('uma aba processa, outra recebe JA_PROCESSADA', status.includes('JA_PROCESSADA'), true)
  caso('comentário inexistente na Meta → FALHA, sem envio', status.includes('FALHA_META'), true)
  const { data: aposFalha } = await db().from('comment_actions').select('status,error_class').eq('id', acao!.id).single()
  caso('erro permanente → FAILED (sem loop de retry)', aposFalha?.status, 'FAILED')

  // terceiro clique depois de terminal
  const r3 = await enviarAprovada(acao!.id, 'aba-C')
  caso('clique após estado terminal → JA_PROCESSADA', r3.status, 'JA_PROCESSADA')

  console.log('\n── 4. kill switch é soberano sobre a aprovação ──')
  const { data: acao2 } = await db().from('comment_actions').insert({
    comment_id: c!.id, action_type: 'PRIVATE_REPLY', mode: 'AUTO', status: 'PENDING_APPROVAL',
    generated_text: 'dm de teste', instagram_user_id: 'AUDIT3-u', media_id: m!.id, reply_source: 'AI',
  }).select('id').single()
  await db().from('automation_settings').update({ kill_switch: true }).eq('id', true)
  const rKill = await enviarAprovada(acao2!.id, 'teste')
  caso('aprovado com kill switch → BLOQUEADA', rKill.status, 'BLOQUEADA_KILL_SWITCH')
  const { data: intacta } = await db().from('comment_actions').select('status').eq('id', acao2!.id).single()
  caso('ação continua PENDING_APPROVAL (não consumida)', intacta?.status, 'PENDING_APPROVAL')
  await db().from('automation_settings').update({ kill_switch: false }).eq('id', true)

  console.log('\n── 5. edição e descarte ──')
  const rEd = await enviarAprovada(acao2!.id, 'lucasverras', 'versão editada pelo humano')
  const { data: editada } = await db().from('comment_actions').select('final_text,edited_by,status').eq('id', acao2!.id).single()
  caso('edição persiste final_text', editada?.final_text, 'versão editada pelo humano')
  caso('edited_by registrado', editada?.edited_by, 'lucasverras')
  caso('DM para comentário fake → falha, nunca enviada', rEd.ok, false)

  await db().from('comment_actions').update({ status: 'PENDING_APPROVAL' }).eq('id', acao2!.id)
  await db().from('comment_actions').update({ status: 'REJECTED', rejected_by: 'teste' }).eq('id', acao2!.id)
  const rDesc = await enviarAprovada(acao2!.id, 'teste')
  caso('descartada → aprovar depois = JA_PROCESSADA', rDesc.status, 'JA_PROCESSADA')

  // limpeza
  await db().from('comment_actions').delete().in('id', [acao!.id, acao2!.id])
  await db().from('comment_analyses').delete().eq('comment_id', c!.id)
  await db().from('instagram_comments').delete().eq('id', c!.id)
  await db().from('instagram_users').delete().eq('instagram_user_id', 'AUDIT3-u')
  await db().from('instagram_media').delete().eq('id', m!.id)
  const { count: sobra } = await db().from('instagram_comments').select('id', { count: 'exact', head: true }).like('instagram_comment_id', 'AUDIT3%')
  caso('limpeza completa', sobra, 0)

  console.log(`\n${falhas === 0 ? '✓ APROVAÇÃO: todos os casos passaram' : `✗ ${falhas} caso(s) falharam`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  process.exit(1)
})
