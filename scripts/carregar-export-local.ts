/**
 * Carrega a lista de seguidores da exportação oficial (arquivos locais
 * followers_*.json — NUNCA vão para o git) em followers_export e cruza os
 * UNKNOWN. Uso: npx tsx --conditions=react-server scripts/carregar-export-local.ts <dir> <data-export YYYY-MM-DD>
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import { extrairUsernames } from '../lib/instagram/importar-seguidores'

async function main() {
  const dir = process.argv[2]
  const data = process.argv[3]
  if (!dir || !data) throw new Error('uso: <dir> <YYYY-MM-DD>')
  const nomes = new Set<string>()
  for (const f of readdirSync(dir).filter((f) => /^followers.*\.json$/i.test(f))) {
    for (const u of extrairUsernames(readFileSync(join(dir, f), 'utf8'))) nomes.add(u)
  }
  console.log('usernames na exportação:', nomes.size)
  const ref = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace('https://', '').replace('.supabase.co', '')
  const c = new pg.Client({ host: 'aws-0-sa-east-1.pooler.supabase.com', port: 5432, user: `postgres.${ref}`, password: process.env.SUPABASE_DB_PASSWORD, database: 'postgres', ssl: { rejectUnauthorized: false } })
  await c.connect()
  await c.query('begin')
  await c.query('delete from followers_export')
  const lista = [...nomes]
  for (let i = 0; i < lista.length; i += 2000) {
    const lote = lista.slice(i, i + 2000)
    const values = lote.map((_, k) => `($${k + 1}, $${lote.length + 1}::timestamptz, 'lucasverras')`).join(',')
    await c.query(`insert into followers_export (username, imported_at, imported_by) values ${values} on conflict (username) do nothing`, [...lote, `${data}T12:00:00-03:00`])
  }
  await c.query('commit')
  const { rows: [tot] } = await c.query('select count(*)::int n, max(imported_at) dt from followers_export')
  console.log('guardados:', tot.n, 'data:', tot.dt)
  const { rows: [r] } = await c.query('select * from classificar_follow_por_export()')
  console.log('classificados agora:', r)
  const { rows: [e] } = await c.query('select count(*)::int n from listar_elegiveis_limpos(1000)')
  console.log('elegíveis agora:', e.n)
  await c.end()
}
main()
