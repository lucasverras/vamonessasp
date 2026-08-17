/**
 * TESTE CONTROLADO DE ENVIO REAL.
 *
 * Envia UMA private reply para UM comentário explicitamente informado por ID.
 * O kill switch é destravado pelo tempo mínimo e retravado em qualquer desfecho,
 * inclusive em erro — o finally garante isso.
 */
import { db } from '../lib/db'
import { criarCampanha, definirKillSwitch, definirShadowMode } from '../lib/campaigns/create'
import { processarLote } from '../lib/campaigns/worker'

const COMMENT_IG_ID = process.argv[2]
if (!COMMENT_IG_ID) throw new Error('Informe o instagram_comment_id.')

const MENSAGEM = `Valeu por comentar no nosso vídeo! 👀

Somos o Vamo Nessa e sempre mostramos restaurantes, rolês e lugares diferentes por SP.

Segue a gente pra não perder os próximos!`

async function main() {
  const { data: c } = await db()
    .from('instagram_comments')
    .select('id,username,text,commented_at,eligibility_status')
    .eq('instagram_comment_id', COMMENT_IG_ID)
    .single()
  if (!c) throw new Error('Comentário não encontrado no banco.')

  console.log(`alvo único: @${c.username} — "${c.text}"`)
  console.log(`status: ${c.eligibility_status}\n`)

  console.log('1. criando campanha com UM destinatário')
  const camp = await criarCampanha({
    nome: 'TESTE CONTROLADO — envio real',
    mensagem: MENSAGEM,
    commentIds: [c.id],
  })
  console.log(`   enfileirados=${camp.enfileirados} recusados=${camp.recusados.length}`)
  if (camp.enfileirados !== 1) {
    console.log(`   motivos: ${JSON.stringify(camp.recusados)}`)
    throw new Error('ABORTADO: esperava exatamente 1 na fila.')
  }

  // Confirmação paranoica: a fila inteira precisa ter exatamente 1 item.
  const { count } = await db()
    .from('comment_actions')
    .select('id', { count: 'exact', head: true })
    .in('status', ['QUEUED', 'SENDING'])
  console.log(`2. total pendente em TODA a fila: ${count}`)
  if (count !== 1) throw new Error(`ABORTADO: a fila tem ${count} itens, esperava 1.`)

  try {
    console.log('3. destravando envio (shadow off, kill switch off)')
    await definirShadowMode(false, 'teste-controlado')
    await definirKillSwitch(false, 'teste-controlado')

    console.log('4. processando lote de 1')
    console.log(`   ${JSON.stringify(await processarLote(1))}`)
  } finally {
    await definirKillSwitch(true, 'teste-controlado')
    await definirShadowMode(true, 'teste-controlado')
    const { data: cfg } = await db()
      .from('automation_settings')
      .select('kill_switch,shadow_mode')
      .eq('id', true)
      .single()
    console.log(`5. RETRAVADO: kill_switch=${cfg!.kill_switch} shadow_mode=${cfg!.shadow_mode}`)
  }

  console.log('\n6. resultado')
  const { data: acao } = await db()
    .from('comment_actions')
    .select('status,sent_at,external_id,external_recipient_id,error_code,error_message,skip_reason,attempts')
    .eq('campaign_id', camp.campanhaId)
    .single()
  console.log(`   ${JSON.stringify(acao, null, 1)}`)

  const { data: dep } = await db()
    .from('instagram_comments')
    .select('eligibility_status,private_reply_sent_at,private_reply_message_id')
    .eq('id', c.id)
    .single()
  console.log(`   comentário: ${JSON.stringify(dep)}`)

  const { data: pessoa } = await db()
    .from('instagram_users')
    .select('username,private_replies_count,last_private_reply_at')
    .eq('username', c.username!)
    .maybeSingle()
  console.log(`   pessoa: ${JSON.stringify(pessoa)}`)
}
main().catch((e) => { console.error('\nERRO:', e.message); process.exit(1) })
