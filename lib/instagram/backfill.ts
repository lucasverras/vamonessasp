import 'server-only'
import { db, startSyncRun } from '../db'
import { getConnectedAccount, getPageToken } from './account'
import { MetaError } from './errors'
import { metaGet } from './meta-client'

/**
 * Backfill do histórico diário da conta.
 *
 * NÃO assumimos quanto histórico existe. Sondamos janelas crescentes e gravamos
 * exatamente o que a API devolver, registrando o limite real observado. Nada é
 * extrapolado nem preenchido por interpolação.
 *
 * SEMÂNTICA (verificada, e fácil de confundir):
 *   `follower_count` = NOVOS seguidores no dia, BRUTO, sem descontar unfollows.
 *   Não é o total da conta. Gravado em new_followers.
 *
 * Os dias mais recentes voltam 0 por atraso de processamento da Meta — marcados
 * com is_provisional para que a interface nunca exiba esse zero como fato.
 */

interface SeriesResponse {
  data: Array<{ name: string; values?: Array<{ value: number; end_time: string }> }>
}

const PROVISIONAL_DAYS = 2
const WINDOW_DAYS = 30 // a API limita o intervalo por consulta

export interface BackfillSource {
  /** Token alternativo. Usado apenas para a importação histórica única. */
  token: string
  host: string
  rotulo: string
}

export async function backfillDailyInsights(maxDays = 730, source?: BackfillSource) {
  const account = await getConnectedAccount()
  if (!account) throw new Error('Nenhuma conta conectada.')

  const run = await startSyncRun('backfill_daily')
  let requests = 0

  try {
    const token = source?.token ?? (await getPageToken(account.id))
    const host = source?.host
    const now = Date.now()
    const byDate = new Map<string, number>()
    let oldestReturned: string | null = null
    let stoppedBecause = 'alcançou o limite solicitado'

    for (let offset = 0; offset < maxDays; offset += WINDOW_DAYS) {
      const until = Math.floor((now - offset * 86400_000) / 1000)
      const since = Math.floor((now - (offset + WINDOW_DAYS) * 86400_000) / 1000)

      let res: SeriesResponse
      try {
        res = await metaGet<SeriesResponse>(`${account.instagramUserId}/insights`, token, {
          metric: 'follower_count',
          period: 'day',
          since,
          until,
        }, undefined, host)
        requests += 1
      } catch (error) {
        // A própria API sinaliza o limite do histórico. Paramos aqui e
        // registramos o motivo, em vez de inventar o que não veio.
        requests += 1
        stoppedBecause =
          error instanceof MetaError
            ? `a API recusou a janela: ${error.message.slice(0, 160)}`
            : 'erro ao consultar a janela'
        break
      }

      const values = res.data?.[0]?.values ?? []
      if (values.length === 0) {
        stoppedBecause = 'a API deixou de retornar dados para janelas mais antigas'
        break
      }

      for (const v of values) {
        const date = v.end_time.slice(0, 10)
        byDate.set(date, v.value)
        if (!oldestReturned || date < oldestReturned) oldestReturned = date
      }
    }

    const cutoff = new Date(now - PROVISIONAL_DAYS * 86400_000).toISOString().slice(0, 10)
    const rows = [...byDate.entries()].map(([date, value]) => ({
      instagram_account_id: account.id,
      date,
      new_followers: value,
      is_provisional: date >= cutoff,
    }))

    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db()
        .from('account_daily_insights')
        .upsert(rows.slice(i, i + 200), { onConflict: 'instagram_account_id,date' })
      if (error) throw new Error(`Falha ao gravar histórico: ${error.message}`)
    }

    await run.finish('SUCCESS', { records: rows.length, requests })

    return {
      dias: rows.length,
      maisAntigo: oldestReturned,
      fonte: source?.rotulo ?? 'Facebook Login (graph.facebook.com)',
      limiteObservado: stoppedBecause,
      provisorios: rows.filter((r) => r.is_provisional).length,
    }
  } catch (error) {
    await run.finish('FAILED', {
      errorCode: error instanceof MetaError ? String(error.code) : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
