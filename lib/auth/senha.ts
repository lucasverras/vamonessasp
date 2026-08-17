import 'server-only'
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Hash de senha com scrypt.
 *
 * scrypt é deliberadamente caro em CPU e memória: mesmo que o banco vaze, testar
 * senhas fica lento. As senhas em uso aqui são curtas, então esse custo é a
 * principal defesa que temos além da limitação de tentativas.
 */

const scrypt = promisify(scryptCb) as (
  senha: string,
  sal: Buffer,
  tamanho: number,
  opcoes: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

const N = 16_384
const R = 8
const P = 1
const TAMANHO = 32
// scrypt precisa de ~128 * N * r bytes; o padrão do Node (32MB) não cobre.
const MAXMEM = 64 * 1024 * 1024

export async function gerarHash(senha: string): Promise<string> {
  const sal = randomBytes(16)
  const hash = await scrypt(senha, sal, TAMANHO, { N, r: R, p: P, maxmem: MAXMEM })
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`
}

/**
 * Confere a senha. Nunca lança por formato ruim — devolve `false`, porque um
 * erro aqui vazaria a diferença entre "hash malformado" e "senha errada".
 */
export async function conferirSenha(senha: string, armazenado: string): Promise<boolean> {
  try {
    const [algoritmo, n, r, p, salB64, hashB64] = armazenado.split('$')
    if (algoritmo !== 'scrypt' || !n || !r || !p || !salB64 || !hashB64) return false

    const esperado = Buffer.from(hashB64, 'base64')
    const obtido = await scrypt(senha, Buffer.from(salB64, 'base64'), esperado.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAXMEM,
    })
    if (obtido.length !== esperado.length) return false
    return timingSafeEqual(obtido, esperado)
  } catch {
    return false
  }
}
