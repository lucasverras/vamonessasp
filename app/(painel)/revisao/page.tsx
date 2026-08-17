import { AlertTriangle, Bot, Lock, MessageSquare, Send } from 'lucide-react'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Revisão' }

const INTENCAO_ROTULO: Record<string, string> = {
  localizacao: 'Localização',
  preco: 'Preço',
  horario: 'Horário',
  interesse_em_visitar: 'Quer ir',
  elogio: 'Elogio',
  critica: 'Crítica',
  marcacao_de_amigo: 'Marcou amigo',
  duvida: 'Dúvida',
  comentario_generico: 'Genérico',
  spam: 'Spam',
  oportunidade_comercial: 'Comercial',
  situacao_delicada: 'Delicada',
}

const RISCO = {
  NONE: { rotulo: 'sem risco', classe: 'text-ink-faint bg-surface' },
  LOW: { rotulo: 'risco baixo', classe: 'text-ink-soft bg-surface' },
  MEDIUM: { rotulo: 'risco médio', classe: 'text-warn bg-warn-wash' },
  HIGH: { rotulo: 'risco alto', classe: 'text-danger bg-danger-wash' },
} as const

export default async function Revisao() {
  const { data: analises, error } = await db()
    .from('comment_analyses')
    .select(
      'id,intent,intent_confidence,risk_level,risk_reasons,requires_human,suggested_public_reply,suggested_private_reply,cta_strategy,decision,decision_reason,model,prompt_version,tokens_in,tokens_out,latency_ms,error_message,created_at,instagram_comments:comment_id(text,username,eligibility_status)',
    )
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) throw new Error(`Falha ao carregar análises: ${error.message}`)

  const { data: cfg } = await db()
    .from('automation_settings')
    .select('shadow_mode,kill_switch')
    .eq('id', true)
    .single()

  const { count: pendentes } = await db()
    .from('instagram_comments')
    .select('id', { count: 'exact', head: true })
    .eq('analysis_status', 'PENDING')
    .eq('is_from_account', false)

  const custo = (analises ?? []).reduce(
    (s, a) => s + ((a.tokens_in ?? 0) * 5 + (a.tokens_out ?? 0) * 25) / 1_000_000,
    0,
  )

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
            Revisão
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            O que a IA <strong className="font-medium text-ink-soft">teria</strong> respondido.
            Nada foi enviado.
          </p>
        </div>
        <dl className="flex gap-6 text-right">
          <div>
            <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-faint">
              Na fila de análise
            </dt>
            <dd className="tnum font-display text-xl font-semibold">{pendentes ?? 0}</dd>
          </div>
          <div>
            <dt className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-faint">
              Custo destas {analises?.length ?? 0}
            </dt>
            <dd className="tnum font-display text-xl font-semibold">
              US$ {custo.toFixed(2)}
            </dd>
          </div>
        </dl>
      </header>

      {cfg?.shadow_mode ? (
        <p
          className="rise mt-6 flex items-start gap-2.5 rounded-card border border-accent/25 bg-accent-wash/40 px-4 py-3 text-[0.875rem] leading-relaxed"
          style={{ animationDelay: '60ms' }}
        >
          <Lock className="mt-0.5 size-4 shrink-0 text-accent" />
          <span>
            <strong className="font-semibold">Shadow mode ativo.</strong> A IA classifica e escreve,
            mas as ações nascem com status SHADOW — e o worker só processa QUEUED. Não existe
            caminho de código que as envie.
          </span>
        </p>
      ) : null}

      {!analises?.length ? (
        <div className="rise mt-7 rounded-card border border-dashed border-line px-6 py-14 text-center">
          <Bot className="mx-auto size-5 text-ink-faint" />
          <p className="mt-3 text-[0.9375rem] font-medium">Nenhuma análise ainda</p>
          <p className="mx-auto mt-1.5 max-w-md text-[0.8125rem] leading-relaxed text-ink-faint">
            {pendentes
              ? `${pendentes} comentários estão na fila. Falta a ANTHROPIC_API_KEY no ambiente para o job de análise rodar.`
              : 'Sem comentários pendentes de análise.'}
          </p>
        </div>
      ) : (
        <ul className="rise mt-7 space-y-3" style={{ animationDelay: '110ms' }}>
          {analises.map((a) => {
            const c = a.instagram_comments as unknown as {
              text: string | null
              username: string | null
              eligibility_status: string
            } | null
            const risco = RISCO[(a.risk_level ?? 'NONE') as keyof typeof RISCO] ?? RISCO.NONE

            return (
              <li key={a.id} className="rounded-card border border-line bg-canvas p-5">
                {a.error_message ? (
                  <p className="flex items-start gap-2 text-[0.8125rem] text-danger">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    Falha na análise: {a.error_message}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[0.8125rem] font-semibold">@{c?.username ?? '—'}</span>
                  {a.intent ? (
                    <span className="rounded-full bg-surface px-2 py-0.5 text-[0.6875rem] font-medium text-ink-soft">
                      {INTENCAO_ROTULO[a.intent] ?? a.intent}
                      {a.intent_confidence !== null ? (
                        <span className="tnum ml-1 text-ink-faint">
                          {Math.round(Number(a.intent_confidence) * 100)}%
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${risco.classe}`}
                  >
                    {risco.rotulo}
                  </span>
                  {a.requires_human ? (
                    <span className="rounded-full bg-warn-wash px-2 py-0.5 text-[0.6875rem] font-medium text-warn">
                      exige humano
                    </span>
                  ) : null}
                  <span className="tnum ml-auto text-[0.6875rem] text-ink-faint">
                    {a.model} v{a.prompt_version} · {a.latency_ms}ms
                  </span>
                </div>

                <p className="mt-2.5 border-l border-line pl-3 text-[0.875rem] italic leading-relaxed text-ink-soft">
                  {c?.text}
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border border-line-soft bg-surface/50 p-3.5">
                    <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
                      <MessageSquare className="size-3" />
                      resposta pública
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-[0.875rem] leading-relaxed">
                      {a.suggested_public_reply ?? (
                        <span className="text-ink-faint">— nada a responder</span>
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border border-line-soft bg-surface/50 p-3.5">
                    <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-wider text-ink-faint">
                      <Send className="size-3" />
                      mensagem privada
                    </p>
                    <p className="mt-1.5 whitespace-pre-line text-[0.875rem] leading-relaxed">
                      {a.suggested_private_reply ?? (
                        <span className="text-ink-faint">— retido para humano</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* A estratégia do CTA é o que permite julgar se o convite ficou
                    natural ou virou spam — é o critério do produto, não enfeite. */}
                {a.cta_strategy ? (
                  <p className="mt-3 text-[0.75rem] leading-relaxed text-ink-faint">
                    <span className="font-medium text-ink-soft">Como o convite foi construído:</span>{' '}
                    {a.cta_strategy}
                  </p>
                ) : null}

                <p className="mt-2 text-[0.75rem] leading-relaxed text-ink-faint">
                  <span className="font-medium text-ink-soft">Decisão:</span> {a.decision} —{' '}
                  {a.decision_reason}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
