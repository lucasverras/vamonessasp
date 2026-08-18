import Link from 'next/link'
import { revalidatePath } from 'next/cache'
import { getConnectedAccount, getLastSyncRuns, syncAccount } from '@/lib/instagram/account'
import { getAutomacao } from '@/lib/campaigns/create'
import { definirCadencia, definirModoAutomacao, definirTemplateDm } from './acoes-automacao'
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
            // O cooldown global foi removido do produto: a regra agora é uma
            // DM por pessoa POR CONTEÚDO, garantida por constraint.
            ['Regra de DM', '1 por pessoa+conteúdo'],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{k}</dt>
              <dd className="tnum mt-0.5 font-display text-base font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Automação de respostas: o modo é a decisão de produto mais importante
          depois do kill switch. DRY_RUN é o default e o estado seguro. */}
      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">
          Automação de respostas
        </h2>
        <p className="mt-1 max-w-lg text-[0.8125rem] leading-relaxed text-ink-faint">
          {automacao?.reply_mode === 'LIVE'
            ? 'LIVE: respostas aprovadas pelas regras saem sozinhas, com atraso humano.'
            : automacao?.reply_mode === 'DRY_RUN'
              ? 'Dry-run: o pipeline inteiro roda — classifica, decide, agenda, valida — e para na beira do envio. Nada é publicado.'
              : 'Desligada: a IA analisa e registra, nada entra na fila sozinho.'}
          {automacao?.automation_started_at
            ? ` Marco de início: ${new Date(automacao.automation_started_at).toLocaleString('pt-BR')} — só comentários depois disso entram no automático.`
            : ' Sem marco de início definido: nada entra no automático ainda.'}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {(['OFF', 'DRY_RUN', 'LIVE'] as const).map((modo) => (
            <form
              key={modo}
              action={async () => {
                'use server'
                await definirModoAutomacao(modo)
              }}
            >
              <button
                type="submit"
                className={`rounded-lg px-4 py-2 text-[0.8125rem] font-semibold transition-transform hover:-translate-y-px ${
                  automacao?.reply_mode === modo
                    ? modo === 'LIVE'
                      ? 'bg-danger text-void'
                      : 'bg-accent text-void'
                    : 'border border-line text-ink-soft'
                }`}
              >
                {modo === 'OFF' ? 'Desligada' : modo === 'DRY_RUN' ? 'Dry-run' : 'LIVE'}
              </button>
            </form>
          ))}
        </div>

        <form
          action={async (form: FormData) => {
            'use server'
            await definirCadencia(form)
          }}
          className="mt-5 grid gap-4 sm:grid-cols-2"
        >
          <label className="block">
            <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              Atraso mínimo (minutos)
            </span>
            <input
              name="delay_min_minutos"
              type="number"
              min={0}
              step={1}
              defaultValue={Math.round((automacao?.delay_min_seconds ?? 180) / 60)}
              className="tnum mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>
          <label className="block">
            <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              Atraso máximo (minutos)
            </span>
            <input
              name="delay_max_minutos"
              type="number"
              min={0}
              step={1}
              defaultValue={Math.round((automacao?.delay_max_seconds ?? 420) / 60)}
              className="tnum mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </label>

          <fieldset className="sm:col-span-2">
            <legend className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              O que pode ser automático
            </legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2">
              {(
                [
                  ['reply_praise', 'Elogios e interesse', automacao?.reply_praise],
                  ['reply_known_questions', 'Perguntas com resposta conhecida', automacao?.reply_known_questions],
                  ['reply_mentions', 'Marcações de amigos', automacao?.reply_mentions],
                ] as const
              ).map(([nome, rotulo, ligado]) => (
                <label key={nome} className="flex items-center gap-2 text-[0.8125rem]">
                  <input
                    type="checkbox"
                    name={nome}
                    defaultChecked={Boolean(ligado)}
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {rotulo}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="sm:col-span-2">
            <button
              type="submit"
              className="rounded-lg bg-surface px-4 py-2 text-[0.8125rem] font-semibold text-ink transition-transform hover:-translate-y-px"
            >
              Salvar cadência
            </button>
          </div>
        </form>

        <p className="mt-4 max-w-lg text-[0.75rem] leading-relaxed text-ink-faint">
          Sempre fora do automático, independente de tudo acima: críticas, situações delicadas,
          oportunidades comerciais, spam e qualquer pergunta cuja resposta não esteja na legenda ou
          no cadastro — esses caem na fila de revisão para você.
        </p>

        {/* Público conversa; a DM pede follow — e o texto dela é ESTE template,
            o mesmo para todos, de propósito. */}
        <form
          action={async (form: FormData) => {
            'use server'
            await definirTemplateDm(form)
          }}
          className="mt-6 border-t border-line-soft pt-5"
        >
          <label className="block">
            <span className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">
              Template da Private Reply (objetivo: follow — nunca usado em resposta pública)
            </span>
            <textarea
              name="dm_template"
              rows={5}
              defaultValue={automacao?.dm_template ?? ''}
              className="mt-1.5 w-full rounded-lg border border-line bg-void px-3 py-2.5 text-[0.875rem] leading-relaxed outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            className="mt-2 rounded-lg bg-surface px-4 py-2 text-[0.8125rem] font-semibold transition-transform hover:-translate-y-px"
          >
            Salvar template
          </button>
        </form>
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
