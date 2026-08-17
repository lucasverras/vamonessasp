import { createHmac } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { safeEqual } from '@/lib/crypto'
import { marcarRevogada } from '@/lib/tiktok/auth'

export const dynamic = 'force-dynamic'

/**
 * Webhook do TikTok.
 *
 * Verificação conforme a doc oficial (lida em 17/08/2026): header
 * `TikTok-Signature: t=<timestamp>,s=<assinatura>`, onde a assinatura é
 * HMAC-SHA256 de `${timestamp}.${corpo cru}` com o client secret como chave.
 *
 * Mesmos princípios do webhook da Meta:
 *  - corpo CRU para o HMAC (reserializar quebraria a assinatura);
 *  - requisição não assinada não grava NADA;
 *  - 200 imediato; processamento nunca vira erro HTTP (o TikTok reentrega por
 *    até 72h com backoff — falha nossa não deve virar tempestade de retry);
 *  - dedupe por chave única antes de processar ("at least once delivery").
 *
 * O client secret participa só do HMAC. Nunca é logado nem respondido.
 */

const TOLERANCIA_SEGUNDOS = 5 * 60

function assinaturaValida(raw: string, header: string | null): boolean {
  const secret = process.env.TIKTOK_CLIENT_SECRET
  if (!secret || !header) return false

  // Formato documentado: "t=1615338610,s=abc123..."
  const partes = new Map(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const
    }),
  )
  const t = partes.get('t')
  const s = partes.get('s')
  if (!t || !s) return false

  // Janela de tempo: um payload válido de ontem é um replay, não um evento.
  const idade = Math.abs(Date.now() / 1000 - Number(t))
  if (!Number.isFinite(idade) || idade > TOLERANCIA_SEGUNDOS) return false

  const esperada = createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  return safeEqual(esperada, s)
}

interface EventoTikTok {
  client_key?: string
  event?: string
  create_time?: number
  user_openid?: string
  /** JSON serializado como string, conforme a doc. */
  content?: string
}

export async function POST(request: NextRequest) {
  const raw = await request.text()

  if (!assinaturaValida(raw, request.headers.get('tiktok-signature'))) {
    console.warn('[webhook-tiktok] assinatura inválida — descartado')
    return new NextResponse('assinatura inválida', { status: 401 })
  }

  let payload: EventoTikTok
  try {
    payload = JSON.parse(raw) as EventoTikTok
  } catch {
    return new NextResponse('corpo não é JSON', { status: 400 })
  }

  // Dedupe determinístico: mesmo evento reentregue → mesma chave → colisão no
  // banco → 200 sem reprocessar.
  const dedupeKey = `${payload.event ?? '?'}:${payload.user_openid ?? '?'}:${payload.create_time ?? '?'}`

  const { data: evento, error } = await db()
    .from('tiktok_webhook_events')
    .insert({
      event: payload.event ?? null,
      user_openid: payload.user_openid ?? null,
      payload: payload as never,
      signature_valid: true,
      dedupe_key: dedupeKey,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === '23505' || /duplicate/i.test(error.message)) {
      return NextResponse.json({ ok: true, duplicado: true })
    }
    console.error('[webhook-tiktok] falha ao registrar evento:', error.message)
    return NextResponse.json({ ok: true, registrado: false })
  }

  try {
    if (payload.event === 'authorization.removed' && payload.user_openid) {
      // content é string JSON: {"reason": 0-5}. Ausente ou malformado → null,
      // nunca inventado.
      let reason: number | null = null
      try {
        const c = JSON.parse(payload.content ?? '{}') as { reason?: number }
        if (typeof c.reason === 'number') reason = c.reason
      } catch {
        /* content malformado: segue sem reason */
      }

      await marcarRevogada(payload.user_openid, reason)
      console.log(
        `[webhook-tiktok] autorização removida · open_id ${payload.user_openid.slice(0, 12)}… · reason ${reason ?? '—'}`,
      )
    }
    // Demais eventos (video.upload.failed etc.) ficam registrados para quando
    // houver consumidor. Registrar ≠ fingir que processa.

    await db()
      .from('tiktok_webhook_events')
      .update({ processed_at: new Date().toISOString() })
      .eq('id', evento!.id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    await db()
      .from('tiktok_webhook_events')
      .update({ error: e instanceof Error ? e.message.slice(0, 500) : String(e) })
      .eq('id', evento!.id)
    console.error('[webhook-tiktok] falha ao processar:', e instanceof Error ? e.message : e)
    return NextResponse.json({ ok: true, processado: false })
  }
}

/** O TikTok pode validar a URL com GET; responder 200 evita falso "URL inválida". */
export async function GET() {
  return NextResponse.json({ ok: true, servico: 'webhook-tiktok' })
}
