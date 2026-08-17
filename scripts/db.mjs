// Executor de SQL ad-hoc para verificação e manutenção.
// Uso: node scripts/db.mjs "select 1"
import pg from 'pg'
const ref = process.env.NEXT_PUBLIC_SUPABASE_URL.replace('https://','').replace('.supabase.co','')
export const client = new pg.Client({
  host: `db.${ref}.supabase.co`, port: 5432, user: 'postgres',
  password: process.env.SUPABASE_DB_PASSWORD, database: 'postgres',
  ssl: { rejectUnauthorized: false },
})
if (process.argv[2]) {
  await client.connect()
  const r = await client.query(process.argv[2])
  console.log(JSON.stringify(r.rows, null, 1))
  await client.end()
}
