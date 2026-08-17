import 'server-only'

/**
 * Acesso validado às variáveis de ambiente do servidor.
 *
 * O import de `server-only` faz o build FALHAR se algum Client Component
 * importar este módulo, mesmo indiretamente. É a garantia estrutural de que
 * META_APP_SECRET, SUPABASE_SERVICE_ROLE_KEY e TOKEN_ENCRYPTION_KEY nunca
 * chegam ao navegador — não depende de ninguém lembrar da regra.
 */

/** Escopos do OAuth — Instagram API with Facebook Login. */
export const META_SCOPES = [
  'instagram_basic',
  'instagram_manage_insights',
  'instagram_manage_comments',
  'instagram_manage_messages',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_metadata',
] as const

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
  /**
   * Escopos do OAuth. Definidos em CÓDIGO, não em variável de ambiente.
   *
   * Não são segredo e não variam entre ambientes: são uma propriedade da
   * integração, e mudam apenas quando o próprio código muda. Mantê-los em env
   * criou uma classe de falha sem contrapartida — o repositório ficava correto
   * enquanto o deploy rodava com um valor antigo, e o OAuth falhava com
   * "Invalid Scopes" sem que nada no código estivesse errado.
   *
   * São os do Instagram API with Facebook Login. Os instagram_business_*
   * pertencem ao Instagram Login e a Meta rejeita neste fluxo.
   *
   * pages_messaging fica de fora deliberadamente: verificamos que a Private
   * Reply é aceita sem ele, e permissão a mais é justificativa a mais no
   * App Review.
   */
  get metaScopes() {
    return META_SCOPES.join(',')
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

  // TikTok (Login Kit + Display API)
  get tiktokClientKey() {
    return required('TIKTOK_CLIENT_KEY')
  },
  get tiktokClientSecret() {
    return required('TIKTOK_CLIENT_SECRET')
  },
  /**
   * A MESMA string em três lugares: URL de autorização, callback e troca do
   * code por token. O TikTok exige a igualdade caractere a caractere na troca;
   * qualquer divergência falha só em produção, tarde. Por isso existe UM getter
   * e nenhuma rota monta a URI por conta própria.
   */
  get tiktokRedirectUri() {
    return process.env.TIKTOK_REDIRECT_URI ?? `${env.appUrl}/api/auth/tiktok/callback`
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
