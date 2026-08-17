import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Horários' }

const DIAS = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

const CONFIANCA: Record<string, string> = {
  'Dados insuficientes': 'text-danger bg-danger-wash',
  'Baixa confiança': 'text-warn bg-warn-wash',
  'Confiança moderada': 'text-ink-soft bg-surface',
  'Boa amostra': 'text-accent bg-accent-wash',
}

const num = (n: number | null) =>
  n === null ? '—' : Math.round(Number(n)).toLocaleString('pt-BR')

export default async function Horarios() {
  const [{ data: dias, error: e1 }, { data: heat, error: e2 }] = await Promise.all([
    db().rpc('desempenho_por_dia'),
    db().rpc('heatmap_dia_hora'),
  ])
  if (e1) throw new Error(`Falha ao carregar dias: ${e1.message}`)
  if (e2) throw new Error(`Falha ao carregar heatmap: ${e2.message}`)

  type Dia = {
    dia: number
    posts: number
    views_medianas: number | null
    reach_mediano: number | null
    shares_medianos: number | null
    comentarios_medianos: number | null
    confianca: string
  }
  type Celula = { dia: number; hora: number; posts: number; views_medianas: number | null }

  const porDia = (dias ?? []) as Dia[]
  const celulas = (heat ?? []) as Celula[]

  const mapa = new Map(celulas.map((c) => [`${c.dia}-${c.hora}`, c]))
  const maxViews = Math.max(...celulas.map((c) => Number(c.views_medianas ?? 0)), 1)
  // Só mostramos as horas em que de fato houve publicação — 24 colunas quase
  // todas vazias transmitem precisão que não existe.
  const horas = [...new Set(celulas.map((c) => c.hora))].sort((a, b) => a - b)

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Horários
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-faint">
          Tudo aqui é <strong className="font-medium text-ink-soft">mediana</strong>, não média — um
          viral distorce a média e desaparece na mediana. O N de cada linha aparece sempre.
        </p>
      </header>

      <section
        className="rise mt-7 overflow-hidden rounded-card border border-line"
        style={{ animationDelay: '60ms' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-line bg-canvas">
                {['Dia', 'N', 'Views', 'Alcance', 'Shares', 'Coment.', 'Confiança'].map((h, i) => (
                  <th
                    key={h}
                    className={`px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint ${
                      i > 0 && i < 6 ? 'text-right' : ''
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {porDia.map((d) => (
                <tr key={d.dia} className="border-b border-line-soft bg-void/40 last:border-0">
                  <td className="px-4 py-2.5 text-[0.875rem] font-medium">{DIAS[d.dia]}</td>
                  <td className="tnum px-4 py-2.5 text-right text-[0.8125rem] text-ink-faint">
                    {d.posts}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-[0.875rem] font-semibold">
                    {num(d.views_medianas)}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-[0.8125rem]">
                    {num(d.reach_mediano)}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-[0.8125rem]">
                    {num(d.shares_medianos)}
                  </td>
                  <td className="tnum px-4 py-2.5 text-right text-[0.8125rem]">
                    {num(d.comentarios_medianos)}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[0.6875rem] font-medium ${
                        CONFIANCA[d.confianca] ?? 'bg-surface text-ink-faint'
                      }`}
                    >
                      {d.confianca}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rise mt-10" style={{ animationDelay: '110ms' }}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">Dia × hora</h2>
          <p className="text-[0.75rem] text-ink-faint">
            intensidade = views medianas · número = quantos posts naquele slot
          </p>
        </div>

        <div className="overflow-x-auto rounded-card border border-line p-4">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="w-10" />
                {horas.map((h) => (
                  <th
                    key={h}
                    className="tnum px-1 pb-2 text-[0.625rem] font-normal text-ink-faint"
                  >
                    {String(h).padStart(2, '0')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[1, 2, 3, 4, 5, 6, 7].map((dia) => (
                <tr key={dia}>
                  <th className="pr-2 text-right text-[0.6875rem] font-medium text-ink-faint">
                    {DIAS[dia]}
                  </th>
                  {horas.map((h) => {
                    const c = mapa.get(`${dia}-${h}`)
                    const intensidade = c ? Number(c.views_medianas ?? 0) / maxViews : 0
                    return (
                      <td key={h} className="p-0.5">
                        <div
                          title={
                            c
                              ? `${DIAS[dia]} ${h}h · ${c.posts} post(s) · mediana ${num(c.views_medianas)} views`
                              : `${DIAS[dia]} ${h}h · nenhum post`
                          }
                          className="tnum grid size-7 place-items-center rounded text-[0.625rem] font-semibold"
                          style={{
                            backgroundColor: c
                              ? `color-mix(in oklab, var(--color-accent) ${Math.round(
                                  12 + intensidade * 88,
                                )}%, var(--color-surface))`
                              : 'var(--color-line-soft)',
                            color:
                              intensidade > 0.55 ? 'var(--color-void)' : 'var(--color-ink-faint)',
                          }}
                        >
                          {c?.posts ?? ''}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-4 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-faint">
          Um slot escuro com <strong className="text-ink-soft">1 post</strong> não é um bom horário —
          é um post. Só compare slots que tenham amostra parecida, e prefira a tabela acima para
          decidir: ela agrega o dia inteiro e diz o quanto se pode confiar.
        </p>
      </section>
    </main>
  )
}
