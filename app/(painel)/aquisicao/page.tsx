import Link from 'next/link'
import { db } from '@/lib/db'
import { sessaoAtual } from '@/lib/auth/guarda'
import { BotaoEnviarQualificados } from '@/components/enviar-qualificados'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Aquisição' }

type Vista = 'qualificados' | 'enviados' | 'negados'

const MOTIVO_ROTULO: Record<string, string> = {
  ALREADY_FOLLOWING: 'Já seguem',
  RECENT_PRIVATE_REPLY: 'DM nos últimos 60 dias',
  DUPLICATE_USER: 'Duplicados',
  META_NOT_ELIGIBLE: 'Meta não permite',
  FOLLOW_STATUS_UNKNOWN: 'Follow desconhecido',
  SENSITIVE_INTERACTION: 'Interação sensível',
  BLOCKED_USER: 'Bloqueados',
  OUR_OWN_ACCOUNT: 'Nossa conta',
  EXPIRED: 'Expirados',
  INVALID_IDENTITY: 'Sem identificador',
  ERROR: 'Erro de dados',
}

function relogio(iso: string | null): string {
  if (!iso) return '—'
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (min < 60) return `há ${Math.max(min, 1)} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h}h` : `há ${Math.floor(h / 24)}d`
}

export default async function Aquisicao({
  searchParams,
}: {
  searchParams: Promise<{ v?: string }>
}) {
  const { v } = await searchParams
  const vista = (['qualificados', 'enviados', 'negados'].includes(v ?? '') ? v : 'qualificados') as Vista

  const [{ data: kpisRaw }, { data: motivosRaw }, sessao] = await Promise.all([
    db().rpc('central_aquisicao_kpis'),
    db().rpc('negados_por_motivo'),
    sessaoAtual(),
  ])
  const k = (Array.isArray(kpisRaw) ? kpisRaw[0] : kpisRaw) as Record<string, number> | null
  const motivos = (motivosRaw ?? []) as Array<{ motivo: string; total: number }>

  const { data: listaRaw } =
    vista === 'qualificados'
      ? await db().rpc('oportunidades_dm')
      : vista === 'enviados'
        ? await db().rpc('listar_enviados', { limite: 150 })
        : await db().rpc('listar_negados', { limite: 150 })

  const KPIS = [
    ['Interações', k?.interacoes],
    ['Pessoas únicas', k?.pessoas_unicas],
    ['Qualificados', k?.qualificados],
    ['Enviados', k?.enviados],
    ['Negados', k?.negados],
    ['Aguardando', k?.aguardando],
  ] as const

  return (
    <main className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            Aquisição
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Comentou ou mencionou + não segue + sem DM em 60 dias = qualificado.
          </p>
        </div>
        {vista === 'qualificados' && sessao?.papel === 'ADMIN' && Number(k?.qualificados ?? 0) > 0 ? (
          <BotaoEnviarQualificados total={Number(k?.qualificados ?? 0)} />
        ) : null}
      </header>

      <section
        className="rise mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-6"
        style={{ animationDelay: '50ms' }}
      >
        {KPIS.map(([rotulo, valor]) => (
          <div key={rotulo} className="bg-canvas px-4 py-3.5">
            <p className="text-[0.625rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {rotulo}
            </p>
            <p className="tnum mt-1 font-display text-xl font-semibold tracking-[-0.02em]">
              {Number(valor ?? 0).toLocaleString('pt-BR')}
            </p>
          </div>
        ))}
      </section>

      <nav className="rise mt-6 flex gap-1 border-b border-line-soft" style={{ animationDelay: '80ms' }}>
        {(
          [
            ['qualificados', `Qualificados (${k?.qualificados ?? 0})`],
            ['enviados', `Enviados (${k?.enviados ?? 0})`],
            ['negados', `Negados (${k?.negados ?? 0})`],
          ] as const
        ).map(([chave, rotulo]) => (
          <Link
            key={chave}
            href={`/aquisicao?v=${chave}`}
            className={`-mb-px border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors ${
              vista === chave ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-soft'
            }`}
          >
            {rotulo}
          </Link>
        ))}
      </nav>

      {vista === 'negados' && motivos.length > 0 ? (
        <div className="rise mt-4 flex flex-wrap gap-2" style={{ animationDelay: '100ms' }}>
          {motivos.map((m) => (
            <span key={m.motivo} className="rounded-full bg-surface px-3 py-1 text-[0.75rem]">
              {MOTIVO_ROTULO[m.motivo] ?? m.motivo}:{' '}
              <strong className="tnum">{Number(m.total).toLocaleString('pt-BR')}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <div className="rise mt-5 overflow-hidden rounded-card border border-line" style={{ animationDelay: '120ms' }}>
        {vista === 'qualificados' ? (
          <ListaQualificados linhas={(listaRaw ?? []) as never[]} />
        ) : vista === 'enviados' ? (
          <ListaEnviados linhas={(listaRaw ?? []) as never[]} />
        ) : (
          <ListaNegados linhas={(listaRaw ?? []) as never[]} />
        )}
      </div>
    </main>
  )
}

function Vazio({ texto }: { texto: string }) {
  return <p className="px-6 py-12 text-center text-[0.8125rem] text-ink-faint">{texto}</p>
}

function ListaQualificados({
  linhas,
}: {
  linhas: Array<{
    username: string | null
    origem: string
    ultima_interacao: string
    ultimo_texto: string | null
    ultimo_conteudo: string | null
    follow_status: string | null
  }>
}) {
  if (!linhas.length) return <Vazio texto="Ninguém qualificado neste momento — quando alguém comentar e passar nas regras, aparece aqui." />
  return (
    <ul className="divide-y divide-line-soft">
      {linhas.map((l, i) => (
        <li key={i} className="flex items-center gap-3 px-4 py-3 odd:bg-transparent even:bg-surface/45">
          <div className="min-w-0 flex-1">
            <p className="text-[0.8125rem]">
              <span className="font-semibold">@{l.username ?? '—'}</span>
              <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[0.625rem] uppercase text-ink-faint">
                {l.origem === 'MENTION' ? 'menção' : 'comentário'}
              </span>
              <span className="ml-2 text-[0.6875rem] text-ink-faint">{relogio(l.ultima_interacao)}</span>
            </p>
            <p className="mt-0.5 truncate text-[0.8125rem] italic text-ink-soft">{l.ultimo_texto}</p>
            {l.ultimo_conteudo ? (
              <p className="truncate text-[0.6875rem] text-ink-faint">
                em: {l.ultimo_conteudo.replace(/\s+/g, ' ').slice(0, 70)}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 rounded-full bg-accent-wash px-2 py-0.5 text-[0.625rem] font-semibold text-accent">
            {l.follow_status === 'NOT_FOLLOWING' ? 'não segue' : l.follow_status ?? '—'}
          </span>
        </li>
      ))}
    </ul>
  )
}

function ListaEnviados({
  linhas,
}: {
  linhas: Array<{
    username: string | null
    enviada_em: string
    origem: string
    interacao: string | null
    template: string | null
    meta_status: string
  }>
}) {
  if (!linhas.length) return <Vazio texto="Nenhuma DM enviada ainda." />
  return (
    <ul className="divide-y divide-line-soft">
      {linhas.map((l, i) => (
        <li key={i} className="px-4 py-3 odd:bg-transparent even:bg-surface/45">
          <p className="text-[0.8125rem]">
            <span className="font-semibold">@{l.username ?? '—'}</span>
            <span className="ml-2 text-[0.6875rem] text-ink-faint">{relogio(l.enviada_em)}</span>
            <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-[0.625rem] uppercase text-ink-faint">{l.origem}</span>
            <span className="ml-2 rounded-full bg-accent-wash px-2 py-0.5 text-[0.625rem] font-medium text-accent">{l.meta_status}</span>
          </p>
          {l.interacao ? (
            <p className="mt-0.5 truncate text-[0.75rem] italic text-ink-soft">"{l.interacao}"</p>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

function ListaNegados({
  linhas,
}: {
  linhas: Array<{
    username: string | null
    origem: string
    quando: string
    motivo: string
    ultima_dm: string | null
    follow_status: string | null
    follow_source: string | null
  }>
}) {
  if (!linhas.length) return <Vazio texto="Nenhum negado." />
  return (
    <ul className="divide-y divide-line-soft">
      {linhas.map((l, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 odd:bg-transparent even:bg-surface/45">
          <span className="text-[0.8125rem] font-semibold">@{l.username ?? '—'}</span>
          <span className="rounded-full bg-danger-wash px-2 py-0.5 text-[0.6875rem] font-medium text-danger">
            {MOTIVO_ROTULO[l.motivo] ?? l.motivo}
          </span>
          <span className="text-[0.6875rem] text-ink-faint">{l.origem.toLowerCase()} · {relogio(l.quando)}</span>
          <span className="ml-auto text-[0.6875rem] text-ink-faint">
            {l.follow_status === 'FOLLOWS' ? 'segue' : l.follow_status === 'NOT_FOLLOWING' ? 'não segue' : 'follow ?'}
            {l.follow_source ? ` (${String(l.follow_source).split(':')[0]})` : ''}
            {l.ultima_dm ? ` · última DM ${relogio(l.ultima_dm)}` : ''}
          </span>
        </li>
      ))}
    </ul>
  )
}
