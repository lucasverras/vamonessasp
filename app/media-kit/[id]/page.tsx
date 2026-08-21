import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { Viewport } from 'next'
import { Fustat } from 'next/font/google'
import { BotoesPdf } from '@/components/botoes-pdf'
import { fmtData, fmtInt, getGerado, type CaseMediaKit, type NumerosMediaKit } from '@/lib/analytics/media-kit'

export const dynamic = 'force-dynamic'

/* Celular: a página declara largura de layout fixa (1130 = página 1080 +
 * margens) e o navegador só ESCALA para caber na tela — o kit aparece igual
 * ao desktop, sem refluir texto. Só os botões de exportar interessam ali. */
export const viewport: Viewport = { width: 1130, initialScale: 0.3, minimumScale: 0.1, maximumScale: 3 }

/* Design aprovado no Claude Design (20/08/2026, "Kit Antigo e Formulário"):
 * Fustat, navy #01082D, azul #266CA9, azul-claro #ADE1FB, fundos #EFF7FD /
 * #DDF0FC, 8 páginas 1080×1920. Aqui cada número é substituído pelo snapshot
 * congelado da geração — o layout é o do design, os dados são os do dia. */
const fustat = Fustat({ subsets: ['latin'], display: 'block' })

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const g = await getGerado((await params).id)
  return { title: g ? `Media Kit ${g.rotulo}${g.cliente ? ` · ${g.cliente}` : ''}` : 'Media Kit' }
}

const C = {
  navy: '#01082D', blue: '#266CA9', sky: '#ADE1FB', wash: '#EFF7FD', tint: '#DDF0FC', line: '#C7E4F7',
  text: '#33507A', muted: '#5C7796', mark: '#FFE600',
}

