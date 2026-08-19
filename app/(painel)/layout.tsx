import Link from 'next/link'
import {
  BarChart3,
  Bot,
  CalendarRange,
  CheckCheck,
  Clock4,
  LayoutGrid,
  MessageSquare,
  Send,
  LogOut,
  Settings,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import { sair } from '@/app/entrar/acoes'
import { sessaoAtual } from '@/lib/auth/guarda'
import { db } from '@/lib/db'
import { getConnectedAccount } from '@/lib/instagram/account'

const NAV = [
  { href: '/', label: 'Visão geral', icon: LayoutGrid },
  { href: '/aquisicao', label: 'Aquisição', icon: Send },
  { href: '/aprovacoes', label: 'Aprovações', icon: CheckCheck },
  { href: '/conteudos', label: 'Conteúdos', icon: BarChart3 },
  { href: '/crescimento', label: 'Crescimento', icon: TrendingUp },
  { href: '/comentarios', label: 'Comentários', icon: MessageSquare },
  { href: '/revisao', label: 'Revisão IA', icon: Bot },
  { href: '/campanhas', label: 'Campanhas', icon: BarChart3 },
  { href: '/horarios', label: 'Horários', icon: Clock4 },
  { href: '/frequencia', label: 'Frequência', icon: CalendarRange },
]

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const [conta, sessao, { count: aguardando }] = await Promise.all([
    getConnectedAccount(),
    sessaoAtual(),
    db().from('comment_actions').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
  ])
  const admin = sessao?.papel === 'ADMIN'

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="sticky top-0 z-30 flex items-center gap-1 border-b border-line-soft bg-canvas/85 px-4 py-2.5 backdrop-blur-xl lg:h-dvh lg:flex-col lg:items-stretch lg:gap-0 lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
        <Link href="/" className="mr-3 flex shrink-0 items-center gap-2.5 lg:mr-0 lg:px-2 lg:pb-6">
          <span className="grid size-7 place-items-center rounded-lg bg-accent font-display text-[0.7rem] font-extrabold text-void">
            VN
          </span>
          <span className="hidden font-display text-[0.9375rem] font-semibold tracking-[-0.02em] lg:block">
            Vamo Nessa
          </span>
        </Link>

        <nav className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto lg:flex-col lg:overflow-visible">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="group flex shrink-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <Icon className="size-4 shrink-0 stroke-[1.75] transition-colors group-hover:text-accent" />
              <span className="whitespace-nowrap">{label}</span>
              {href === '/aprovacoes' && (aguardando ?? 0) > 0 ? (
                <span className="tnum ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[0.625rem] font-bold text-void">
                  {aguardando}
                </span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:block">
          {/* Operador não vê o link porque o middleware o barraria — mostrar um
              caminho que só leva a um redirecionamento é pior que não mostrar. */}
          {admin ? (
            <Link
              href="/configuracoes/instagram"
              className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[0.8125rem] font-medium text-ink-faint transition-colors hover:bg-surface hover:text-ink"
            >
              <Settings className="size-4 stroke-[1.75] transition-colors group-hover:text-accent" />
              Configurações
            </Link>
          ) : null}

          {sessao ? (
            <div className="mt-2 flex items-center gap-2 rounded-xl border border-line-soft bg-surface/60 px-2.5 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.75rem] font-medium">{sessao.usuario}</p>
                <p className="truncate text-[0.6875rem] text-ink-faint">
                  {admin ? 'Acesso total' : 'Operação'}
                </p>
              </div>
              <form action={sair}>
                <button
                  type="submit"
                  aria-label="Sair"
                  title="Sair"
                  className="grid size-7 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-canvas hover:text-danger"
                >
                  <LogOut className="size-3.5 stroke-[1.75]" />
                </button>
              </form>
            </div>
          ) : null}

          {conta ? (
            <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-line-soft bg-surface/60 px-2.5 py-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={conta.profilePictureUrl ?? ''}
                alt=""
                className="size-7 shrink-0 rounded-full object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.75rem] font-medium">@{conta.username}</p>
                <p className="tnum truncate text-[0.6875rem] text-ink-faint">
                  {conta.followersCount?.toLocaleString('pt-BR')} seguidores
                </p>
              </div>
              <span
                aria-label={conta.connectionStatus === 'CONNECTED' ? 'Conectado' : 'Com problema'}
                className={`size-1.5 shrink-0 rounded-full ${
                  conta.connectionStatus === 'CONNECTED' ? 'bg-accent' : 'bg-danger'
                }`}
              />
            </div>
          ) : null}
        </div>

        <Link
          href="/configuracoes/instagram"
          className="ml-auto shrink-0 rounded-lg p-2 text-ink-faint hover:text-ink lg:hidden"
          aria-label="Configurações"
        >
          <Settings className="size-4 stroke-[1.75]" />
        </Link>
      </aside>

      <div className="min-w-0 bg-void">{children}</div>
    </div>
  )
}

export function Placeholder({ titulo }: { titulo: string }) {
  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="max-w-sm">
        <Sparkles className="mx-auto size-5 text-ink-faint" />
        <h1 className="mt-4 font-display text-xl font-semibold tracking-[-0.02em]">{titulo}</h1>
        <p className="mt-2 text-sm text-ink-faint">
          Esta área entra nas próximas etapas. Os dados já estão sendo coletados.
        </p>
      </div>
    </div>
  )
}
