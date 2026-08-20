import Link from 'next/link'
import { ExternalLink, FileText } from 'lucide-react'
import { coletarNumeros, fmtBRL, fmtCompacto, fmtData, fmtInt, listarGerados, rotuloMes } from '@/lib/analytics/media-kit'
import { gerarAction, salvarManualAction } from './acoes'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Media Kit' }

const input =
  'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent'
const label = 'block text-[0.6875rem] uppercase tracking-wider text-ink-faint mb-1'

export default async function MediaKitPage() {
  const [n, gerados] = await Promise.all([coletarNumeros(), listarGerados()])
  const m = n.manual
  const multiplo = n.seguidores && n.ig90.reach ? Math.round(n.ig90.reach / n.seguidores) : null

  return (
    <main className="mx-auto max-w-3xl px-5 py-8 sm:px-8 lg:py-11">
      <h1 className="font-display text-[1.75rem] font-semibold tracking-[-0.03em] sm:text-[2rem]">Media Kit</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Gera o kit com os números de hoje — {rotuloMes(n.geradoEm)} · seguidores de {fmtData(n.seguidoresEm)}.
        Cada geração fica congelada: o kit de hoje nunca muda depois.
      </p>

      {/* O que vai no kit, ao vivo */}
      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">Números de agora</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {[
            ['Seguidores', fmtInt(n.seguidores)],
            ['Alcance 30d', fmtCompacto(n.ig30.reach)],
            ['Alcance 90d', fmtCompacto(n.ig90.reach)],
            ['Novos seg. 90d', `+${fmtInt(n.ig90.novosSeguidores)}`],
            ['Views 30d', fmtCompacto(n.ig30.views)],
            ['Views 90d', fmtCompacto(n.ig90.views)],
            ['Posts 90d', String(n.ig90.posts)],
            ['Alcance ÷ seguidores', multiplo ? `${multiplo}×` : '—'],
          ].map(([l, v]) => (
            <div key={l}>
              <dt className="text-[0.6875rem] uppercase tracking-wider text-ink-faint">{l}</dt>
              <dd className="mt-0.5 tnum font-display text-xl font-semibold tracking-[-0.02em]">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-[0.8125rem] text-ink-faint">
          Cases (top {n.cases.length} por views nos últimos 90 dias):{' '}
          {n.cases.map((c) => c.handle ?? c.titulo.slice(0, 24)).join(' · ') || '—'}
        </p>
      </section>

      {/* Gerar */}
      <section className="mt-6 rounded-card border border-accent/40 bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">Gerar media kit</h2>
        <form action={gerarAction} className="mt-4 grid gap-4 sm:grid-cols-[1fr_180px_auto] sm:items-end">
          <div>
            <label className={label} htmlFor="cliente">Cliente (opcional)</label>
            <input id="cliente" name="cliente" className={input} placeholder="Ex.: Rei do Macarrão" />
          </div>
          <div>
            <label className={label} htmlFor="valor">Valor (R$)</label>
            <input id="valor" name="valor" className={input} inputMode="decimal" defaultValue={m.valor_padrao !== null ? m.valor_padrao.toFixed(2).replace('.', ',') : '600,00'} />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-[0.8125rem] font-semibold text-void transition-transform hover:-translate-y-px"
          >
            <FileText className="size-4" /> Gerar {rotuloMes(n.geradoEm)}
          </button>
        </form>
        <p className="mt-3 text-[0.8125rem] text-ink-faint">
          Abre a versão pronta; lá o botão <strong>Salvar PDF</strong> usa a impressão do navegador (páginas 1080×1920).
        </p>
      </section>

      {/* Valores que a API não dá */}
      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">O que a API não entrega</h2>
        <p className="mt-1 text-[0.8125rem] text-ink-faint">
          Preencha aqui; entra no kit automaticamente. Campo vazio = a seção não aparece (nada inventado).
          {m.updated_at ? ` Última atualização ${fmtData(m.updated_at)}.` : ''}
        </p>
        <form action={salvarManualAction} className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            ['parceiros', 'Parceiros atendidos', m.parceiros],
            ['fb_seguidores', 'Seguidores da Página FB', m.fb_seguidores],
            ['tiktok_seguidores', 'TikTok — seguidores', m.tiktok_seguidores],
            ['tiktok_views_90d', 'TikTok — views 90d', m.tiktok_views_90d],
            ['tiktok_curtidas_90d', 'TikTok — curtidas 90d', m.tiktok_curtidas_90d],
            ['tiktok_compart_90d', 'TikTok — compart. 90d', m.tiktok_compart_90d],
          ].map(([name, l, v]) => (
            <div key={String(name)}>
              <label className={label} htmlFor={String(name)}>{l}</label>
              <input id={String(name)} name={String(name)} className={input} inputMode="numeric" defaultValue={v === null ? '' : String(v)} />
            </div>
          ))}
          <div>
            <label className={label} htmlFor="valor_padrao">Valor padrão (R$)</label>
            <input id="valor_padrao" name="valor_padrao" className={input} inputMode="decimal" defaultValue={m.valor_padrao !== null ? m.valor_padrao.toFixed(2).replace('.', ',') : ''} />
          </div>
          <div>
            <label className={label} htmlFor="whatsapp">WhatsApp</label>
            <input id="whatsapp" name="whatsapp" className={input} defaultValue={m.whatsapp ?? ''} />
          </div>
          <div className="flex items-end">
            <button type="submit" className="rounded-lg border border-line px-3.5 py-2 text-[0.8125rem] font-medium text-ink-soft transition-colors hover:border-ink-faint hover:text-ink">
              Salvar
            </button>
          </div>
        </form>
      </section>

      {/* Histórico */}
      <section className="mt-6 rounded-card border border-line bg-canvas p-5">
        <h2 className="font-display text-[1.0625rem] font-semibold tracking-[-0.01em]">Gerados</h2>
        {gerados.length === 0 ? (
          <p className="mt-2 text-sm text-ink-faint">Nenhum ainda.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line-soft">
            {gerados.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm">
                <span className="font-medium">{g.rotulo}</span>
                <span className="text-ink-soft">{g.cliente ?? 'sem cliente'}</span>
                <span className="tnum text-ink-soft">{fmtBRL(g.valor)}</span>
                <span className="text-[0.75rem] text-ink-faint">{fmtData(g.created_at)}</span>
                <Link href={`/media-kit/${g.id}`} target="_blank" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">
                  abrir <ExternalLink className="size-3.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
