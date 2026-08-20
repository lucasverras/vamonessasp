import { db } from '@/lib/db'
import { getAutomacao } from '@/lib/campaigns/create'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campanhas' }

const ESTADO: Record<string, { rotulo: string; classe: string }> = {
  DRAFT: { rotulo: 'Rascunho', classe: 'bg-surface text-ink-faint' },
  QUEUED: { rotulo: 'Na fila', classe: 'bg-accent-wash text-accent' },
  RUNNING: { rotulo: 'Enviando', classe: 'bg-accent-wash text-accent' },
  PAUSED: { rotulo: 'Pausada', classe: 'bg-warn-wash text-warn' },
  COMPLETED: { rotulo: 'Concluída', classe: 'bg-surface text-ink-soft' },
  FAILED: { rotulo: 'Falhou', classe: 'bg-danger-wash text-danger' },
}

export default async function Campanhas() {
  const [{ data: campanhas }, automacao, { data: orcamento }] = await Promise.all([
    db()
      .from('dm_campaigns')
      .select(
        'id,name,status,message_snapshot,total_recipients,sent_count,failed_count,skipped_count,created_at,started_at,completed_at',
      )
      .order('created_at', { ascending: false })
      .limit(50),
    getAutomacao(),
    db().rpc('orcamento_envio_restante'),
  ])

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            Campanhas
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Cada envio é revalidado no instante de sair, não no da seleção.
          </p>
        </div>
        <dl className="flex gap-6 text-right">
          <div>
            <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-faint">
              Envios livres nesta hora
            </dt>
            <dd className="tnum font-display text-xl font-semibold">{Number(orcamento ?? 0)}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-faint">Envio</dt>
            {/* O badge mentia: mostrava "liberado" com o MODO em OFF — e a
                campanha ficava parada sem explicação. Kill switch e modo são
                condições independentes; o badge mostra a mais restritiva. */}
            <dd
              className={`font-display text-xl font-semibold ${
                automacao?.kill_switch || automacao?.reply_mode !== 'LIVE'
                  ? 'text-warn'
                  : 'text-accent'
              }`}
            >
              {automacao?.kill_switch
                ? 'travado'
                : automacao?.reply_mode === 'LIVE'
                  ? 'liberado'
                  : automacao?.reply_mode === 'APPROVAL_REQUIRED'
                    ? 'modo aprovação'
                    : automacao?.reply_mode === 'DRY_RUN'
                      ? 'dry run'
                      : 'automação OFF'}
            </dd>
          </div>
        </dl>
      </header>

      {campanhas?.length ? (
        <ul className="rise mt-7 space-y-3" style={{ animationDelay: '60ms' }}>
          {campanhas.map((c) => {
            const e = ESTADO[c.status] ?? ESTADO.DRAFT!
            const processados = c.sent_count + c.failed_count + c.skipped_count
            const pct = c.total_recipients
              ? Math.round((processados / c.total_recipients) * 100)
              : 0
            const rodando = c.status === 'RUNNING' || c.status === 'QUEUED'
            return (
              <li key={c.id} className="rounded-card border border-line bg-canvas p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">
                        {c.name}
                      </h2>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${e.classe}`}
                      >
                        {rodando ? (
                          <span className="size-1.5 animate-pulse rounded-full bg-current" />
                        ) : null}
                        {e.rotulo}
                      </span>
                    </div>
                    <p className="tnum mt-0.5 text-[0.75rem] text-ink-faint">
                      {new Date(c.created_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <p className="tnum shrink-0 font-display text-lg font-semibold">
                    {processados}
                    <span className="text-ink-faint">/{c.total_recipients}</span>
                  </p>
                </div>

                <div
                  className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-surface"
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Progresso de ${c.name}`}
                >
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-700"
                    style={{ width: `${pct}%` }}
                  />
                </div>

                <dl className="tnum mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem]">
                  <div className="flex gap-1.5">
                    <dt className="text-ink-faint">enviados</dt>
                    <dd className="font-semibold text-accent">{c.sent_count}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-ink-faint">erros</dt>
                    <dd className={c.failed_count ? 'font-semibold text-danger' : ''}>
                      {c.failed_count}
                    </dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-ink-faint">ignorados</dt>
                    <dd>{c.skipped_count}</dd>
                  </div>
                  <div className="flex gap-1.5">
                    <dt className="text-ink-faint">aguardando</dt>
                    <dd>{Math.max(c.total_recipients - processados, 0)}</dd>
                  </div>
                </dl>

                <p className="mt-3 whitespace-pre-line border-l border-line pl-3 text-[0.8125rem] leading-relaxed text-ink-faint">
                  {c.message_snapshot}
                </p>
              </li>
            )
          })}
        </ul>
      ) : (
        <div className="rise mt-7 rounded-card border border-dashed border-line px-6 py-14 text-center">
          <p className="text-[0.9375rem] font-medium">Nenhuma campanha ainda</p>
          <p className="mx-auto mt-1.5 max-w-sm text-[0.8125rem] leading-relaxed text-ink-faint">
            Selecione pessoas em Comentários e crie a primeira. A mensagem fica congelada na
            campanha, então editar o texto depois nunca altera o que já saiu.
          </p>
        </div>
      )}
    </main>
  )
}