const CSS = `
.mk{background:#2b2d31;padding:24px;display:flex;flex-direction:column;align-items:center;gap:24px;min-height:100dvh;-webkit-font-smoothing:antialiased}
.mk .bar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:space-between;width:min(100%,760px);background:#15171a;color:#e5e7eb;border:1px solid #3a3d44;border-radius:12px;padding:10px 14px;font-size:14px;font-family:var(--font-sans)}
.mk .bar a{color:#9ca3af;text-decoration:underline}
.mk .pg{width:1080px;height:1920px;position:relative;overflow:hidden;box-sizing:border-box;zoom:.42;box-shadow:0 12px 48px rgba(0,0,0,.45);flex:none;display:flex;flex-direction:column;background:#fff}
@media (min-width:1100px){.mk .pg{zoom:.58}}
@media (hover:none) and (pointer:coarse){.mk{padding:16px;gap:16px}.mk .pg{zoom:1}.mk .bar{width:100%;font-size:26px;padding:18px 22px;border-radius:20px}.mk .bar a,.mk .bar button{font-size:26px;padding:14px 22px}.mk .bar svg{width:30px;height:30px}}
.mk .pad{padding:84px 76px}
.mk .head{display:flex;justify-content:space-between;align-items:center}
.mk .brand{display:flex;align-items:center;gap:16px}
.mk .dot{width:18px;height:18px;border-radius:50%;background:${C.blue}}
.mk .brand .w{font-size:38px;font-weight:800;line-height:.9;letter-spacing:-.03em;color:${C.navy}}
.mk .brand .s{font-size:15px;font-weight:500;letter-spacing:.4em;color:${C.muted}}
.mk .pill{font-size:20px;font-weight:600;padding:12px 24px;border-radius:999px;white-space:nowrap}
.mk .title{font-size:80px;font-weight:800;letter-spacing:-.035em;color:${C.navy}}
.mk .stat{border-radius:26px;padding:28px 30px;display:flex;flex-direction:column;gap:6px}
.mk .stat .l{font-size:19px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.mk .stat .v{font-size:56px;font-weight:800;line-height:1.05;letter-spacing:-.02em}
.mk .stat .h{font-size:20px;font-weight:400}
.mk .metric{background:${C.wash};border-radius:28px;padding:26px 34px;display:flex;flex-direction:column;gap:14px}
.mk .metric .g{display:grid;grid-template-columns:1fr 240px 240px;gap:24px;align-items:baseline}
.mk .metric .n{font-size:28px;font-weight:600;color:${C.navy}}
.mk .metric .a{font-size:44px;font-weight:800;color:${C.blue};text-align:right}
.mk .metric .b{font-size:44px;font-weight:800;color:${C.navy};text-align:right}
.mk .track{height:14px;border-radius:999px;background:${C.line};overflow:hidden}
.mk .track div{height:100%;border-radius:999px;background:${C.blue}}
.mk .tile{background:#fff;border-radius:24px;padding:30px 28px;display:flex;flex-direction:column;justify-content:space-between;gap:10px;min-height:132px}
.mk .tile .l{font-size:20px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:${C.muted};white-space:nowrap}
.mk .tile .v{font-size:58px;font-weight:800;line-height:1;color:${C.navy}}
.mk .case{display:grid;grid-template-columns:250px 1fr;gap:30px;background:${C.wash};border-radius:32px;padding:26px}
.mk .case .img{width:250px;border-radius:22px;overflow:hidden;background:${C.tint};display:flex;align-items:center;justify-content:center;color:${C.muted};font-size:20px;text-align:center}
.mk .case .img img{width:100%;height:100%;object-fit:cover;display:block}
.mk .case .bd{display:flex;flex-direction:column;justify-content:center;gap:8px;padding:8px 6px 8px 0;min-width:0}
.mk .case .k{font-size:22px;font-weight:500;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk .case .nm{font-size:52px;font-weight:800;line-height:1;letter-spacing:-.03em;color:${C.navy};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mk .case .big{font-size:88px;font-weight:800;line-height:1.05;letter-spacing:-.035em;color:${C.blue}}
.mk .case .tags{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
.mk .tag{background:${C.tint};color:${C.blue};font-size:22px;font-weight:600;padding:12px 22px;border-radius:999px;white-space:nowrap}
.mk .item{background:#fff;border-radius:28px;padding:30px 32px;display:flex;align-items:center;gap:24px}
.mk .item .ic{flex:none;width:64px;height:64px;border-radius:20px;background:${C.tint};display:flex;align-items:center;justify-content:center}
.mk .item .t{font-size:31px;font-weight:700;line-height:1.2;color:${C.navy}}
.mk .item .d{font-size:24px;font-weight:400;color:${C.muted}}
.mk .contact{display:flex;align-items:center;gap:14px;background:rgba(255,255,255,.08);color:#fff;font-size:26px;font-weight:600;padding:22px 28px;border-radius:24px;text-decoration:none}
@media print{
  body{background:#fff!important}
  .mk{background:#fff;padding:0;gap:0;min-height:0}
  .mk .bar{display:none}
  .mk .pg{zoom:1;box-shadow:none;break-after:page;page-break-after:always}
  .mk .pg:last-of-type{break-after:auto;page-break-after:auto}
  html,body{height:auto;overflow:visible}
  @page{size:1080px 1920px;margin:0}
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
`

