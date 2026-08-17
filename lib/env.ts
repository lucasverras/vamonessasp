import 'server-only'

/**
 * Acesso validado às variáveis de ambiente do servidor.
 *
 * O import de `server-only` faz o build FALHAR se algum Client Component
 * importar este módulo, mesmo indiretamente. É a garantia estrutural de que
 * META_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY e TOKEN_ENCRYPTION_KEY nunca
 * chegam ao navegador — não depende de ninguém lembrar da regra.
 */

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `Variável de ambiente ausente: ${name}. Veja .env.example e preencha .env.local.`,
    )
  }
  return value
}

export const env = {
  get appUrl() {
    return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  },
  get timezone() {
    return process.env.APP_TIMEZONE ?? 'America/Sao_Paulo'
  },

  // Meta
  get metaAppId() {
    return required('META_APP_ID')
  },
  get metaAppSecret() {
    return required('META_APP_SECRET')
  },
  get metaApiVersion() {
    return process.env.META_API_VERSION ?? 'v26.0'
  },
  get metaScopes() {
    return required('META_SCOPES')
  },
  get webhookVerifyToken() {
    return required('META_WEBHOOK_VERIFY_TOKEN')
  },

  // Supabase
  get supabaseUrl() {
    return required('NEXT_PUBLIC_SUPABASE_URL')
  },
  get supabaseAnonKey() {
    return required('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },

  // Infra
  get cronSecret() {
    return required('CRON_SECRET')
  },
  get tokenEncryptionKey() {
    return required('TOKEN_ENCRYPTION_KEY')
  },
  get allowedEmails() {
    return (process.env.ALLOWED_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  },
} as const

/** URLs cadastradas no App Dashboard da Meta. Precisam bater caractere a caractere. */
export const callbacks = {
  get oauth() {
    return `${env.appUrl}/api/auth/instagram/callback`
  },
  get deauthorize() {
    return `${env.appUrl}/api/auth/instagram/deauthorize`
  },
  get dataDeletion() {
    return `${env.appUrl}/api/auth/instagram/data-deletion`
  },
  get webhook() {
    return `${env.appUrl}/api/webhooks/instagram`
  },
} as const
