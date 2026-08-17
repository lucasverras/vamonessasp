/**
 * Dados usados nas páginas legais (/privacy, /terms, /data-deletion).
 *
 * Estes documentos são lidos por revisores da Meta durante o App Review e por
 * qualquer pessoa que comentou nos conteúdos do @vamonessa. Nada aqui deve ser
 * inventado.
 */

export const LEGAL = {
  appName: 'Painel Vamo Nessa',
  brand: 'Vamo Nessa',
  instagramHandle: '@vamonessa',

  /** E-mail que recebe pedidos de privacidade, oposição e exclusão de dados. */
  privacyEmail: 'spvamonessa@gmail.com',

  lastUpdatedLabel: '17 de agosto de 2026',
  lastUpdatedISO: '2026-08-17',
} as const

export const LEGAL_ROUTES = [
  { href: '/privacy', label: 'Privacidade' },
  { href: '/terms', label: 'Termos de uso' },
  { href: '/data-deletion', label: 'Exclusão de dados' },
] as const
