'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Ponto {
  data: string
  novos: number
  provisorio: boolean
}

/**
 * Novos seguidores por dia.
 *
 * Os dias provisórios ficam FORA da linha em vez de virarem zero: a Meta leva
 * até 48h para consolidar o dado, e desenhar esse zero faria o gráfico anunciar
 * uma queda que não existe.
 */
export function GrowthChart({ dados }: { dados: Ponto[] }) {
  const firmes = dados.filter((d) => !d.provisorio)
  const provisorios = dados.length - firmes.length

  if (firmes.length < 2) {
    return (
      <div className="grid h-64 place-items-center rounded-card border border-dashed border-line text-sm text-ink-faint">
        Ainda não há dias suficientes para desenhar a curva.
      </div>
    )
  }

  const fmt = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

  return (
    <>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={firmes} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="fillNovos" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="0"
              stroke="var(--color-line-soft)"
              vertical={false}
            />
            <XAxis
              dataKey="data"
              tickFormatter={fmt}
              tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: 'var(--color-ink-faint)', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={46}
            />
            <Tooltip
              cursor={{ stroke: 'var(--color-line)', strokeWidth: 1 }}
              contentStyle={{
                background: 'var(--color-raised)',
                border: '1px solid var(--color-line)',
                borderRadius: 10,
                fontSize: 12,
                boxShadow: '0 12px 32px -12px rgb(0 0 0 / 0.7)',
              }}
              labelStyle={{ color: 'var(--color-ink-faint)', marginBottom: 2 }}
              itemStyle={{ color: 'var(--color-ink)' }}
              labelFormatter={(v) =>
                new Date(`${v}T12:00:00Z`).toLocaleDateString('pt-BR', {
                  day: '2-digit',
                  month: 'long',
                })
              }
              formatter={(v) => [
                `+${Number(v ?? 0).toLocaleString('pt-BR')}`,
                'novos seguidores',
              ]}
            />
            <Area
              type="monotone"
              dataKey="novos"
              stroke="var(--color-accent)"
              strokeWidth={2}
              fill="url(#fillNovos)"
              activeDot={{ r: 3.5, fill: 'var(--color-accent)', stroke: 'var(--color-void)', strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      {provisorios > 0 ? (
        <p className="mt-3 text-[0.75rem] text-ink-faint">
          {provisorios === 1 ? 'O último dia está' : `Os ${provisorios} últimos dias estão`} fora do
          gráfico: a Meta leva até 48h para consolidar o dado, e exibi-lo agora mostraria uma queda
          que não existe.
        </p>
      ) : null}
    </>
  )
}
