import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { META_SCOPES } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Diagnóstico de ambiente e dependências.
 *
 * Responde o ESTADO de cada dependência — nunca valores, prefixos ou tamanhos
 * de segredo. Público de propósito: precisa ser consultável antes de haver
 * acesso ao painel, e é o que denuncia deploy sem configuração em segundos.
 *
 * Estados: OK · DEGRADED · NOT_CONFIGURED · ERROR.
 * TikTok aguardando App Review é NOT_CONFIGURED/AWAITING_APPROVAL — pendência
 * externa não derruba o sistema.
 */

type Estado = 'OK' | 'DEGRADED' | 'NOT_CONFIGURED' | 'ERROR' | 'AWAITING_APPROVAL'

interface Checagem {
  estado: Estado
  detalhe?: string
}

const ENVS_META = [
  'META_APP_ID',
  'META_APP_SECRET',
  'META_TARGET_IG_USER_ID',
  'META_WEBHOOK_VERIFY_TOKEN',
] as const

export async function GET() {
  const checks: Record<string, Checagem> = {}

  // --- Banco: uma query de verdade, não presença de env.
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supaUrl || !supaKey) {
    checks.database = { estado: 'NOT_CONFIGURED', detalhe: 'variáveis do Supabase ausentes' }
  } else {
    try {
      const supa = createClient(supaUrl, supaKey, { auth: { persistSession: false } })
      const { error } = await supa
        .from('automation_settings')
        .select('id', { count: 'exact', head: true })
      checks.database = error
        ? { estado: 'ERROR', detalhe: error.message.slice(0, 120) }
        : { estado: 'OK' }
    } catch (e) {
      checks.database = {
        estado: 'ERROR',
        detalhe: e instanceof Error ? e.message.slice(0, 120) : 'falha',
      }
    }
  }

  // --- Meta: envs + conta conectada no banco.
  const metaFaltando = ENVS_META.filter((n) => !process.env[n])
  if (metaFaltando.length > 0) {
    checks.meta = { estado: 'NOT_CONFIGURED', detalhe: `faltam: ${metaFaltando.join(', ')}` }
  } else if (checks.database?.estado === 'OK') {
    const supa = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } })
    const { data: conta } = await supa
      .from('instagram_accounts')
      .select('connection_status,last_sync_at')
      .limit(1)
      .maybeSingle()
    checks.meta = !conta
      ? { estado: 'DEGRADED', detalhe: 'envs ok, nenhuma conta conectada' }
      : conta.connection_status === 'CONNECTED'
        ? { estado: 'OK' }
        : { estado: 'DEGRADED', detalhe: `conta em ${conta.connection_status}` }
  } else {
    checks.meta = { estado: 'DEGRADED', detalhe: 'envs ok, banco inacessível para confirmar conta' }
  }

  // --- OpenAI: presença. (Chamada de teste custaria dinheiro a cada health.)
  checks.openai = process.env.OPENAI_API_KEY
    ? { estado: 'OK', detalhe: 'PRESENT' }
    : { estado: 'NOT_CONFIGURED', detalhe: 'MISSING — análise de comentários parada' }

  // --- TikTok: aguardando aprovação não é erro.
  checks.tiktok =
    process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET
      ? { estado: 'OK', detalhe: 'credenciais presentes' }
      : { estado: 'AWAITING_APPROVAL', detalhe: 'App Review do TikTok pendente; rotas prontas' }

  // --- Cifra: a chave decodifica para 32 bytes?
  const chave = process.env.TOKEN_ENCRYPTION_KEY
  if (!chave) checks.encryption = { estado: 'NOT_CONFIGURED' }
  else {
    try {
      const raw = Buffer.from(chave, 'base64')
      checks.encryption =
        raw.length === 32
          ? { estado: 'OK' }
          : { estado: 'ERROR', detalhe: `decodifica para ${raw.length} bytes, precisa de 32` }
    } catch {
      checks.encryption = { estado: 'ERROR', detalhe: 'não é base64 válido' }
    }
  }

  // --- Scheduler: o cron rodou nos últimos 15 min? (snapshot é horário; o
  //     worker e a análise são minuto/5min — sync_runs registra todos.)
  if (checks.database?.estado === 'OK') {
    const supa = createClient(supaUrl!, supaKey!, { auth: { persistSession: false } })
    const { data: ultimo } = await supa
      .from('sync_runs')
      .select('started_at')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const idadeMin = ultimo
      ? (Date.now() - new Date(ultimo.started_at).getTime()) / 60_000
      : Infinity
    checks.scheduler =
      idadeMin < 15
        ? { estado: 'OK', detalhe: `último job há ${Math.round(idadeMin)} min` }
        : { estado: 'DEGRADED', detalhe: ultimo ? `último job há ${Math.round(idadeMin)} min` : 'nenhum job registrado' }
  } else {
    checks.scheduler = { estado: 'DEGRADED', detalhe: 'banco inacessível' }
  }

  const estados = Object.values(checks).map((c) => c.estado)
  const geral: Estado = estados.includes('ERROR')
    ? 'ERROR'
    : estados.includes('DEGRADED') || checks.openai.estado === 'NOT_CONFIGURED'
      ? 'DEGRADED'
      : 'OK'

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null
  return NextResponse.json(
    {
      ok: geral === 'OK',
      status: geral,
      checks,
      appUrl,
      oauthRedirectUri: appUrl ? `${appUrl.replace(/\/$/, '')}/api/auth/instagram/callback` : null,
      escopos: META_SCOPES,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
