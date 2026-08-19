import 'server-only'
import { db } from '../db'

/**
 * Camada de leitura do painel.
 *
 * Toda agregação acontece aqui, no servidor. Nenhum componente recalcula
 * métrica no navegador — o browser recebe números prontos.
 */

export interface Kpi {
  label: string
  value: number | null
  delta?: number | null
  suffix?: string
  hint?: string
}

const dia = 86_400_000

export async function getOverview(days = 30) {
  const desde = new Date(Date.now() - days * dia).toISOString()
  const anterior = new Date(Date.now() - days * 2 * dia).toISOString()

  const [conta, snapshots, midias, diarios, totaisR] = await Promise.all([
    db()
      .from('instagram_accounts')
      .select('id,username,name,profile_picture_url,followers_count,media_count,last_sync_at')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db()
      .from('account_snapshots')
      .select('followers_count,captured_at')
      .gte('captured_at', anterior)
      .order('captured_at', { ascending: true }),
    db()
      .from('instagram_media')
      .select('id,published_at,published_weekday,published_hour')
      .gte('published_at', desde)
      .is('deleted_at', null),
    db()
      .from('account_daily_insights')
      .select('date,new_followers,is_provisional')
      .gte('date', new Date(Date.now() - days * 2 * dia).toISOString().slice(0, 10))
      .order('date', { ascending: true }),
    // Somatório das métricas (snapshot MAIS RECENTE de cada mídia). Estava
    // FORA do Promise.all — um await sequencial gratuito em toda carga da Home.
    db().rpc('overview_media_totals', { desde_param: desde }),
  ])

  if (totaisR.error) throw new Error(`Falha ao agregar métricas: ${totaisR.error.message}`)
  const totaisRaw = totaisR.data
  // A função é `returns table`, então o PostgREST devolve ARRAY com uma linha.
  // Ler `.views` direto no array devolvia undefined e a Home mostrava "—" para
  // métricas que existiam: 2,4M de views apareciam como indisponíveis.
  const totais = (Array.isArray(totaisRaw) ? totaisRaw[0] : totaisRaw) as {
    views: number | null
    reach: number | null
    shares: number | null
    comments: number | null
  } | null

  const serie = (snapshots.data ?? []).filter((s) => s.captured_at >= desde)
  const primeiro = serie[0]?.followers_count ?? null
  const ultimo = serie.at(-1)?.followers_count ?? conta.data?.followers_count ?? null
  const crescimento = primeiro !== null && ultimo !== null ? ultimo - primeiro : null

  // Fonte alternativa de crescimento: nossa série horária ainda é curta, então
  // o histórico diário da Meta cobre o período anterior à conexão.
  const naJanela = (diarios.data ?? []).filter(
    (d) => !d.is_provisional && d.date >= desde.slice(0, 10),
  )
  const anteriores = (diarios.data ?? []).filter(
    (d) => !d.is_provisional && d.date < desde.slice(0, 10),
  )
  const novosPeriodo = naJanela.reduce((s, d) => s + (d.new_followers ?? 0), 0)
  const novosAnterior = anteriores.reduce((s, d) => s + (d.new_followers ?? 0), 0)

  const posts = midias.data?.length ?? 0

  return {
    conta: conta.data,
    kpis: [
      {
        label: 'Seguidores',
        value: ultimo,
        delta: crescimento,
        hint: crescimento === null ? 'série própria ainda em formação' : undefined,
      },
      {
        label: 'Novos seguidores',
        value: novosPeriodo,
        delta: novosAnterior > 0 ? novosPeriodo - novosAnterior : null,
        hint: 'bruto, sem descontar quem deixou de seguir',
      },
      { label: 'Publicações', value: posts },
      {
        label: 'Frequência',
        value: posts > 0 ? Number(((posts / days) * 7).toFixed(1)) : 0,
        suffix: '/semana',
      },
      { label: 'Views', value: totais?.views ?? null },
      { label: 'Alcance', value: totais?.reach ?? null },
      { label: 'Compartilhamentos', value: totais?.shares ?? null },
      { label: 'Comentários', value: totais?.comments ?? null },
    ] satisfies Kpi[],
    serieDiaria: (diarios.data ?? [])
      .filter((d) => d.date >= desde.slice(0, 10))
      .map((d) => ({
        data: d.date,
        novos: d.new_followers ?? 0,
        provisorio: d.is_provisional,
      })),
    serieSeguidores: serie.map((s) => ({
      t: s.captured_at,
      seguidores: s.followers_count,
    })),
  }
}

export async function getTopContent(limit = 8) {
  const { data, error } = await db().rpc('top_media', { limite: limit })
  if (error) throw new Error(`Falha ao listar conteúdos: ${error.message}`)
  return (data ?? []) as Array<{
    id: string
    caption: string | null
    permalink: string | null
    thumbnail_url: string | null
    media_product_type: string | null
    published_at: string
    views: number | null
    reach: number | null
    shares: number | null
    comments: number | null
    reposts: number | null
    saved: number | null
    likes: number | null
    skip_rate: number | null
    avg_watch_time_ms: number | null
  }>
}

export async function getFunnelToday() {
  const hoje = new Date().toISOString().slice(0, 10)
  const [comentarios, elegiveis, enviadas, precisaDeVoce, aprovadasHoje] = await Promise.all([
    db()
      .from('instagram_comments')
      .select('id', { count: 'exact', head: true })
      .gte('commented_at', `${hoje}T00:00:00Z`),
    db()
      .from('instagram_comments')
      .select('id', { count: 'exact', head: true })
      .eq('eligibility_status', 'ELIGIBLE')
      .gt('eligibility_expires_at', new Date().toISOString()),
    db()
      .from('comment_actions')
      .select('id', { count: 'exact', head: true })
      .eq('action_type', 'PRIVATE_REPLY')
      .eq('status', 'SENT'),
    db()
      .from('comment_actions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'PENDING_APPROVAL'),
    db()
      .from('comment_actions')
      .select('id', { count: 'exact', head: true })
      .gte('approved_at', `${hoje}T00:00:00Z`)
      .not('approved_by', 'is', null),
  ])
  return {
    comentariosHoje: comentarios.count ?? 0,
    elegiveis: elegiveis.count ?? 0,
    enviadas: enviadas.count ?? 0,
    precisaDeVoce: precisaDeVoce.count ?? 0,
    aprovadasHoje: aprovadasHoje.count ?? 0,
  }
}
