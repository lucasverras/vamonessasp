/**
 * Cria ou atualiza um usuário do painel.
 *
 * A senha entra por argumento e vira hash antes de tocar no banco — em nenhum
 * momento ela é gravada, logada ou versionada. Rodar de novo com a mesma pessoa
 * troca a senha, então este script também é o "esqueci minha senha".
 *
 *   npm run script -- scripts/usuarios.ts criar <usuario> <senha> <ADMIN|OPERADOR>
 *   npm run script -- scripts/usuarios.ts listar
 *   npm run script -- scripts/usuarios.ts desativar <usuario>
 */
import { db } from '../lib/db'
import { gerarHash } from '../lib/auth/senha'

async function criar(usuario: string, senha: string, papel: string) {
  const nome = usuario.trim().toLowerCase()
  if (!nome || !senha) throw new Error('uso: criar <usuario> <senha> <ADMIN|OPERADOR>')
  if (papel !== 'ADMIN' && papel !== 'OPERADOR') {
    throw new Error(`papel inválido: "${papel}". Use ADMIN ou OPERADOR.`)
  }

  const { error } = await db()
    .from('panel_users')
    .upsert(
      { username: nome, password_hash: await gerarHash(senha), role: papel, is_active: true },
      { onConflict: 'username' },
    )
  if (error) throw new Error(error.message)

  console.log(`✓ ${nome} · ${papel} · senha definida (${senha.length} caracteres)`)
}

async function listar() {
  const { data, error } = await db()
    .from('panel_users')
    .select('username,role,is_active,last_login_at,created_at')
    .order('created_at')
  if (error) throw new Error(error.message)

  if (!data?.length) return console.log('nenhum usuário cadastrado')
  for (const u of data) {
    const ultimo = u.last_login_at
      ? new Date(u.last_login_at).toLocaleString('pt-BR')
      : 'nunca entrou'
    console.log(
      `  ${u.is_active ? '●' : '○'} ${String(u.username).padEnd(14)} ${String(u.role).padEnd(9)} ${ultimo}`,
    )
  }
}

async function desativar(usuario: string) {
  const { error } = await db()
    .from('panel_users')
    .update({ is_active: false })
    .eq('username', usuario.trim().toLowerCase())
  if (error) throw new Error(error.message)
  console.log(`✓ ${usuario} desativado — não consegue mais entrar`)
}

async function main() {
  const [comando, ...args] = process.argv.slice(2)
  if (comando === 'criar') await criar(args[0] ?? '', args[1] ?? '', args[2] ?? '')
  else if (comando === 'listar') await listar()
  else if (comando === 'desativar') await desativar(args[0] ?? '')
  else console.log('comandos: criar <usuario> <senha> <papel> | listar | desativar <usuario>')
}

main().catch((e) => {
  console.error('falhou:', e instanceof Error ? e.message : e)
  process.exit(1)
})
