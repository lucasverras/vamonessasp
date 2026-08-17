/**
 * Dados usados nas páginas legais (/privacy, /terms, /data-deletion).
 *
 * Estes documentos são lidos por revisores da Meta durante o App Review e por
 * qualquer pessoa que comentou nos conteúdos do @vamonessa. Nada aqui deve ser
 * inventado: os campos marcados com PENDENTE precisam ser preenchidos por um
 * humano antes de publicar em produção.
 *
 * Enquanto houver PENDENTE, as páginas exibem um aviso visível — é intencional,
 * para impedir que um documento incompleto vá ao ar sem ninguém perceber.
 */

const PENDENTE = 'PENDENTE' as const

export const LEGAL = {
  appName: 'Painel Vamo Nessa',
  brand: 'Vamo Nessa',
  instagramHandle: '@vamonessa',

  /** Razão social ou nome completo do responsável pelo tratamento dos dados. */
  controllerName: `${PENDENTE}: razão social ou nome completo do responsável`,
  /** CNPJ ou CPF do controlador. */
  controllerDocument: `${PENDENTE}: CNPJ ou CPF`,
  /** Cidade/UF do controlador (endereço completo não é obrigatório na página). */
  controllerLocation: `${PENDENTE}: cidade/UF`,
  /** E-mail que receberá pedidos de privacidade e de exclusão de dados. */
  privacyEmail: `${PENDENTE}: e-mail de contato para privacidade`,

  lastUpdatedLabel: '17 de agosto de 2026',
  lastUpdatedISO: '2026-08-17',
} as const

export const LEGAL_ROUTES = [
  { href: '/privacy', label: 'Privacidade' },
  { href: '/terms', label: 'Termos de uso' },
  { href: '/data-deletion', label: 'Exclusão de dados' },
] as const

/** Campos que ainda não foram preenchidos por um humano. */
export function pendingLegalFields(): string[] {
  return Object.entries(LEGAL)
    .filter(([, value]) => typeof value === 'string' && value.startsWith(PENDENTE))
    .map(([key]) => key)
}
