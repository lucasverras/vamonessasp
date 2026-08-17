import { NextResponse } from 'next/server'
import { META_SCOPES } from '@/lib/env'

export const dynamic = 'force-dynamic'

/**
 * Diagnóstico de ambiente.
 *
 * Responde APENAS se cada variável existe — nunca o valor, nem prefixo, nem
 * tamanho. Serve para descobrir em segundos se um deploy subiu sem configuração,
 * em vez de deduzir isso por tentativa e erro.
 *
 * Público de propósito: precisa ser consultável antes de haver acesso ao painel.
 */

const REQUIRED = [
  'PANEL_ACCESS_CODE',
  'META_APP_ID',
  'META_APP_SECRET',
  'META_API_VERSION',
  'META_TARGET_IG_USER_ID',
  'META_WEBHOOK_VERIFY_TOKEN',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'CRON_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  // Entrou depois, e a ausência dela não aparecia aqui: o /api/health dizia
  // "Ambiente completo" enquanto o cron de análise falhava em produção a cada
  // 5 minutos. Um diagnóstico que não cobre a variável nova é um diagnóstico
  // que mente com confiança.
  'OPENAI_API_KEY',
] as const

export async function GET() {
  const present: string[] = []
  const missing: string[] = []

  for (const name of REQUIRED) {
    ;(process.env[name] ? present : missing).push(name)
  }

  // A URL do app precisa bater com o redirect_uri cadastrado na Meta.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? null

  return NextResponse.json(
    {
      ok: missing.length === 0,
      configuradas: present.length,
      total: REQUIRED.length,
      faltando: missing,
      appUrl,
      oauthRedirectUri: appUrl ? `${appUrl.replace(/\/$/, '')}/api/auth/instagram/callback` : null,
      // Escopos não são segredo, e expô-los permite confirmar de fora que o
      // ambiente em execução tem a configuração certa — a variável vive na
      // Vercel, não no repositório, então o código pode estar correto e o
      // deploy rodando com um valor antigo.
      escopos: [...META_SCOPES],
      escoposVemDoCodigo: true,
      dica:
        missing.length > 0
          ? 'Adicione as variáveis na Vercel (Settings → Environment Variables) e REDEPLOY: ' +
            'variáveis novas só valem em deploys criados depois delas.'
          : 'Ambiente completo.',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
