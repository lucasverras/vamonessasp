import { NextResponse, after, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { safeEqual } from '@/lib/crypto'
import { getConnectedAccount } from '@/lib/instagram/account'
import { persistirComentarios } from '@/lib/instagram/comments'
import {
  assinaturaValida,
  campoDoEvento,
  chaveDeDedupe,
  extrairComentarios,
  extrairMencoes,
} from '@/lib/instagram/webhooks'
import { persistirMencoes } from '@/lib/instagram/mentions'
import { extrairComentariosFb, persistirComentariosFb } from '@/lib/facebook/comments'

export const dynamic = 'force-dynamic'

/**
 * Recepção de webhooks da Meta.
 *
 * Autenticado por assinatura HMAC, não pelo portão do painel — a Meta não tem
 * nosso cookie. Nenhuma requisição não assinada grava nada.
 */

/** Handshake de verificação. A Meta espera o challenge em texto puro. */
export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams
  const mode = p.get('hub.mode')
  const token = p.get('hub.verify_token')
  const challenge = p.get('hub.challenge')

  if (mode !== 'subscribe' || !token || !challenge) {
    return new NextResponse('parâmetros de verificação ausentes', { status: 400 })
  }
  if (!safeEqual(token, env.webhookVerifyToken)) {
    return new NextResponse('verify token inválido', { status: 403 })
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
  })
}

export async function POST(request: NextRequest) {
  // Corpo CRU: reserializar o JSON quebraria o HMAC.
  const raw = await request.text()
  const valida = assinaturaValida(raw, request.headers.get('x-hub-signature-256'))

  if (!valida) {
    // Não gravamos nem o payload: aceitar corpo não assinado é aceitar que
    // qualquer um injete comentários falsos no sistema.
    console.warn('[webhook] assinatura inválida — descartado')
    return new NextResponse('assinatura inválida', { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(raw)
  } catch {
    return new NextResponse('corpo não é JSON', { status: 400 })
  }

  const dedupeKey = chaveDeDedupe(payload, raw)

  // Registra o evento cru. A unique em dedupe_key faz a reentrega da Meta
  // colidir aqui, antes de qualquer processamento.
  const { data: evento, error } = await db()
    .from('webhook_events')
    .insert({
      object: (payload as { object?: string }).object ?? null,
      field: campoDoEvento(payload),
      payload: payload as never,
      signature_valid: true,
      dedupe_key: dedupeKey,
    })
    .select('id')
    .maybeSingle()

  // Colisão de dedupe: já processamos este evento. Responder 200 é correto —
  // um erro faria a Meta reentregar em loop.
  if (error) {
    if (error.code === '23505' || error.code === '23000' || /duplicate/i.test(error.message)) {
      return NextResponse.json({ ok: true, duplicado: true })
    }
    console.error('[webhook] falha ao registrar evento', error.message)
    return NextResponse.json({ ok: true, registrado: false })
  }

  try {
    const comentarios = extrairComentarios(payload)
    if (comentarios.length > 0) {
      const conta = await getConnectedAccount()
      if (conta) {
        await persistirComentarios(comentarios, conta.id, conta.instagramUserId)
      }
    }

    // Menções (field oficial `mentions`): nova fonte de oportunidade de DM.
    const mencoes = extrairMencoes(payload)
    if (mencoes.length > 0) {
      await persistirMencoes(mencoes)
    }

    // Comentários da Página do FACEBOOK (object=page, field=feed): entram no
    // fluxo de resposta pública em REVIEW. Sem identidade do autor (Meta
    // oculta `from` sem App Review) → sem DM, por construção.
    const comentariosFb = extrairComentariosFb(payload)
    if (comentariosFb.length > 0) {
      await persistirComentariosFb(comentariosFb)
    }

    await db()
      .from('webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', evento!.id)

    // ANÁLISE INLINE (medido: o cron de 5min custava 164s de MEDIANA de
    // espera; a IA em si leva 3,3s). after() roda DEPOIS do 200 para a Meta —
    // o webhook continua respondendo rápido — e o claim atômico por comentário
    // impede corrida com o cron, que vira a rede de segurança para o que o
    // inline perder.
    if (comentarios.length > 0 || extrairComentariosFb(payload).length > 0) {
      after(async () => {
        try {
          const { analisarPendentes } = await import('@/lib/ai/analise')
          await analisarPendentes(5)
          const { analisarFacebookPendentes } = await import('@/lib/facebook/comments')
          await analisarFacebookPendentes(3)
        } catch (e) {
          console.error('[webhook] análise inline falhou (cron cobre):', e)
        }
      })
    }

    return NextResponse.json({ ok: true, comentarios: comentarios.length })
  } catch (e) {
    // Falha de processamento não vira erro HTTP: o evento está salvo e pode ser
    // reprocessado. Devolver 5xx só faria a Meta reentregar o que já temos.
    await db()
      .from('webhook_events')
      .update({ error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
      .eq('id', evento!.id)
    console.error('[webhook] falha ao processar', e)
    return NextResponse.json({ ok: true, processado: false })
  }
}
