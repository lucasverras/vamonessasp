import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Frequência' }

const num = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : Math.round(Number(n)).toLocaleString('pt-BR')

export default async function Frequencia() {
  const { data, error } = await db().rpc('frequencia_semanal')
  if (error) throw new Error(`Falha ao carregar frequência: ${error.message}`)

  type Semana = {
    semana: string
    posts: number
    faixa: string
    views_medianas: number | null
    shares_medianos: number | null
    novos_seguidores: number | null
  }
  const semanas = (data ?? []) as Semana[]

  // Agrupa por faixa de frequência. A pergunta é "semanas de 7-9 posts renderam
  // mais que semanas de 3-4?" — e a resposta é uma ASSOCIAÇÃO, não uma causa.
  const FAIXAS = ['1-2', '3-4', '5-6', '7-9', '10+']
  const porFaixa = FAIXAS.map((faixa) => {
    const dela = semanas.filter((s) => s.faixa === faixa)
    const comSeguidores = dela.filter((s) => s.novos_seguidores !== null)
    const mediana = (vals: number[]) => {
      if (vals.length === 0) return null
      const s = [...vals].sort((a, b) => a - b)
      const m = Math.floor(s.length / 2)
      return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
    }
    return {
      faixa,
      semanas: dela.length,
      views: mediana(dela.map((s) => Number(s.views_medianas ?? 0)).filter((v) => v > 0)),
      shares: mediana(dela.map((s) => Number(s.shares_medianos ?? 0)).filter((v) => v > 0)),
      novosPorSemana: mediana(comSeguidores.map((s) => Number(s.novos_seguidores))),
      semanasComSeguidores: comSeguidores.length,
    }
  }).filter((f) => f.semanas > 0)

  const agora = semanas[0]
  const ultimas12 = semanas.slice(0, 12)
  const mediaPorSemana =
    ultimas12.length > 0
      ? ultimas12.reduce((s, x) => s + Number(x.posts), 0) / ultimas12.length
      : 0

  const maiorIntervalo = (() => {
    let maior = 0
    for (let i = 0; i < semanas.length - 1; i++) {
      const atual = new Date(semanas[i]!.semana).getTime()
      const anterior = new Date(semanas[i + 1]!.semana).getTime()
      const gap = Math.round((atual - anterior) / 604_800_000) - 1
      if (gap > maior) maior = gap
    }
    return maior
  })()

  return (
    <main className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 lg:py-11">
      <header className="rise">
        <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">
          Frequência
        </h1>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-faint">
          Quanto você publica, e como as semanas mais cheias se comparam às mais vazias.
        </p>
      </header>

      <section
        className="rise mt-7 grid gap-px overflow-hidden rounded-card border border-line bg-line grid-cols-2 lg:grid-cols-4"
        style={{ animationDelay: '60ms' }}
      >
        {[
          ['Posts nesta semana', String(agora?.posts ?? 0)],
          ['Média por semana', mediaPorSemana.toFixed(1)],
          ['Semanas registradas', String(semanas.length)],
          ['Maior intervalo sem publicar', maiorIntervalo ? `${maiorIntervalo} sem.` : 'nenhum'],
        ].map(([k, v]) => (
          <div key={k} className="bg-canvas px-5 py-4">
            <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {k}
            </p>
            <p className="tnum mt-1.5 font-display text-xl font-semibold tracking-[-0.02em]">{v}</p>
          </div>
        ))}
      </section>

      <section className="rise mt-10" style={{ animationDelay: '110ms' }}>
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
          Semanas agrupadas por quantidade de posts
        </h2>
        <div className="mt-4 overflow-hidden rounded-card border border-line">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  {['Posts/semana', 'Semanas', 'Views medianas', 'Shares medianos', 'Novos seguidores/semana'].map(
                    (h, i) => (
                      <th
                        key={h}
                        className={`px-4 py-2.5 text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-faint ${
                          i > 0 ? 'text-right' : ''
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {porFaixa.map((f) => (
                  <tr key={f.faixa} className="border-b border-line-soft/60 last:border-0 odd:bg-transparent even:bg-surface/45">
                    <td className="px-4 py-2.5 text-[0.875rem] font-medium">{f.faixa}</td>
                    <td className="tnum px-4 py-2.5 text-right text-[0.8125rem] text-ink-faint">
                      {f.semanas}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-[0.875rem] font-semibold">
                      {num(f.views)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-[0.8125rem]">
                      {num(f.shares)}
                    </td>
                    <td className="tnum px-4 py-2.5 text-right text-[0.875rem]">
                      {f.semanasComSeguidores === 0 ? (
                        <span className="text-ink-faint">sem dado</span>
                      ) : (
                        <>
                          {num(f.novosPorSemana)}
                          <span className="ml-1 text-[0.6875rem] font-normal text-ink-faint">
                            (N={f.semanasComSeguidores})
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Aviso obrigatório de leitura: sem ele, a tabela acima convida a
            concluir que publicar mais CAUSA crescimento. */}
        <p className="mt-4 max-w-2xl rounded-card border border-line bg-canvas px-4 py-3 text-[0.8125rem] leading-relaxed text-ink-faint">
          Isto é <strong className="text-ink-soft">associação temporal</strong>, não causa. Semanas
          com mais posts podem ter crescido mais porque você publicou mais — ou porque tinha material
          melhor, ou porque um Reel viralizou e você aproveitou o embalo. A tabela mostra o que
          aconteceu junto; não prova o que causou o quê.
        </p>
      </section>

      <section className="rise mt-10" style={{ animationDelay: '160ms' }}>
        <h2 className="font-display text-lg font-semibold tracking-[-0.02em]">
          Últimas semanas
        </h2>
        <ul className="mt-4 space-y-1.5">
          {ultimas12.map((s) => (
            <li
              key={s.semana}
              className="flex items-center gap-3 rounded-lg border border-line-soft bg-canvas px-3.5 py-2"
            >
              <span className="tnum w-20 shrink-0 text-[0.75rem] text-ink-faint">
                {new Date(s.semana).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: '2-digit',
                })}
              </span>
              <div className="flex min-w-0 flex-1 items-center gap-0.5">
                {Array.from({ length: Math.min(Number(s.posts), 14) }).map((_, i) => (
                  <span key={i} className="h-4 w-2 shrink-0 rounded-sm bg-accent" />
                ))}
                <span className="tnum ml-2 text-[0.75rem] font-semibold">{s.posts}</span>
              </div>
              <span className="tnum shrink-0 text-[0.75rem] text-ink-faint">
                {s.novos_seguidores !== null ? `+${num(s.novos_seguidores)} seg.` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
