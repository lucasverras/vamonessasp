import Link from 'next/link'
import { ComentariosTabela } from '@/components/comentarios-tabela'
import { getAutomacao } from '@/lib/campaigns/create'
import {
  contarPorStatus,
  listarComentarios,
  resumoOportunidade,
  type Filtro,
} from '@/lib/analytics/comentarios'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Comentários' }

const ABAS: Array<{ chave: Filtro; rotulo: string }> = [
  { chave: 'elegiveis', rotulo: 'Elegíveis' },
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'enviados', rotulo: 'Enviados' },
  { chave: 'falharam', rotulo: 'Falharam' },
  { chave: 'expirados', rotulo: 'Expirados' },
]

export default async function Comentarios({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>
}) {
  const { f } = await searchParams
  const filtro = (ABAS.find((a) => a.chave === f)?.chave ?? 'elegiveis') as Filtro

  const [linhas, contagens, oportunidade, automacao] = await Promise.all([
    listarComentarios(filtro),
    contarPorStatus(),
    resumoOportunidade(),
    getAutomacao(),
  ])

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Comentários
        </h1>
        <p className="mt-1 text-sm text-ink-faint">
          Cada pessoa pode receber uma única mensagem, dentro de 7 dias do comentário.
        </p>
      </header>

      {/* A oportunidade em pessoas, não em comentários: quem comentou três vezes
          recebe UMA mensagem, e contar linhas inflaria o número. */}
      {oportunidade.pessoas > 0 ? (
        <section
          className="rise mt-7 flex flex-wrap items-end justify-between gap-5 rounded-card border border-accent/25 bg-accent-wash/40 p-5"
          style={{ animationDelay: '60ms' }}
        >
          <div>
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.1em] text-accent">
              Oportunidade
            </p>
            <p className="tnum mt-1.5 font-display text-[2.5rem] font-semibold leading-none tracking-[-0.04em]">
              {oportunidade.pessoas.toLocaleString('pt-BR')}
            </p>
            <p className="mt-1.5 text-[0.875rem] text-ink-soft">
              pessoas ainda podem receber mensagem
              <span className="text-ink-faint"> · {oportunidade.comentarios} comentários</span>
            </p>
          </div>
          {oportunidade.horasParaExpirar !== null && oportunidade.horasParaExpirar < 48 ? (
            <p className="max-w-[19rem] text-[0.8125rem] leading-relaxed text-warn">
              A janela mais curta fecha em{' '}
              <strong className="font-semibold">
                {oportunidade.horasParaExpirar <= 0 ? 'menos de 1h' : `${oportunidade.horasParaExpirar}h`}
              </strong>
              . Passado o prazo, a Meta recusa o envio definitivamente.
            </p>
          ) : null}
        </section>
      ) : null}

      <nav
        className="rise mt-7 flex gap-1 overflow-x-auto border-b border-line-soft"
        style={{ animationDelay: '110ms' }}
      >
        {ABAS.map((a) => {
          const ativa = a.chave === filtro
          return (
            <Link
              key={a.chave}
              href={`/comentarios?f=${a.chave}`}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors ${
                ativa
                  ? 'border-accent text-ink'
                  : 'border-transparent text-ink-faint hover:text-ink-soft'
              }`}
            >
              {a.rotulo}
              <span className="tnum ml-1.5 text-ink-faint">{contagens[a.chave]}</span>
            </Link>
          )
        })}
      </nav>

      <div className="rise mt-6" style={{ animationDelay: '160ms' }}>
        <ComentariosTabela linhas={linhas} killSwitch={automacao?.kill_switch ?? true} />
      </div>
    </main>
  )
}
