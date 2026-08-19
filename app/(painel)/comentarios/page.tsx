import Link from 'next/link'
import { ComentariosTabela } from '@/components/comentarios-tabela'
import { FilaEnvios, type DadosFila } from '@/components/fila-envios'
import { sessaoAtual } from '@/lib/auth/guarda'
import { db } from '@/lib/db'
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
  searchParams: Promise<{ f?: string; p?: string }>
}) {
  const { f, p } = await searchParams
  const filtro = (ABAS.find((a) => a.chave === f)?.chave ?? 'elegiveis') as Filtro
  const pagina = Math.max(0, Number(p ?? 0) || 0)

  const [linhas, contagens, oportunidade, automacao, sessao, { data: painelRaw }] =
    await Promise.all([
      listarComentarios(filtro, 100, pagina),
      contarPorStatus(),
      resumoOportunidade(),
      getAutomacao(),
      sessaoAtual(),
      db().rpc('painel_envios'),
    ])
  const pe = (Array.isArray(painelRaw) ? painelRaw[0] : painelRaw) as Record<string, number> | null
  const fila: DadosFila = {
    naFila: Number(pe?.na_fila ?? 0),
    aguardandoAprovacao: Number(pe?.aguardando_aprovacao ?? 0),
    enviadasHoje: Number(pe?.enviadas_hoje ?? 0),
    enviadasOntem: Number(pe?.enviadas_ontem ?? 0),
    enviadasTotal: Number(pe?.enviadas_total ?? 0),
    falhasHoje: Number(pe?.falhas_hoje ?? 0),
    pessoasFaltam: Number(pe?.pessoas_faltam ?? 0),
    seguidoresHoje: pe?.seguidores_hoje ?? null,
    seguidoresOntem: pe?.seguidores_ontem ?? null,
  }

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
              pessoas elegíveis agora
              <span className="text-ink-faint">
                {' '}· {oportunidade.comentarios} comentários
                {oportunidade.mencoes > 0 ? ` · ${oportunidade.mencoes} menções` : ''}
              </span>
            </p>
          </div>
          {/* O que saiu da lista, e por quê — resumo discreto, sem poluir. */}
          {oportunidade.removidas + oportunidade.duplicatasColapsadas > 0 ? (
            <details className="max-w-[21rem] text-[0.8125rem] leading-relaxed text-ink-faint">
              <summary className="cursor-pointer">
                {oportunidade.duplicatasColapsadas + oportunidade.removidas} interações removidas
                automaticamente
              </summary>
              <p className="mt-1.5">
                {oportunidade.duplicatasColapsadas} duplicadas (mesma pessoa)
                {oportunidade.removidasDetalhe.dmRecente > 0
                  ? ` · ${oportunidade.removidasDetalhe.dmRecente} com DM nos últimos 60 dias`
                  : ''}
                {oportunidade.removidasDetalhe.jaNaFila > 0
                  ? ` · ${oportunidade.removidasDetalhe.jaNaFila} já na fila esperando seu OK`
                  : ''}
                {oportunidade.removidasDetalhe.jaSegue > 0
                  ? ` · ${oportunidade.removidasDetalhe.jaSegue} já seguem`
                  : ''}
                {oportunidade.removidasDetalhe.blacklist > 0
                  ? ` · ${oportunidade.removidasDetalhe.blacklist} bloqueadas`
                  : ''}
                . Continuam registradas para auditoria — só saem da lista de trabalho.
              </p>
            </details>
          ) : null}
        </section>
      ) : null}

      <FilaEnvios dados={fila} admin={sessao?.papel === 'ADMIN'} />

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
        {linhas.length === 100 ? (
          <div className="mt-4 flex justify-center gap-2">
            {pagina > 0 ? (
              <Link href={`/comentarios?f=${filtro}&p=${pagina - 1}`} className="rounded-full border border-line px-4 py-2 text-[0.8125rem] text-ink-soft hover:border-ink-faint">
                ← Anteriores
              </Link>
            ) : null}
            <Link href={`/comentarios?f=${filtro}&p=${pagina + 1}`} className="rounded-full border border-line px-4 py-2 text-[0.8125rem] text-ink-soft hover:border-ink-faint">
              Carregar mais →
            </Link>
          </div>
        ) : pagina > 0 ? (
          <div className="mt-4 flex justify-center">
            <Link href={`/comentarios?f=${filtro}&p=${pagina - 1}`} className="rounded-full border border-line px-4 py-2 text-[0.8125rem] text-ink-soft hover:border-ink-faint">
              ← Anteriores
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  )
}
