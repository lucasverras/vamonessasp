import 'server-only'
import { cookies } from 'next/headers'
import { db } from '../db'
import { conferirSenha } from './senha'
import { COOKIE_SESSAO, lerSessao, type Papel, type Sessao } from './sessao'

/**
 * Autoridade de acesso do painel.
 *
 * O middleware barra quem não tem sessão, mas ele NÃO é a garantia: server
 * actions são endpoints HTTP e podem ser chamadas direto. Toda ação sensível
 * chama `exigirAdmin()` aqui. Esconder o botão não protege nada.
 */

export async function sessaoAtual(): Promise<Sessao | null> {
  const jar = await cookies()
  return lerSessao(jar.get(COOKIE_SESSAO)?.value)
}

export async function exigirSessao(): Promise<Sessao> {
  const s = await sessaoAtual()
  if (!s) throw new Error('Sessão expirada. Entre de novo.')
  return s
}

export async function exigirAdmin(acao: string): Promise<Sessao> {
  const s = await exigirSessao()
  if (s.papel !== 'ADMIN') {
    throw new Error(`Apenas administradores podem ${acao}. Você entrou como operador.`)
  }
  return s
}

/** Tentativas erradas antes de travar, e por quanto tempo a janela conta. */
const MAX_TENTATIVAS = 8
const JANELA_MINUTOS = 15

export type ResultadoLogin =
  | { ok: true; usuario: string; papel: Papel }
  | { ok: false; erro: string }

/**
 * Confere usuário e senha.
 *
 * Devolve sempre a MESMA mensagem para usuário inexistente e senha errada: dizer
 * "usuário não existe" entrega metade do segredo a quem está tentando adivinhar.
 */
export async function autenticar(
  usuario: string,
  senha: string,
  ip: string | null,
): Promise<ResultadoLogin> {
  const nome = usuario.trim().toLowerCase()
  if (!nome || !senha) return { ok: false, erro: 'Preencha usuário e senha.' }

  const desde = new Date(Date.now() - JANELA_MINUTOS * 60_000).toISOString()

  // Trava por usuário E por IP: sem a segunda, alguém varre vários usuários a
  // partir da mesma origem sem nunca estourar o limite de nenhum deles.
  const [porUsuario, porIp] = await Promise.all([
    db()
      .from('panel_login_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('username', nome)
      .eq('ok', false)
      .gte('at', desde),
    ip
      ? db()
          .from('panel_login_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip', ip)
          .eq('ok', false)
          .gte('at', desde)
      : Promise.resolve({ count: 0 }),
  ])

  const travado =
    (porUsuario.count ?? 0) >= MAX_TENTATIVAS || (porIp.count ?? 0) >= MAX_TENTATIVAS * 2

  if (travado) {
    await registrar(nome, ip, false)
    return {
      ok: false,
      erro: `Tentativas demais. Espere ${JANELA_MINUTOS} minutos e tente de novo.`,
    }
  }

  const { data: u } = await db()
    .from('panel_users')
    .select('username,password_hash,role,is_active')
    .eq('username', nome)
    .maybeSingle()

  const confere = u?.is_active ? await conferirSenha(senha, u.password_hash as string) : false

  await registrar(nome, ip, confere)

  if (!confere) return { ok: false, erro: 'Usuário ou senha incorretos.' }

  await db()
    .from('panel_users')
    .update({ last_login_at: new Date().toISOString() })
    .eq('username', nome)

  return { ok: true, usuario: u!.username as string, papel: u!.role as Papel }
}

async function registrar(username: string, ip: string | null, ok: boolean) {
  await db().from('panel_login_attempts').insert({ username, ip, ok })
}
