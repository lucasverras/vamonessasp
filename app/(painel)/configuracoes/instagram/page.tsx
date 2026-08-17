import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { getConnectedAccount, getLastSyncRuns, syncAccount } from '@/lib/instagram/account'
import { getAutomacao } from '@/lib/campaigns/create'
import { alternarKillSwitch } from '../../comentarios/acoes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Instagram' }

const ERROS: Record<string, string> = {
  autorizacao_negada: 'Você cancelou a autorização na tela da Meta.',
  resposta_incompleta: 'A Meta devolveu uma resposta incompleta (sem code ou state).',
  state_invalido: 'Verificação anti-CSRF falhou. Tente conectar novamente a partir desta página.',
  pagina_ambigua: 'Não foi possível identificar com segurança qual Página conectar.',
  erro_da_meta: 'A Meta recusou a requisição.',
  falha_ao_salvar: 'A conexão funcionou, mas falhou ao gravar no banco.',
  erro_inesperado: 'Erro inesperado. Confira os logs do servidor.',
}

function tempo(iso: string | null) {
  if (!iso) return 'nunca'
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'agora mesmo'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  return `há ${Math.floor(h / 24)} dias`
}

export default async function InstagramSettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const account = await getConnectedAccount()
  const runs = await getLastSyncRuns()
  const automacao = await getAutomacao()

  async function sincronizar() {
    'use server'
    await syncAccount('manual')
    revalidatePath('/configuracoes/instagram')
  }

  const conectado = account?.connectionStatus === 'CONNECTED'

  return (
    <main className="mx-auto max-w-2xl px-5 py-8 sm:px-8 lg:py-11">
      <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">Instagram</h1>
      <p className="mt-1 text-sm text-ink-soft">Conexão com a API oficial da Meta.</p>

      {params.erro ? (
        <div className="mt-6 rounded-lg border border-warn/40 bg-warn-wash px-4 py-3 text-sm">
          <p className="font-medium text-ink">{ERROS[params.erro] ?? 'Falha ao conectar.'}</p>
          {params.detalhe ? (
            <p className="mt-1 font-mono text-[0.75rem] leading-relaxed text-warn">
              {params.detalhe}
            </p>
          ) : null}
        </div>
      ) : null}

      {params.conectado ? (
        <div className="mt-6 rounded-lg border border-line bg-surface px-4 py-3 text-sm">
          <span className="font-medium text-ink">@{params.conectado}</span> conectado com sucesso.
        </div>
      ) : null}

      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        {account ? (
          <>
            <div className="flex items-start gap-4">
              {account.profilePictureUrl ? (
                <img
                  src={account.profilePictureUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-full border border-line object-cover"
                />
              ) : (
                <div className="size-12 shrink-0 rounded-full border border-line bg-line-soft" />
              )}
              <div className="min-w-0 flex-1">
                <p className="font-medium">@{account.username}</p>
                <p className="text-sm text-ink-soft">{account.name}</p>
                <p className="mt-1 text-[0.8125rem] text-ink-faint">
                  Página: {account.facebookPageName ?? '—'}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium ${
                  conectado
                    ? 'border-line bg-accent-wash text-accent'
                    : 'border-warn/40 bg-warn-wash text-warn'
                }`}
              >
                {account.connectionStatus}
              </span>
            </div>

            <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {[
                ['Seguidores', account.followersCount?.toLocaleString('pt-BR') ?? '—'],
                ['Conteúdos', account.mediaCount?.toLocaleString('pt-BR') ?? '—'],
                ['Permissões', String(account.scopes.length)],
                ['Token', account.hasToken ? 'cifrado' : 'ausente'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
                    {label}
                  </dt>
                  <dd className="mt-0.5 tnum font-display text-xl font-semibold tracking-[-0.02em]">{value}</dd>
                </div>
              ))}
            </dl>

            <p className="mt-5 text-[0.8125rem] text-ink-faint">
              Última sincronização: {tempo(account.lastSyncAt)}
            </p>

            {account.lastErrorMessage ? (
              <div className="mt-4 rounded-lg border border-warn/40 bg-warn-wash px-3 py-2.5 text-[0.8125rem]">
                <p className="font-medium text-ink">
                  Erro {account.lastErrorCode ?? ''} — {tempo(account.lastErrorAt)}
                </p>
                <p className="mt-0.5 text-warn">{account.lastErrorMessage}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            Nenhuma conta conectada. Clique em Conectar para autorizar pela Meta.
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Link
            href="/api/auth/instagram/start"
            prefetch={false}
            className="rounded-lg bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
          >
            {account ? 'Reautorizar' : 'Conectar Instagram'}
          </Link>
          {account ? (
            <form action={sincronizar}>
              <button
                type="submit"
                className="rounded-lg border border-line px-3.5 py-2 text-[0.8125rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink"
              >
                Sincronizar agora
              </button>
            </form>
          ) : null}
        </div>
      </section>

      {/* Freio de mão. Fica antes do histórico porque é a decisão mais
          consequente desta tela: enquanto ligado, o sistema é incapaz de
          mandar mensagem para qualquer pessoa. */}
      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">
              Envio de mensagens
            </h2>
            <p className="mt-1 max-w-md text-[0.8125rem] leading-relaxed text-ink-faint">
              {automacao?.kill_switch
                ? 'Travado. Campanhas podem ser criadas e a fila é montada, mas nenhuma mensagem sai.'
                : 'Liberado. O worker processa a fila a cada minuto, respeitando o teto por hora.'}
            </p>
          </div>
          <form
            action={async () => {
              'use server'
              await alternarKillSwitch(!automacao?.kill_switch)
            }}
          >
            <button
              type="submit"
              className={`rounded-lg px-4 py-2 text-[0.8125rem] font-semibold transition-transform hover:-translate-y-px ${
                automacao?.kill_switch
                  ? 'bg-accent text-void'
                  : 'border border-danger/50 bg-danger-wash text-danger'
              }`}
            >
              {automacao?.kill_switch ? 'Liberar envio' : 'Travar envio agora'}
            </button>
          </form>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            ['Estado', automacao?.kill_switch ? 'Travado' : 'Liberado'],
            ['Teto por hora', String(automacao?.dm_hourly_cap ?? '—')],
            ['Teto por dia', String(automacao?.dm_daily_cap ?? '—')],
            ['Cooldown', `${automacao?.cooldown_days_per_user ?? '—'} dias`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{k}</dt>
              <dd className="tnum mt-0.5 font-display text-base font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
          Sincronizações recentes
        </h2>
        {runs.length === 0 ? (
          <p className="mt-3 text-sm text-ink-faint">Nenhuma execução registrada ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft rounded-lg border border-line">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5 text-[0.8125rem]">
                <span
                  aria-hidden
                  className={`size-1.5 shrink-0 rounded-full ${
                    r.status === 'SUCCESS'
                      ? 'bg-accent'
                      : r.status === 'RUNNING'
                        ? 'bg-accent'
                        : 'bg-danger'
                  }`}
                />
                <span className="font-mono text-ink-soft">{r.type}</span>
                <span className="text-ink-faint">{r.status}</span>
                <span className="ml-auto shrink-0 text-ink-faint">{tempo(r.started_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
