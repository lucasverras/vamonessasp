import 'server-only'

/**
 * Classificação dos erros da Meta.
 *
 * A distinção entre permanente e temporário decide se o worker desiste ou tenta
 * de novo. Errar isso significa ou perder envios legítimos, ou martelar a API e
 * estender o bloqueio de rate limit — a documentação da Meta é explícita: ao
 * receber 80002, pausar; insistir aumenta o tempo de bloqueio.
 */

export type ErrorClass = 'PERMANENT' | 'TEMPORARY' | 'TOKEN' | 'RATE_LIMIT'

export interface MetaErrorShape {
  message?: string
  type?: string
  code?: number
  error_subcode?: number
  fbtrace_id?: string
}

export class MetaError extends Error {
  readonly code?: number
  readonly subcode?: number
  readonly httpStatus: number
  readonly traceId?: string
  readonly errorClass: ErrorClass
  readonly endpoint: string

  constructor(httpStatus: number, endpoint: string, raw: MetaErrorShape) {
    super(raw.message ?? `Erro da Meta (HTTP ${httpStatus})`)
    this.name = 'MetaError'
    this.httpStatus = httpStatus
    this.endpoint = endpoint
    this.code = raw.code
    this.subcode = raw.error_subcode
    this.traceId = raw.fbtrace_id
    this.errorClass = classify(httpStatus, raw)
  }

  get retriable(): boolean {
    return this.errorClass === 'TEMPORARY' || this.errorClass === 'RATE_LIMIT'
  }

  /** Seguro para log: não contém token, assinatura nem cabeçalho de autorização. */
  toLog() {
    return {
      endpoint: this.endpoint,
      httpStatus: this.httpStatus,
      code: this.code,
      subcode: this.subcode,
      class: this.errorClass,
      traceId: this.traceId,
      message: this.message,
    }
  }
}

function classify(httpStatus: number, raw: MetaErrorShape): ErrorClass {
  const { code, message = "" } = raw

  // Token inválido, expirado ou revogado → pausar tudo e alertar. Nenhuma
  // tentativa adicional resolve; exige reconectar.
  if (code === 190 || code === 102 || code === 463 || code === 467) return 'TOKEN'

  // Rate limit. 80002 é o da plataforma Instagram; 4, 17 e 32 são de app/usuário.
  if (code === 80002 || code === 4 || code === 17 || code === 32 || code === 613) {
    return 'RATE_LIMIT'
  }
  if (httpStatus === 429) return 'RATE_LIMIT'

  // Falha transitória da própria Meta.
  if (code === 1 || code === 2 || httpStatus >= 500) return 'TEMPORARY'

  // Permissão ausente: repetir não adianta, exige ação humana no App Dashboard.
  if (code === 10 || code === 200 || (code !== undefined && code >= 200 && code <= 299)) {
    return 'PERMANENT'
  }

  // Erros de parâmetro/objeto: comentário apagado, fora da janela de 7 dias, já
  // respondido, destinatário bloqueia mensagens. Todos definitivos.
  if (code === 100) return 'PERMANENT'

  // Mensagens conhecidas que são definitivas mesmo sem código próprio.
  if (/deleted|does not exist|not found|unsupported|no longer available/i.test(message)) {
    return 'PERMANENT'
  }

  return httpStatus >= 400 && httpStatus < 500 ? 'PERMANENT' : 'TEMPORARY'
}

/**
 * Motivo legível para gravar em `comment_actions.skip_reason` /
 * `failure_reason`, em português, para aparecer direto no painel.
 */
export function describeFailure(error: MetaError): string {
  switch (error.errorClass) {
    case 'TOKEN':
      return 'Token do Instagram inválido ou expirado — é necessário reconectar a conta.'
    case 'RATE_LIMIT':
      return 'Limite de uso da API atingido. O envio será retomado automaticamente.'
    case 'TEMPORARY':
      return `Falha temporária da Meta (${error.code ?? error.httpStatus}). Nova tentativa agendada.`
    case 'PERMANENT':
      if (/comment_id/i.test(error.message)) {
        return 'Comentário inválido, apagado ou fora da janela de 7 dias.'
      }
      if (error.code === 10 || error.code === 200) {
        return 'Permissão insuficiente para esta ação no aplicativo da Meta.'
      }
      return error.message
  }
}

/**
 * Erro de POLÍTICA de messaging da Meta (código 10: permissão/policy).
 * Diferente de rate limit ou token: continuar tentando arrisca a conta.
 * Quem detectar isto trava o kill switch automaticamente.
 */
export function ehErroDePolitica(erro: unknown): boolean {
  return erro instanceof MetaError && erro.code === 10
}