const IcoIg = ({ c = '#fff', s = 24 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round"><rect x="3" y="3" width="18" height="18" rx="5.5" /><circle cx="12" cy="12" r="4.2" /><circle cx="17.4" cy="6.6" r="1.1" fill={c} stroke="none" /></svg>
)
const IcoTt = ({ c = '#fff', s = 24 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M14 3.2v11.4a3.9 3.9 0 1 1-3.3-3.85" /><path d="M14 6.1c.9 1.7 2.5 2.7 4.6 2.8" /></svg>
)
const IcoFb = ({ c = '#fff', s = 24 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M14.8 8.2h-1.6c-1 0-1.6.6-1.6 1.6v1.5m-1.9 0h5.1m-3.2 0v7.4" /></svg>
)
const IcoWa = ({ c = '#fff', s = 28 }: { c?: string; s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.5L3.5 20.5l1.4-4.3A8.5 8.5 0 1 1 20.5 11.7z" /><path d="M9 9.3c.3 2.6 2.6 4.9 5.2 5.4l1-1.4 1.8.8c-.3 1-1.3 1.6-2.4 1.4-3-.5-5.5-3-6-6-.2-1.1.4-2.1 1.4-2.4l.8 1.8-1.8 1.4z" /></svg>
)

function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className="brand">
      <div className="dot" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div className="w" style={light ? { color: '#fff' } : undefined}>VAMO NESSA</div>
        <div className="s" style={light ? { color: C.sky } : undefined}>SÃO PAULO</div>
      </div>
    </div>
  )
}

function Head({ pill, light = false, tint = C.tint, color = C.blue }: { pill: string; light?: boolean; tint?: string; color?: string }) {
  return (
    <div className="head">
      <Brand light={light} />
      <div className="pill" style={{ background: tint, color }}>{pill}</div>
    </div>
  )
}

/** Números EXATOS, iguais aos do painel (pedido de 20/08: "bata os números
 *  certinho com os nossos"). Mantido o nome arred por compatibilidade. */
function arred(n: number | null | undefined): string {
  return fmtInt(n)
}
const pct = (a: number | null, b: number | null) => (a && b ? Math.max(4, Math.min(100, Math.round((a / b) * 100))) : 0)

function nomeCase(c: CaseMediaKit): string {
  // Snapshots antigos (antes do campo nome) caem no @ humanizado.
  if (c.nome) return c.nome
  const h = c.handle ?? ''
  if (h.startsWith('@')) return h.slice(1).replace(/[._]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
  return h || 'Vamo Nessa'
}
function legendaCase(c: CaseMediaKit): string {
  const data = new Date(c.data).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
  if (c.legenda) return `${data} · ${c.legenda}`
  const t = c.titulo.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/@[\w.]+/g, '').replace(/\s+/g, ' ').trim()
  const trecho = t.split(/[!?.:]/)[0]?.trim().toLowerCase() ?? ''
  return `${data}${trecho ? ` · ${trecho.slice(0, 42)}` : ''}`
}

function Case({ c }: { c: CaseMediaKit }) {
  const total = (c.ig_views ?? 0) + (c.fb_views ?? 0)
  const tags: string[] = []
  if (c.ig_reach) tags.push(`${arred(c.ig_reach)} contas alcançadas`)
  if ((c.ig_shares ?? 0) >= (c.ig_likes ?? 0) / 2 && c.ig_shares) tags.push(`${arred(c.ig_shares)} compartilhamentos`)
  else if (c.ig_likes) tags.push(`${arred(c.ig_likes)} curtidas`)
  return (
    <div className="case" style={{ flex: 1, minHeight: 0 }}>
      <div className="img">
        {/* CDN da Meta, URL expira — sem otimizador do Next de propósito */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <span>Thumb do reel</span>}
      </div>
      <div className="bd">
        <div className="k">{legendaCase(c)}</div>
        <div className="nm">{nomeCase(c)}</div>
        <div className="big">{arred(total)}</div>
        <div className="k" style={{ marginTop: -6 }}>
          {c.fb_views ? `visualizações · Instagram ${arred(c.ig_views)} + Facebook ${arred(c.fb_views)}` : 'visualizações no Instagram'}
        </div>
        <div className="tags">{tags.slice(0, 2).map((t) => <div className="tag" key={t}>{t}</div>)}</div>
      </div>
    </div>
  )
}

export default async function MediaKitGerado({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const modoPdf = (await searchParams).pdf === '1'
  const g = await getGerado((await params).id)
  if (!g) notFound()
  const n: NumerosMediaKit = g.numeros
  const m = n.manual
  const rotulo = g.rotulo
  const mesMin = rotulo.toLowerCase().replace(' ', '/')
  const ano = new Date(n.geradoEm).getFullYear()

  // No PDF do servidor, versões reduzidas das fotos (arquivo leve para WhatsApp).
  const sufixo = modoPdf ? '-pdf' : ''
  const capa = m.foto_capa_url ?? (existsSync(join(process.cwd(), `public/media-kit/capa${sufixo}.jpg`)) ? `/media-kit/capa${sufixo}.jpg` : null)
  const dupla = m.foto_dupla_url ?? (existsSync(join(process.cwd(), `public/media-kit/dupla${sufixo}.jpg`)) ? `/media-kit/dupla${sufixo}.jpg` : capa)

  const seg3 = (n.seguidores ?? 0) + (m.tiktok_seguidores ?? 0) + (m.fb_seguidores ?? 0)
  const multiplo90 = n.seguidores && n.ig90.reach ? Math.round(n.ig90.reach / n.seguidores) : null
  const multiplo30 = n.seguidores && n.ig30.reach ? Math.round(n.ig30.reach / n.seguidores) : null
  const ritmo = n.ig30.reach && n.ig90.reach ? Math.round((n.ig30.reach / n.ig90.reach) * 100) : null
  const temTikTok = m.tiktok_seguidores !== null || m.tiktok_curtidas_total !== null || m.tiktok_views_7d !== null
  const redes = temTikTok ? 'Instagram, TikTok e Facebook' : 'Instagram e Facebook'
  const casesA = n.cases.slice(0, 3)
  const casesB = n.cases.slice(3, 5)
  const fbCases = n.cases.filter((c) => (c.fb_views ?? 0) > 0).sort((a, b) => (b.fb_views ?? 0) - (a.fb_views ?? 0)).slice(0, 4)
  const wa = (m.whatsapp ?? '').replace(/\D/g, '')
  const waHref = wa ? `https://wa.me/55${wa}` : undefined

  // [nome, 30d, 90d, sinal +, exato (sem arredondar)]
  const metricas: Array<[string, number | null, number | null, boolean, boolean?]> = [
    ['visualizações', n.ig30.views, n.ig90.views, false],
    ['contas alcançadas', n.ig30.reach, n.ig90.reach, false],
    ['compartilhamentos', n.ig30.shares, n.ig90.shares, false],
    ['salvamentos', n.ig30.saved, n.ig90.saved, false],
    ['novos seguidores', n.ig30.novosSeguidores, n.ig90.novosSeguidores, true, true],
  ]

  return (
    <div className={`mk ${fustat.className}`}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {modoPdf ? null : (
        <div className="bar">
          <span>
            Media Kit <b>{rotulo}</b>{g.cliente ? ` · ${g.cliente}` : ''} · gerado {fmtData(g.created_at)} · <Link href="/media-kit">voltar</Link>
          </span>
          <BotoesPdf id={g.id} nome={`Media Kit ${rotulo}${g.cliente ? ` - ${g.cliente}` : ''}`} />
        </div>
      )}

      {/* 01 Capa */}
      <section className="pg" style={{ background: C.navy }}>
        {capa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capa} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 28%' }} />
        ) : null}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg,rgba(1,8,45,.80) 0%,rgba(1,8,45,.14) 34%,rgba(1,8,45,.62) 68%,rgba(1,8,45,.96) 100%)' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: '84px 76px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <div style={{ width: 22, height: 22, borderRadius: '50%', background: C.blue }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ fontSize: 70, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-.03em', color: '#fff' }}>VAMO NESSA</div>
              <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: '.4em', color: C.sky }}>SÃO PAULO</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ background: C.blue, color: '#fff', fontSize: 28, fontWeight: 700, letterSpacing: '.06em', padding: '14px 30px', borderRadius: 999 }}>MEDIA KIT {ano}</div>
              <div style={{ background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 28, fontWeight: 600, letterSpacing: '.04em', padding: '14px 30px', borderRadius: 999 }}>{mesMin}</div>
              {g.cliente ? <div style={{ background: '#fff', color: C.navy, fontSize: 28, fontWeight: 700, padding: '14px 30px', borderRadius: 999 }}>para {g.cliente}</div> : null}
            </div>
            <div style={{ fontSize: 132, fontWeight: 800, lineHeight: 0.9, letterSpacing: '-.035em', color: '#fff', textWrap: 'balance' }}>Mostramos experiências em São Paulo.</div>
            <div style={{ fontSize: 34, fontWeight: 500, lineHeight: 1.25, color: C.sky, maxWidth: 900 }}>e fazemos quem está assistindo ter vontade de conhecer.</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              {[[<IcoIg key="i" />, `@${n.username}`], [<IcoTt key="t" />, `@${n.username}`], [<IcoFb key="f" />, 'Vamo Nessa SP']].map(([ic, t], i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(255,255,255,.1)', border: '2px solid rgba(173,225,251,.4)', color: '#fff', fontSize: 23, fontWeight: 600, padding: '13px 22px', borderRadius: 999, whiteSpace: 'nowrap' }}>{ic}{t}</div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* 02 Quem somos */}
      <section className="pg pad" style={{ background: C.wash, justifyContent: 'space-between', gap: 44 }}>
        <Head pill={`@${n.username}`} />
        <div style={{ borderRadius: 36, overflow: 'hidden', height: 520, background: C.tint, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 24 }}>
          {dupla ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dupla} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : 'Foto horizontal da dupla à mesa'}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1, letterSpacing: '-.035em', color: C.navy, textWrap: 'balance' }}>Dois amigos comendo em São Paulo. Todo dia um lugar novo.</div>
          <div style={{ fontSize: 30, lineHeight: 1.4, color: C.text, maxWidth: 820 }}>A gente visita, grava, narra e posta no {redes}. Quem vê, vai.</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="stat" style={{ background: C.navy, color: '#fff' }}>
            <div className="l" style={{ color: C.sky }}>{seg3 > (n.seguidores ?? 0) ? 'seguidores nas três redes' : 'seguidores no Instagram'}</div>
            <div className="v">{fmtInt(seg3 || n.seguidores)}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 20, color: C.sky, whiteSpace: 'nowrap' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><IcoIg c={C.sky} s={20} />{fmtInt(n.seguidores)}</span>
              {m.tiktok_seguidores ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><IcoTt c={C.sky} s={20} />{fmtInt(m.tiktok_seguidores)}</span> : null}
              {m.fb_seguidores ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}><IcoFb c={C.sky} s={20} />{fmtInt(m.fb_seguidores)}</span> : null}
            </div>
          </div>
          <div className="stat" style={{ background: C.blue, color: '#fff' }}>
            <div className="l" style={{ color: C.sky }}>contas alcançadas · 90 dias</div>
            <div className="v">{arred(n.ig90.reach)}</div>
            <div className="h" style={{ color: C.sky }}>no Instagram, últimos 90 dias</div>
          </div>
          <div className="stat" style={{ background: '#fff', border: `3px solid ${C.line}`, color: C.navy }}>
            <div className="l" style={{ color: C.muted }}>novos seguidores · 90 dias</div>
            <div className="v">+{fmtInt(n.ig90.novosSeguidores)}</div>
            <div className="h" style={{ color: C.muted }}>crescimento observado no período</div>
          </div>
          <div className="stat" style={{ background: '#fff', border: `3px solid ${C.line}`, color: C.navy }}>
            {m.parceiros ? (
              <>
                <div className="l" style={{ color: C.muted }}>parceiros atendidos</div>
                <div className="v">+{fmtInt(m.parceiros)}</div>
                <div className="h" style={{ color: C.muted }}>restaurantes, bares e eventos</div>
              </>
            ) : (
              <>
                <div className="l" style={{ color: C.muted }}>vídeos publicados · 90 dias</div>
                <div className="v">{n.ig90.posts}</div>
                <div className="h" style={{ color: C.muted }}>no Instagram</div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* 03 Alcance */}
      <section className="pg pad" style={{ background: '#fff', justifyContent: 'space-between', gap: 40 }}>
        <Head pill={`dados oficiais da Meta · ${fmtData(n.geradoEm)}`} tint="#EAF3FA" color={C.text} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="pill" style={{ alignSelf: 'flex-start', background: C.tint, color: C.blue, fontSize: 24, fontWeight: 700, letterSpacing: '.1em' }}>ALCANCE NO INSTAGRAM</div>
          {multiplo90 ? (
            <div style={{ background: C.blue, color: '#fff', borderRadius: 36, padding: '48px 46px', display: 'flex', alignItems: 'center', gap: 40 }}>
              <div style={{ fontSize: 150, fontWeight: 800, lineHeight: 0.85, letterSpacing: '-.04em' }}>{multiplo90}×</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1 }}>o nosso número de seguidores</div>
                <div style={{ fontSize: 26, color: C.sky }}>{arred(n.ig90.reach)} contas alcançadas em 90 dias para {fmtInt(n.seguidores)} seguidores.{multiplo30 ? ` Em 30 dias, ${multiplo30}×.` : ''}</div>
              </div>
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="metric" style={{ background: 'transparent', padding: '0 34px', gap: 0 }}>
            <div className="g">
              <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: C.muted }}>métrica</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.blue, textAlign: 'right' }}>últimos 30 dias</div>
              <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: C.navy, textAlign: 'right' }}>últimos 90 dias</div>
            </div>
          </div>
          {metricas.map(([nome, a, b, sinal, exato]) => (
            <div className="metric" key={nome}>
              <div className="g">
                <div className="n">{nome}</div>
                <div className="a">{sinal ? '+' : ''}{exato ? fmtInt(a) : arred(a)}</div>
                <div className="b">{sinal ? '+' : ''}{exato ? fmtInt(b) : arred(b)}</div>
              </div>
              <div className="track"><div style={{ width: `${pct(a, b)}%` }} /></div>
            </div>
          ))}
        </div>
        {ritmo ? (
          <div style={{ background: C.tint, color: C.navy, borderRadius: 32, padding: '34px 40px', display: 'flex', alignItems: 'center', gap: 28 }}>
            <div style={{ fontSize: 80, fontWeight: 800, lineHeight: 1, letterSpacing: '-.03em' }}>{ritmo}%</div>
            <div style={{ fontSize: 28, fontWeight: 600, lineHeight: 1.3 }}>do alcance dos últimos 90 dias aconteceu nos últimos 30 dias.{ritmo >= 40 ? ' O ritmo está subindo.' : ''}</div>
          </div>
        ) : null}
      </section>

      {/* 04 TikTok e Facebook */}
      <section className="pg pad" style={{ background: C.wash, gap: 36 }}>
        <Head pill={temTikTok ? 'todo vídeo sai nas três redes' : 'todo vídeo sai nas duas redes'} />
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 36, flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-.035em', color: C.navy, textWrap: 'balance' }}>
              Cada vídeo também é publicado no {temTikTok ? 'TikTok e no ' : ''}Facebook.
            </div>
            <div style={{ fontSize: 28, lineHeight: 1.4, color: C.text, maxWidth: 800 }}>O mesmo conteúdo trabalha em {temTikTok ? 'três' : 'duas'} redes, sem custo extra para o restaurante.</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {temTikTok ? (
              <div style={{ background: C.tint, color: C.navy, borderRadius: 32, padding: '46px 42px', display: 'flex', flexDirection: 'column', gap: 30 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <IcoTt c={C.navy} s={34} />
                  <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.02em' }}>TikTok</div>
                  <div className="pill" style={{ background: '#fff', color: C.blue, fontSize: 22, fontWeight: 500, padding: '10px 22px' }}>@{n.username}</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
                  {m.tiktok_seguidores ? <div className="tile"><div className="l">seguidores</div><div className="v">{fmtInt(m.tiktok_seguidores)}</div></div> : null}
                  {m.tiktok_curtidas_total ? <div className="tile"><div className="l">curtidas no total</div><div className="v">{arred(m.tiktok_curtidas_total)}</div></div> : null}
                  {m.tiktok_views_7d ? <div className="tile"><div className="l">views · 7 dias</div><div className="v">{arred(m.tiktok_views_7d)}</div></div> : null}
                </div>
              </div>
            ) : null}
            <div style={{ background: C.tint, borderRadius: 32, padding: '46px 42px', display: 'flex', flexDirection: 'column', gap: 30 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <IcoFb c={C.navy} s={34} />
                <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.02em', color: C.navy }}>Facebook</div>
                <div className="pill" style={{ background: '#fff', color: C.blue, fontSize: 22, fontWeight: 500, padding: '10px 22px' }}>Vamo Nessa SP</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                {m.fb_seguidores ? <div className="tile"><div className="l">seguidores da Página</div><div className="v">{fmtInt(m.fb_seguidores)}</div></div> : null}
                <div className="tile"><div className="l">publicações · 90 dias</div><div className="v">{n.fbPosts90}</div></div>
              </div>
              {fbCases.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div style={{ fontSize: 24, fontWeight: 600, color: C.navy }}>Views no Facebook dos nossos cases · últimos 90 dias</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px', fontSize: 24, fontWeight: 500, color: C.text }}>
                    {fbCases.map((c) => (
                      <div key={c.data + c.titulo} style={{ display: 'flex', justifyContent: 'space-between', gap: 16, background: '#fff', borderRadius: 999, padding: '13px 24px', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{nomeCase(c)}</span><span style={{ fontWeight: 700, color: C.navy }}>{arred(c.fb_views)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {/* 05 Cases */}
      {casesA.length > 0 ? (
        <section className="pg pad" style={{ background: '#fff', justifyContent: 'space-between', gap: 32 }}>
          <Head pill="últimos 90 dias" tint="#EAF3FA" color={C.text} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 20 }}>
            <div className="title">Cases</div>
            <div style={{ fontSize: 28, fontWeight: 500, color: C.muted }}>vídeos que estouraram</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1, minHeight: 0 }}>
            {casesA.map((c) => <Case c={c} key={c.data + c.titulo} />)}
          </div>
        </section>
      ) : null}

      {/* 06 Cases + CTA */}
      <section className="pg pad" style={{ background: '#fff', justifyContent: 'space-between', gap: 28 }}>
        <Head pill="últimos 90 dias" tint="#EAF3FA" color={C.text} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {casesB.map((c) => (
            <div key={c.data + c.titulo} style={{ height: 442, display: 'flex' }}><Case c={c} /></div>
          ))}
        </div>
        <div style={{ background: C.blue, color: '#fff', borderRadius: 36, padding: '52px 46px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 76, fontWeight: 800, lineHeight: 1, letterSpacing: '-.035em' }}>O seu pode ser o próximo</div>
          <div style={{ fontSize: 28, color: C.sky }}>
            {m.parceiros ? `+${fmtInt(m.parceiros)} restaurantes parceiros já passaram por aqui.` : `${n.ig90.posts} lugares visitados só nos últimos 90 dias.`}
          </div>
        </div>
      </section>

      {/* 07 O que entregamos */}
      <section className="pg pad" style={{ background: C.wash, gap: 48 }}>
        <Head pill="visita + gravação" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          <div className="title">O que você recebe</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {[
              ['Gravação da nossa experiência, com acesso a pratos e experiência total para ser transmitida aos seguidores', null, <svg key="1" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6.5" width="12" height="11" rx="2.5" /><path d="M14.5 10.5l6-3.2v9.4l-6-3.2z" /></svg>],
              ['Narração e edição profissional', null, <svg key="2" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2.5" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" /><path d="M12 18v3.5" /></svg>],
              ['Aprovação do conteúdo com o cliente', null, <svg key="3" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M8 12.4l2.7 2.6L16 9.5" /></svg>],
              [`Postagem no ${redes}`, null, <svg key="4" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 3L10.5 13.5" /><path d="M21 3l-6.8 18-3.7-7.5L3 9.8z" /></svg>],
              ['Tráfego pago opcional', 'verba do cliente', <svg key="5" width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 16.5l6-6 4 4 8-8" /><path d="M15 6.5h6v6" /></svg>],
            ].map(([t, d, ic], i) => (
              <div className="item" key={i}>
                <div className="ic">{ic}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div className="t">{t}</div>
                  {d ? <div className="d">{d}</div> : null}
                </div>
              </div>
            ))}
          </div>
          <div style={{ background: C.blue, color: '#fff', borderRadius: 30, padding: '32px 36px', display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>*</div>
            <div style={{ fontSize: 26, fontWeight: 500, lineHeight: 1.35 }}>Podemos enviar o material bruto da captação para uso interno do restaurante. Peça orçamento.</div>
          </div>
          <div style={{ background: '#fff', borderRadius: 30, padding: '30px 36px', fontSize: 26, fontWeight: 500, lineHeight: 1.4, color: C.text }}>O consumo da visita fica por conta do restaurante. O resto é com a gente.</div>
        </div>
      </section>

      {/* 08 Valores e contato */}
      <section className="pg pad" style={{ background: C.navy, color: '#fff', justifyContent: 'space-between', gap: 36 }}>
        <Head pill="validade de 30 dias" light tint="rgba(255,255,255,.1)" color={C.sky} />
        <div className="title" style={{ color: '#fff' }}>Valores</div>
        <div style={{ background: '#fff', color: C.navy, borderRadius: 36, padding: '48px 44px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <div className="pill" style={{ background: C.tint, color: C.blue, fontSize: 22, fontWeight: 700, letterSpacing: '.08em' }}>VISITA + GRAVAÇÃO</div>
            {g.cliente ? <div className="pill" style={{ background: C.wash, color: C.text, fontSize: 22, fontWeight: 600 }}>proposta para {g.cliente}</div> : null}
          </div>
          <div style={{ fontSize: 96, fontWeight: 800, lineHeight: 1, letterSpacing: '-.03em', whiteSpace: 'nowrap' }}>
            {g.valor !== null ? `R$ ${g.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : <>R$ <mark style={{ background: C.mark, color: C.navy, padding: '0 14px', borderRadius: 12 }}>a combinar</mark></>}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {['50% na confirmação e 50% na postagem', 'Consumo por conta do restaurante', `Valor válido até ${fmtData(new Date(new Date(n.geradoEm).getTime() + 30 * 86_400_000).toISOString())}`].map((t) => (
              <div key={t} className="pill" style={{ background: C.wash, color: C.text, fontSize: 24, fontWeight: 500, padding: '14px 26px' }}>{t}</div>
            ))}
          </div>
        </div>
        <a href={waHref} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.blue, color: '#fff', fontSize: 56, fontWeight: 800, letterSpacing: '-.02em', padding: 38, borderRadius: 999, textDecoration: 'none' }}>E aí, vamo nessa?</a>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: '-.03em' }}>Contato</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <a className="contact" href={`https://instagram.com/${n.username}`}><IcoIg c={C.sky} s={28} />@{n.username}</a>
            <a className="contact" href={`https://tiktok.com/@${n.username}`}><IcoTt c={C.sky} s={28} />@{n.username}</a>
            <a className="contact" href="https://www.facebook.com/vamonessasp"><IcoFb c={C.sky} s={28} />Vamo Nessa SP</a>
            {m.whatsapp ? <a className="contact" href={waHref} style={{ background: C.blue, fontWeight: 700 }}><IcoWa />{m.whatsapp}</a> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
