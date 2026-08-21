/**
 * Aplica à FILA ATUAL a autorização de 20/08 (Lucas):
 *   - EMOJI / MARCAÇÃO / ELOGIO / PERGUNTA já respondida pela legenda → QUEUED
 *     (sai sozinha), DESDE QUE não tenhamos respondido à mão no Instagram;
 *   - comentário NEGATIVO → descartado (REJECTED + fora da fila humana);
 *   - o resto fica como está (aprovação).
 * "Já respondido" = reply da nossa conta no banco OU na API (/replies, só
 * para comentários de topo). Uso: ... liberar-fila-publica.ts [--aplicar]
 */
import { db } from '../lib/db'
import { publicaPodeSerAutomatica } from '../lib/ai/analise'
import { getConnectedAccount, getPageToken } from '../lib/instagram/account'
import { metaGet } from '../lib/instagram/meta-client'
import { umEmojiSo, validarRespostaPublica } from '../lib/ai/respostas'

const APLICAR = process.argv.includes('--aplicar')
const QUEM = 'regra-auto-20/08'

async function main() {
  const conta = await getConnectedAccount()
  if (!conta) throw new Error('sem conta')
  const token = await getPageToken(conta.id)

  const { data: pend } = await db()
    .from('comment_actions')
    .select('id,comment_id,analysis_id,generated_text,final_text,comment_analyses:analysis_id(intent,sentiment,requires_human,facts_available,facts_missing,decision_reason_code,intent_confidence,risk_level),instagram_comments:comment_id(instagram_comment_id,parent_comment_id,media_id,text)')
    .eq('action_type', 'PUBLIC_REPLY')
    .eq('status', 'PENDING_APPROVAL')
  const itens = (pend ?? []) as unknown as Array<{
    id: string; comment_id: string; analysis_id: string | null; generated_text: string | null; final_text: string | null
    comment_analyses: { intent: string; sentiment: string; requires_human: boolean; facts_available: string[] | null; facts_missing: string[] | null; decision_reason_code: string | null; intent_confidence: number | null; risk_level: string | null } | null
    instagram_comments: { instagram_comment_id: string; parent_comment_id: string | null; media_id: string | null; text: string | null } | null
  }>
  console.log('pendentes públicas:', itens.length)

  const RISCO: Record<string, 'nenhum' | 'baixo' | 'medio' | 'alto'> = { NONE: 'nenhum', LOW: 'baixo', MEDIUM: 'medio', HIGH: 'alto' }
  const r = { liberadas: 0, jaRespondidas: 0, negativas: 0, thread: 0, ficam: 0, invalidas: 0, normalizadas: 0 }
  const FACTUAIS = ['localizacao', 'preco', 'horario', 'duvida']
  const agora = Date.now()
  let ordem = 0

  for (const it of itens) {
    const an = it.comment_analyses, c = it.instagram_comments
    if (!an || !c) { r.ficam++; continue }

    if (an.sentiment === 'negativo') {
      r.negativas++
      if (APLICAR) {
        await db().from('comment_actions').update({ status: 'REJECTED', rejected_by: QUEM, rejected_reason: 'NEGATIVO_DESCARTADO: comentário negativo não recebe resposta (regra 20/08)' }).eq('id', it.id)
        if (it.analysis_id) await db().from('comment_analyses').update({ review_outcome: 'IGNORED', reviewed_by: QUEM, reviewed_at: new Date().toISOString() }).eq('id', it.analysis_id).is('review_outcome', null)
      }
      continue
    }

    // thread: só o comentário principal (regra 20/08)
    if (c.parent_comment_id) {
      r.thread++
      if (APLICAR) await db().from('comment_actions').update({ status: 'REJECTED', rejected_by: QUEM, rejected_reason: 'RESPOSTA_EM_THREAD: só o comentário principal recebe resposta' }).eq('id', it.id)
      continue
    }
    // já respondido pelo perfil vale para TODOS os pendentes (regra 20/08)
    {
      const { count: nb } = await db().from('instagram_comments').select('id', { count: 'exact', head: true }).eq('parent_comment_id', c.instagram_comment_id).eq('is_from_account', true)
      let resp = (nb ?? 0) > 0
      if (!resp) {
        try {
          const rr = (await metaGet<{ data?: Array<{ from?: { id?: string } }> }>(`${c.instagram_comment_id}/replies`, token, { fields: 'id,from', limit: 50 })) as { data?: Array<{ from?: { id?: string } }> }
          resp = (rr.data ?? []).some((x) => x.from?.id === conta.instagramUserId)
        } catch { /* confia no banco */ }
      }
      if (resp) {
        r.jaRespondidas++
        if (APLICAR) await db().from('comment_actions').update({ status: 'REJECTED', rejected_by: QUEM, rejected_reason: 'JA_RESPONDIDO_NO_INSTAGRAM: resposta manual encontrada' }).eq('id', it.id)
        continue
      }
    }
    // um emoji só (regra 20/08) — normaliza o texto antes de qualquer decisão
    const textoOriginal = (it.final_text ?? it.generated_text ?? '').trim()
    const textoNorm = umEmojiSo(textoOriginal) ?? textoOriginal
    if (textoNorm !== textoOriginal) {
      r.normalizadas++
      if (APLICAR) await db().from('comment_actions').update({ generated_text: textoNorm, final_text: it.final_text ? textoNorm : null }).eq('id', it.id)
      it.final_text = it.final_text ? textoNorm : null; it.generated_text = textoNorm
    }
    const factualSemFato = FACTUAIS.includes(an.intent) && an.sentiment !== 'negativo' && an.risk_level !== 'HIGH'
    const auto = factualSemFato || publicaPodeSerAutomatica(
      {
        intencao: an.intent as never,
        sentimento: an.sentiment as never,
        risco: RISCO[an.risk_level ?? 'NONE'] ?? 'nenhum',
        fatos_disponiveis: an.facts_available ?? [],
        fatos_faltando: an.facts_missing ?? [],
        decisao_motivo_codigo: an.decision_reason_code ?? 'OK',
      },
      an.requires_human,
    ) && Number(an.intent_confidence ?? 0) >= 0.85
    if (!auto) { r.ficam++; continue }

    const texto = (it.final_text ?? it.generated_text ?? '').trim() || 'Melhor confirmar diretamente com eles no direct! 🙌'
    if (validarRespostaPublica(texto, [])) { r.invalidas++; continue }
    if (APLICAR && texto !== (it.final_text ?? it.generated_text ?? '').trim()) await db().from('comment_actions').update({ generated_text: texto }).eq('id', it.id)

    r.liberadas++
    if (APLICAR) {
      // escalonado: 1 a cada ~40 s a partir de agora, para não sair tudo num bloco
      const quando = new Date(agora + 60_000 + ordem * 40_000).toISOString(); ordem++
      await db().from('comment_actions').update({ status: 'QUEUED', mode: 'AUTO', approved_by: QUEM, approved_at: new Date().toISOString(), next_attempt_at: quando, skip_reason: null }).eq('id', it.id)
    }
  }

  // HOLDs negativos sem ação (só na fila "Precisa de você"): também saem.
  const { data: holds } = await db().from('comment_analyses').select('id').eq('decision', 'HOLD_FOR_REVIEW').eq('sentiment', 'negativo').is('review_outcome', null)
  console.log('HOLDs negativos na fila humana:', holds?.length ?? 0)
  if (APLICAR && holds?.length) {
    await db().from('comment_analyses').update({ review_outcome: 'IGNORED', reviewed_by: QUEM, reviewed_at: new Date().toISOString() }).in('id', holds.map((h) => h.id))
  }

  console.log(APLICAR ? 'APLICADO:' : 'SIMULAÇÃO (nada alterado):', JSON.stringify(r))
}
main()
