/**
 * Testes das regras §31–§46: portão de DM, espelhamento, hierarquia de fontes
 * e isolamento por conteúdo. Mídias sintéticas AUDIT4, removidas no fim.
 * IA real; nenhuma mensagem enviada (APPROVAL_REQUIRED + nada aprovado).
 */
import { db } from '../lib/db'
import { analisarPendentes, respostaAncoradaNoComentario } from '../lib/ai/analise'
import { gateDmParaIgsid, JANELA_DM_RECENTE_DIAS } from '../lib/instagram/follow-status'

let falhas = 0
function caso(nome: string, obtido: unknown, esperado: unknown) {
  const ok = obtido === esperado
  if (!ok) falhas += 1
  console.log(`  ${ok ? '✓' : '✗'} ${nome.padEnd(56)} → ${String(obtido)}${ok ? '' : ` (esperado ${String(esperado)})`}`)
}

async function main() {
  console.log('\n── 1. portão da DM (§31/32/46) ──')
  // três pessoas sintéticas com estados diferentes
  await db().from('instagram_users').upsert(
    [
      { instagram_user_id: 'AUDIT4-segue', username: 'a4segue', follow_status: 'FOLLOWS', follow_status_checked_at: new Date().toISOString() },
      { instagram_user_id: 'AUDIT4-nsegue', username: 'a4nsegue', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString() },
      { instagram_user_id: 'AUDIT4-recente', username: 'a4recente', follow_status: 'NOT_FOLLOWING', follow_status_checked_at: new Date().toISOString(), last_private_reply_at: new Date().toISOString() },
    ],
    { onConflict: 'instagram_user_id' },
  )
  caso('usuário SEGUE → sem DM', (await gateDmParaIgsid('AUDIT4-segue')).pode === false && (await gateDmParaIgsid('AUDIT4-segue') as { motivo: string }).motivo, 'SKIPPED_ALREADY_FOLLOWING')
  caso('NÃO segue e sem DM recente → DM pode', (await gateDmParaIgsid('AUDIT4-nsegue')).pode, true)
  caso(`DM há < ${JANELA_DM_RECENTE_DIAS}d → SKIPPED_RECENT_DM`, (await gateDmParaIgsid('AUDIT4-recente') as { motivo: string }).motivo, 'SKIPPED_RECENT_DM')
  // pessoa real do banco: sem Advanced Access, o status é UNKNOWN → sem DM
  const { data: real } = await db().from('instagram_users').select('instagram_user_id').not('instagram_user_id', 'like', 'AUDIT%').limit(1).single()
  const gateReal = await gateDmParaIgsid(real!.instagram_user_id as string)
  caso('pessoa real hoje (sem Advanced Access) → UNKNOWN, sem DM', !gateReal.pode && (gateReal as { motivo: string }).motivo, 'FOLLOW_STATUS_UNKNOWN')

  console.log('\n── 2. validador de resposta ancorada (§40) ──')
  const fatos = { preco: 'R$ 89,90' }
  caso('"Que demais 😍" p/ "onde fica?" reprova', respostaAncoradaNoComentario({ intent: 'localizacao', resposta: 'Que demais 😍', comentario: 'onde fica?', legenda: 'Rua X, 250 - Mooca', fatos: {} }), false)
  caso('resposta com endereço aprova', respostaAncoradaNoComentario({ intent: 'localizacao', resposta: 'Fica na Rua X, 250, na Mooca', comentario: 'onde fica?', legenda: 'Rua X, 250 - Mooca', fatos: {} }), true)
  caso('preço numérico aprova', respostaAncoradaNoComentario({ intent: 'preco', resposta: 'R$ 89,90 de segunda a quinta 😊', comentario: 'quanto custa?', legenda: null, fatos }), true)
  caso('elogio não passa pelo validador factual', respostaAncoradaNoComentario({ intent: 'elogio', resposta: 'Lindo demais 😍', comentario: 'que lugar lindo', legenda: null, fatos: {} }), true)

  console.log('\n── 3. pipeline real com IA (mídias A e B isoladas) ──')
  const { data: conta } = await db().from('instagram_accounts').select('id').limit(1).single()
  const medias = [
    { ext: 'AUDIT4-mA', caption: '🍤 Restaurante Mar Azul\n📍 Rua Guaimbé, 123 - Mooca, São Paulo\nRodízio R$ 89,90 de segunda a quinta.' },
    { ext: 'AUDIT4-mB', caption: '🎭 Festival no Memorial da América Latina\nAv. Auro Soares, 664 - Barra Funda\nEntrada gratuita.' },
  ]
  for (const m of medias) {
    await db().from('instagram_media').upsert(
      { instagram_media_id: m.ext, instagram_account_id: conta!.id, media_type: 'VIDEO', media_product_type: 'REELS', caption: m.caption, published_at: new Date().toISOString() },
      { onConflict: 'instagram_media_id' },
    )
  }
  const { data: mA } = await db().from('instagram_media').select('id').eq('instagram_media_id', 'AUDIT4-mA').single()
  const { data: mB } = await db().from('instagram_media').select('id').eq('instagram_media_id', 'AUDIT4-mB').single()

  const casosIA: Array<[string, string, string]> = [
    ['c1', '😍', 'AUDIT4-mA'],
    ['c2', '🔥🔥', 'AUDIT4-mA'],
    ['c3', 'onde fica?', 'AUDIT4-mA'],
    ['c4', 'quanto custa?', 'AUDIT4-mA'],
    ['c5', 'tem estacionamento?', 'AUDIT4-mA'],
    ['c6', 'que lugar lindo', 'AUDIT4-mA'],
    ['c7', 'preciso ir', 'AUDIT4-mA'],
    ['c8', '@amigo olha isso', 'AUDIT4-mA'],
    ['c9', 'onde fica?', 'AUDIT4-mB'],
  ]
  await db().from('instagram_comments').upsert(
    casosIA.map(([n, texto, ext]) => ({
      instagram_comment_id: `AUDIT4-${n}`,
      media_id: ext === 'AUDIT4-mA' ? mA!.id : mB!.id,
      instagram_media_id: ext,
      instagram_user_id: 'AUDIT4-nsegue',
      username: 'a4nsegue',
      text: texto,
      commented_at: new Date().toISOString(),
      source: 'webhook',
      eligibility_status: 'ELIGIBLE',
      eligibility_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      analysis_status: 'PENDING',
      is_from_account: false,
    })),
    { onConflict: 'instagram_comment_id' },
  )

  let total = 0
  for (let i = 0; i < 3 && total < casosIA.length; i++) {
    const r = await analisarPendentes(10)
    total += r.analisados
    if (r.analisados === 0) break
  }

  const { data: resultados } = await db()
    .from('instagram_comments')
    .select('instagram_comment_id,text,comment_analyses(intent,decision,requires_human,suggested_public_reply)')
    .like('instagram_comment_id', 'AUDIT4-c%')
    .order('instagram_comment_id')

  const por = new Map(
    (resultados ?? []).map((r) => {
      const a = (r.comment_analyses as Array<{ intent: string; decision: string; requires_human: boolean; suggested_public_reply: string | null }>)[0]
      return [r.instagram_comment_id as string, { texto: r.text as string, ...a }]
    }),
  )

  const soEmoji = (s: string | null) => !!s && !/[a-záéíóúâêôãõça-z0-9]/i.test(s)
  const c1 = por.get('AUDIT4-c1')
  caso('😍 → resposta só de emoji', soEmoji(c1?.suggested_public_reply ?? null), true)
  const c2 = por.get('AUDIT4-c2')
  caso('🔥🔥 → reação curta compatível (emoji)', soEmoji(c2?.suggested_public_reply ?? null), true)
  const c3 = por.get('AUDIT4-c3')
  caso('"onde fica?" usa a legenda (Guaimbé)', /guaimb[eé]|123/i.test(c3?.suggested_public_reply ?? ''), true)
  const c4 = por.get('AUDIT4-c4')
  caso('"quanto custa?" usa preço da legenda', /89[,.]?90/.test(c4?.suggested_public_reply ?? ''), true)
  const c5 = por.get('AUDIT4-c5')
  caso('"tem estacionamento?" → pública pedindo confirmar (regra 20/08)', c5?.decision, 'SEND_PUBLIC_ONLY')
  const c6 = por.get('AUDIT4-c6')
  caso('elogio → curta (≤ 60 chars)', (c6?.suggested_public_reply ?? '').length <= 60 && (c6?.suggested_public_reply ?? '').length > 0, true)
  const c7 = por.get('AUDIT4-c7')
  caso('"preciso ir" → contextual e curta', (c7?.suggested_public_reply ?? '').length > 0, true)
  const c8 = por.get('AUDIT4-c8')
  caso('marcação → reação leve', (c8?.suggested_public_reply ?? '').length <= 60, true)
  const c9 = por.get('AUDIT4-c9')
  caso('"onde fica?" no post B usa SÓ o endereço do B', /auro|664|barra funda/i.test(c9?.suggested_public_reply ?? '') && !/guaimb/i.test(c9?.suggested_public_reply ?? ''), true)

  console.log('\n── 4. destino das ações e do portão no pipeline real ──')
  const { data: acoesGeradas } = await db()
    .from('comment_actions')
    .select('action_type,status,skip_reason,instagram_comments:comment_id(instagram_comment_id)')
  const doTeste = (acoesGeradas ?? []).filter((a) => {
    const c = a.instagram_comments as unknown as { instagram_comment_id: string } | null
    return c?.instagram_comment_id?.startsWith('AUDIT4-')
  })
  // Regra de 20/08: elogio/emoji/marcação e pergunta com fato saem QUEUED
  // (automáticas); HOLD continua PENDING_APPROVAL. Neutraliza na hora as
  // QUEUED sintéticas para o worker não tentar publicar em mídia de teste.
  const publicasAuto = doTeste.filter((a) => a.action_type === 'PUBLIC_REPLY' && a.status === 'QUEUED')
  const publicasHold = doTeste.filter((a) => a.action_type === 'PUBLIC_REPLY' && a.status === 'PENDING_APPROVAL')
  await db().from('comment_actions').update({ status: 'SHADOW', skip_reason: 'teste' }).eq('status', 'QUEUED').like('instagram_user_id', 'AUDIT4-%')
  const dms = doTeste.filter((a) => a.action_type === 'PRIVATE_REPLY')
  caso('públicas automáticas (elogio/emoji/marcação) → QUEUED (>0)', publicasAuto.length > 0, true)
  caso('nenhuma pública em aprovação no teste (tudo automático agora)', publicasHold.length, 0)
  caso('DMs para NOT_FOLLOWING aguardam aprovação (>0)', dms.some((d) => d.status === 'PENDING_APPROVAL'), true)
  caso('nenhuma ação do teste foi ENVIADA', doTeste.some((a) => a.status === 'SENT'), false)

  // limpeza
  const { data: cIds } = await db().from('instagram_comments').select('id').like('instagram_comment_id', 'AUDIT4%')
  const ids = (cIds ?? []).map((x) => x.id)
  if (ids.length) {
    await db().from('comment_actions').delete().in('comment_id', ids)
    await db().from('comment_analyses').delete().in('comment_id', ids)
    await db().from('instagram_comments').delete().in('id', ids)
  }
  await db().from('instagram_users').delete().like('instagram_user_id', 'AUDIT4%')
  await db().from('platform_posts').delete().in('legacy_media_id', [mA!.id, mB!.id])
  await db().from('contents').delete().in('seed_media_id', [mA!.id, mB!.id])
  await db().from('instagram_media').delete().like('instagram_media_id', 'AUDIT4%')
  const { count: sobra } = await db().from('instagram_comments').select('id', { count: 'exact', head: true }).like('instagram_comment_id', 'AUDIT4%')
  caso('limpeza completa', sobra, 0)

  console.log(`\n${falhas === 0 ? '✓ REGRAS DM/CONTEXTO: todos os casos passaram' : `✗ ${falhas} caso(s) falharam`}`)
  process.exit(falhas === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERRO:', e instanceof Error ? e.message : e)
  process.exit(1)
})
