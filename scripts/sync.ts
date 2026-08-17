/** Executa syncs manualmente. Uso: npm run script scripts/sync.ts media|insights|account */
import { syncMedia, syncMediaInsights } from '../lib/instagram/media'
import { syncAccount } from '../lib/instagram/account'
import { backfillDailyInsights } from '../lib/instagram/backfill'

async function main() {
  const what = process.argv[2] ?? 'media'
  const t0 = Date.now()
  if (what === 'media') console.log(JSON.stringify(await syncMedia(), null, 1))
  else if (what === 'insights')
    console.log(JSON.stringify(await syncMediaInsights({ limit: Number(process.argv[3]) || undefined }), null, 1))
  else if (what === 'backfill') console.log(JSON.stringify(await backfillDailyInsights(), null, 1))
  else if (what === 'backfill-historico')
    console.log(JSON.stringify(await backfillDailyInsights(730, {
      token: process.env.META_DEV_ACCESS_TOKEN!,
      host: 'https://graph.instagram.com',
      rotulo: 'Instagram Login (importação única do histórico)',
    }), null, 1))
  else console.log(JSON.stringify(await syncAccount('manual'), null, 1))
  console.log(`levou ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
main().catch((e) => { console.error(e); process.exit(1) })
