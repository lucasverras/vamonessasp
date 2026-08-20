// Executor de SQL ad-hoc para verificação e manutenção.
// Uso: node scripts/db.mjs "select 1"
import pg from 'pg'
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL.replace('https://','').replace('.supabase.co','')
// O host direto (db.<ref>) é só IPv6; em redes sem IPv6 usamos o pooler
// da região (IPv4). DB_VIA_POOLER=1 força o pooler.
const direto = { host: `db.${ref}.supabase.co`, user: 'postgres' }
const pooler = { host: 'aws-0-sa-east-1.pooler.supabase.com', user: `postgres.${ref}` }
const alvo = process.env.DB_VIA_POOLER ? pooler : direto
export const client = new pg.Client({
  ...alvo, port: 5432,
  password: process.env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
})
if (process.argv[2]) {
  await client.connect()
  const r = await client.query(process.argv[2])
  console.log(JSON.stringify(r.rows, null, 1))
  await client.end()
}
