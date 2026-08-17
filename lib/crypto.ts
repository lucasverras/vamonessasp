import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto'
import { env } from './env'

/**
 * Criptografia dos tokens da Meta em repouso.
 *
 * AES-256-GCM. Formato armazenado: nonce(12) || ciphertext || tag(16).
 * GCM é autenticado: adulterar o ciphertext faz a decifragem lançar erro em vez
 * de devolver lixo silenciosamente.
 *
 * ATENÇÃO OPERACIONAL: trocar TOKEN_ENCRYPTION_KEY torna todo token já gravado
 * indecifrável, exigindo reconectar o Instagram. A chave é infraestrutura, não
 * configuração descartável.
 */

const NONCE_BYTES = 12
const TAG_BYTES = 16

function key(): Buffer {
  const raw = Buffer.from(env.tokenEncryptionKey, 'base64')
  if (raw.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY deve decodificar para 32 bytes (AES-256); ` +
        `decodificou para ${raw.length}. Gere com: openssl rand -base64 32`,
    )
  }
  return raw
}

export function encryptToken(plaintext: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), nonce)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()])
}

export function decryptToken(payload: Buffer): string {
  if (payload.length <= NONCE_BYTES + TAG_BYTES) {
    throw new Error('Token criptografado malformado: curto demais.')
  }
  const nonce = payload.subarray(0, NONCE_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const ciphertext = payload.subarray(NONCE_BYTES, payload.length - TAG_BYTES)
  const decipher = createDecipheriv('aes-256-gcm', key(), nonce)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

/**
 * O Supabase devolve `bytea` como string hex prefixada por \x.
 * Converte de volta para Buffer.
 */
export function fromPgBytea(value: string | Buffer | null): Buffer | null {
  if (value === null) return null
  if (Buffer.isBuffer(value)) return value
  return Buffer.from(value.startsWith('\\x') ? value.slice(2) : value, 'hex')
}

/** Serializa um Buffer no formato hex que o Postgres aceita em colunas bytea. */
export function toPgBytea(buffer: Buffer): string {
  return `\\x${buffer.toString('hex')}`
}

/** Comparação em tempo constante, para segredos vindos de requisições. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
