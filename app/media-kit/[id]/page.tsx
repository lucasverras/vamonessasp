import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BotaoImprimir } from '@/components/botao-imprimir'
import { fmtBRL, fmtCompacto, fmtData, fmtInt, getGerado, type CaseMediaKit, type NumerosMediaKit } from '@/lib/analytics/media-kit'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const g = await getGerado((await params).id)
  return { title: g ? `Media Kit ${g.rotulo}${g.cliente ? ` · ${g.cliente}` : ''}` : 'Media Kit' }
}

/*
 * Página de impressão: 1080×1920 por página (formato story, como o kit
 * anterior), branco/preto + um acento quente. Na tela, reduzida com zoom;
 * no print, tamanho real e uma página por folha.
 */
const CSS = `
.mk{--ac:#FF4D1C;font-family:var(--font-sans);color:#000;background:#2b2d31;padding:24px;display:flex;flex-direction:column;align-items:center;gap:24px;min-height:100dvh}
.mk .bar{position:sticky;top:0;z-index:5;display:flex;gap:12px;align-items:center;justify-content:space-between;width:min(100%,760px);background:#15171a;color:#e5e7eb;border:1px solid #3a3d44;border-radius:12px;padding:10px 14px;font-size:14px}
.mk .bar a{color:#9ca3af;text-decoration:underline}
.mk .pg{width:1080px;height:1920px;background:#fff;position:relative;overflow:hidden;padding:88px 80px 72px;display:flex;flex-direction:column;zoom:.42;box-shadow:0 12px 48px rgba(0,0,0,.45);flex:none}
@media (min-width:1100px){.mk .pg{zoom:.58}}
.mk .logo{display:flex;flex-direction:column;align-items:center;gap:2px;margin-bottom:64px}
.mk .logo .hand{font-size:80px;line-height:1}
.mk .logo .word{font-family:var(--font-display);font-weight:800;font-size:58px;letter-spacing:-.02em;line-height:1.05}
.mk .logo .sub{font-size:22px;letter-spacing:.34em;font-weight:600;padding-left:.34em}
.mk .outline{font-family:var(--font-display);font-weight:800;font-size:168px;line-height:.92;letter-spacing:-.01em;color:transparent;-webkit-text-stroke:3px #000;text-align:center;margin:0 0 28px}
.mk .outline.sm{font-size:124px}
.mk .sub-t{text-align:center;font-size:32px;color:#374151;margin:0 0 56px;line-height:1.3}
.mk .big{font-family:var(--font-display);font-weight:800;font-size:132px;line-height:.95;letter-spacing:-.035em}
.mk .big.md{font-size:96px}
.mk .ac{color:var(--ac)}
.mk .lbl{font-size:24px;text-transform:uppercase;letter-spacing:.14em;color:#6B7280;font-weight:700}
.mk .grid2{display:grid;grid-template-columns:1fr 1fr;gap:40px}
.mk .card{border:3px solid #000;border-radius:32px;padding:44px}
.mk .row{display:grid;grid-template-columns:1.4fr 1fr 1fr;align-items:baseline;padding:22px 0;border-bottom:2px solid #e5e7eb;font-size:30px}
.mk .row.h{font-size:22px;text-transform:uppercase;letter-spacing:.12em;color:#6B7280;font-weight:700;border-bottom-width:3px;border-color:#000}
.mk .row span:not(:first-child){text-align:right;font-family:var(--font-display);font-weight:700;font-variant-numeric:tabular-nums}
.mk .cta{background:#000;color:#fff;border-radius:22px;padding:30px;text-align:center;font-size:36px;font-weight:800;margin-top:auto}
.mk .foot{margin-top:auto;padding-top:32px;display:flex;justify-content:space-between;font-size:21px;color:#6B7280}
.mk .case{display:grid;grid-template-columns:280px 1fr;border:3px solid #000;border-radius:28px;overflow:hidden;min-height:420px}
.mk .case .thumb{width:280px;height:100%;object-fit:cover;display:block;background:#e5e7eb}
.mk .case .body{padding:32px 36px;display:flex;flex-direction:column;gap:10px}
.mk .case .t{font-size:26px;line-height:1.3;color:#374151}
.mk .case .h{font-family:var(--font-display);font-weight:800;font-size:36px;letter-spacing:-.02em}
.mk .case .n{font-family:var(--font-display);font-weight:800;font-size:72px;letter-spacing:-.03em;line-height:1}
.mk .case .s{display:flex;gap:28px;font-size:24px;color:#374151;margin-top:auto}
.mk .case .s b{font-family:var(--font-display);font-weight:700}
.mk ul.lista{list-style:none;padding:0;margin:0;display:grid;gap:26px;font-size:34px}
.mk ul.lista li{display:flex;gap:22px;align-items:flex-start}
.mk ul.lista li::before{content:'';flex:none;width:22px;height:22px;border-radius:50%;background:var(--ac);margin-top:16px}
.mk .capa{background:#000;color:#fff;justify-content:center;align-items:center;text-align:center}
.mk .capa .logo{color:#fff;margin-bottom:120px}
.mk .capa .outline{-webkit-text-stroke:3px #fff;font-size:208px}
.mk .capa .tag{font-size:36px;letter-spacing:.3em;text-transform:uppercase;color:#d1d5db;margin-top:40px}
.mk .capa .para{margin-top:96px;font-size:34px;color:#9ca3af}
.mk .capa .para b{display:block;color:#fff;font-family:var(--font-display);font-weight:800;font-size:64px;letter-spacing:-.02em;margin-top:10px}
.mk .capa .redes{position:absolute;bottom:96px;left:0;right:0;font-size:28px;color:#d1d5db;letter-spacing:.08em}
@media print{
  body{background:#fff!important}
  .mk{background:#fff;padding:0;gap:0;min-height:0}
  .mk .bar{display:none}
  .mk .pg{zoom:1;box-shadow:none;break-after:page;page-break-after:always}
  @page{size:1080px 1920px;margin:0}
}
`

function Logo() {
  return (
    <div className="logo">
      <span className="hand">🤙</span>
      <span className="word">VAMO NESSA</span>
      <span className="sub">SÃO PAULO</span>
    </div>
  )
}

function Foot({ n, rotulo }: { n: NumerosMediaKit; rotulo: string }) {
  return (
    <div className="foot">
      <span>@{n.username} · {rotulo}</span>
      <span>Números da API oficial da Meta · {fmtData(n.geradoEm)}</span>
    </div>
  )
}

function Case({ c }: { c: CaseMediaKit }) {
  const total = (c.ig_views ?? 0) + (c.fb_views ?? 0)
  return (
    <div className="case">
      {/* CDN da Meta, URL expira — sem otimizador do Next de propósito */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {c.thumbnail ? <img className="thumb" src={c.thumbnail} alt="" /> : <div className="thumb" />}
      <div className="body">
        <span className="h">{c.handle ?? 'Vamo Nessa'}</span>
        <span className="t">{c.titulo}</span>
        <span className="n">{fmtCompacto(total)} <span style={{ fontSize: 28, fontFamily: 'var(--font-sans)', fontWeight: 600, color: '#6B7280' }}>views{c.fb_views ? ' (IG + FB)' : ''}</span></span>
        <div className="s">
          <span><b>{fmtCompacto(c.ig_reach)}</b> alcançadas</span>
          <span><b>{fmtCompacto(c.ig_likes)}</b> curtidas</span>
          <span><b>{fmtCompacto(c.ig_shares)}</b> compart.</span>
        </div>
      </div>
    </div>
  )
}

export default async function MediaKitGerado({ params }: { params: Promise<{ id: string }> }) {
  const g = await getGerado((await params).id)
  if (!g) notFound()
  const n = g.numeros
  const m = n.manual
  const rotulo = g.rotulo
  const multiplo = n.seguidores && n.ig90.reach ? Math.round(n.ig90.reach / n.seguidores) : null
  const temTikTok = [m.tiktok_seguidores, m.tiktok_views_90d, m.tiktok_curtidas_90d, m.tiktok_compart_90d].some((v) => v !== null)
  const casesA = n.cases.slice(0, 3)
  const casesB = n.cases.slice(3, 6)
  const validade = new Date(new Date(n.geradoEm).getTime() + 30 * 86_400_000).toISOString()
  const linhas: Array<[string, string, string]> = [
    ['Visualizações', fmtCompacto(n.ig30.views), fmtCompacto(n.ig90.views)],
    ['Contas alcançadas', fmtCompacto(n.ig30.reach), fmtCompacto(n.ig90.reach)],
    ['Curtidas', fmtCompacto(n.ig30.likes), fmtCompacto(n.ig90.likes)],
    ['Compartilhamentos', fmtCompacto(n.ig30.shares), fmtCompacto(n.ig90.shares)],
    ['Salvamentos', fmtCompacto(n.ig30.saved), fmtCompacto(n.ig90.saved)],
    ['Comentários', fmtCompacto(n.ig30.comments), fmtCompacto(n.ig90.comments)],
    ['Publicações', String(n.ig30.posts), String(n.ig90.posts)],
    ['Novos seguidores', `+${fmtInt(n.ig30.novosSeguidores)}`, `+${fmtInt(n.ig90.novosSeguidores)}`],
  ]

  return (
    <div className="mk">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="bar">
        <span>
          Media Kit <b>{rotulo}</b>{g.cliente ? ` · ${g.cliente}` : ''} · gerado {fmtData(g.created_at)} · <Link href="/media-kit">voltar</Link>
        </span>
        <BotaoImprimir />
      </div>

      {/* 1. Capa */}
      <section className="pg capa">
        <Logo />
        <h1 className="outline">MEDIA KIT</h1>
        <div className="tag">{rotulo}</div>
        {g.cliente ? (
          <div className="para">preparado para<b>{g.cliente}</b></div>
        ) : (
          <div className="para">@{n.username}</div>
        )}
        <div className="redes">Instagram · TikTok · Facebook — @{n.username}</div>
      </section>

      {/* 2. Quem somos + números de abertura */}
      <section className="pg">
        <Logo />
        <h1 className="outline sm">QUEM SOMOS</h1>
        <p className="sub-t">Mostramos onde comer em São Paulo — e o público vai atrás.</p>
        <div className="grid2">
          <div>
            <div className="lbl">Seguidores no Instagram</div>
            <div className="big">{fmtInt(n.seguidores)}</div>
            <div style={{ fontSize: 22, color: '#6B7280', marginTop: 8 }}>em {fmtData(n.seguidoresEm)}</div>
          </div>
          <div>
            <div className="lbl">Contas alcançadas · 90 dias</div>
            <div className="big ac">{fmtCompacto(n.ig90.reach)}</div>
          </div>
          <div style={{ marginTop: 56 }}>
            <div className="lbl">Novos seguidores · 90 dias</div>
            <div className="big md">+{fmtInt(n.ig90.novosSeguidores)}</div>
          </div>
          <div style={{ marginTop: 56 }}>
            {m.parceiros ? (
              <>
                <div className="lbl">Parceiros atendidos</div>
                <div className="big md">+{fmtInt(m.parceiros)}</div>
              </>
            ) : (
              <>
                <div className="lbl">Vídeos publicados · 90 dias</div>
                <div className="big md">{n.ig90.posts}</div>
              </>
            )}
          </div>
        </div>
        {multiplo ? (
          <div className="card" style={{ marginTop: 'auto', textAlign: 'center' }}>
            <div className="big md">{multiplo}×</div>
            <div style={{ fontSize: 30, marginTop: 8 }}>Alcançamos {multiplo} vezes o nosso número de seguidores nos últimos 90 dias.</div>
          </div>
        ) : null}
        <Foot n={n} rotulo={rotulo} />
      </section>

      {/* 3. Alcance 30 vs 90 */}
      <section className="pg">
        <Logo />
        <h1 className="outline">ALCANCE</h1>
        <p className="sub-t">Instagram @{n.username} — últimos 30 e 90 dias</p>
        <div className="row h"><span>Métrica</span><span>30 dias</span><span>90 dias</span></div>
        {linhas.map(([l, a, b]) => (
          <div className="row" key={l}><span>{l}</span><span>{a}</span><span>{b}</span></div>
        ))}
        <p style={{ fontSize: 22, color: '#6B7280', marginTop: 28, lineHeight: 1.4 }}>
          Novos seguidores = bruto informado pela Meta no período, sem descontar quem deixou de seguir.
        </p>
        <Foot n={n} rotulo={rotulo} />
      </section>

      {/* 4. Facebook + TikTok */}
      <section className="pg">
        <Logo />
        <h1 className="outline sm">OUTRAS REDES</h1>
        <p className="sub-t">Todo vídeo sai no Instagram, no Facebook{temTikTok ? ' e no TikTok' : ''}.</p>
        <div className="card">
          <div className="lbl">Facebook · Página Vamo Nessa SP</div>
          <div className="grid2" style={{ marginTop: 24 }}>
            <div><div className="big md">{n.fbPosts90}</div><div style={{ fontSize: 24, color: '#374151' }}>vídeos publicados · 90 dias</div></div>
            {m.fb_seguidores ? <div><div className="big md">{fmtInt(m.fb_seguidores)}</div><div style={{ fontSize: 24, color: '#374151' }}>seguidores da Página</div></div> : null}
          </div>
          {n.cases.some((c) => (c.fb_views ?? 0) > 0) ? (
            <div style={{ marginTop: 36 }}>
              <div className="lbl" style={{ marginBottom: 12 }}>Views no Facebook · destaques</div>
              {n.cases.filter((c) => (c.fb_views ?? 0) > 0).sort((a, b) => (b.fb_views ?? 0) - (a.fb_views ?? 0)).slice(0, 3).map((c) => (
                <div className="row" key={c.data + c.titulo} style={{ gridTemplateColumns: '1fr auto' }}>
                  <span>{c.handle ?? c.titulo.slice(0, 40)}</span><span>{fmtCompacto(c.fb_views)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {temTikTok ? (
          <div className="card" style={{ marginTop: 40 }}>
            <div className="lbl">TikTok · @{n.username}</div>
            <div className="grid2" style={{ marginTop: 24 }}>
              {m.tiktok_seguidores ? <div><div className="big md">{fmtInt(m.tiktok_seguidores)}</div><div style={{ fontSize: 24, color: '#374151' }}>seguidores</div></div> : null}
              {m.tiktok_views_90d ? <div><div className="big md">{fmtCompacto(m.tiktok_views_90d)}</div><div style={{ fontSize: 24, color: '#374151' }}>views · 90 dias</div></div> : null}
              {m.tiktok_curtidas_90d ? <div><div className="big md">{fmtCompacto(m.tiktok_curtidas_90d)}</div><div style={{ fontSize: 24, color: '#374151' }}>curtidas · 90 dias</div></div> : null}
              {m.tiktok_compart_90d ? <div><div className="big md">{fmtCompacto(m.tiktok_compart_90d)}</div><div style={{ fontSize: 24, color: '#374151' }}>compartilhamentos · 90 dias</div></div> : null}
            </div>
          </div>
        ) : null}
        <Foot n={n} rotulo={rotulo} />
      </section>

      {/* 5–6. Cases */}
      {[casesA, casesB].filter((l) => l.length > 0).map((lista, i) => (
        <section className="pg" key={i}>
          <Logo />
          <h1 className="outline sm">CASES</h1>
          <p className="sub-t">Vídeos com maior alcance nos últimos 90 dias</p>
          <div style={{ display: 'grid', gap: 32 }}>
            {lista.map((c) => <Case c={c} key={c.data + c.titulo} />)}
          </div>
          <Foot n={n} rotulo={rotulo} />
        </section>
      ))}

      {/* 7. O que entregamos */}
      <section className="pg">
        <Logo />
        <h1 className="outline sm">ENTREGA</h1>
        <p className="sub-t">Visita + gravação — o que está incluso</p>
        <ul className="lista">
          <li>Gravação de entrada, prato principal e sobremesa (se houver)</li>
          <li>Gravação do local e do ambiente</li>
          <li>Narração e vídeo editado no nosso estilo</li>
          <li>Validação do vídeo com você antes de publicar</li>
          <li>Postagem no Instagram, no Facebook{temTikTok ? ' e no TikTok' : ''}</li>
          <li>Opção de impulsionamento pago (verba definida por você)</li>
        </ul>
        <Foot n={n} rotulo={rotulo} />
      </section>

      {/* 8. Valores */}
      <section className="pg">
        <Logo />
        <h1 className="outline">VALORES</h1>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <div style={{ fontSize: 40, fontWeight: 800, fontFamily: 'var(--font-display)' }}>Visita + Gravação</div>
          {g.cliente ? <div style={{ fontSize: 26, color: '#6B7280', marginTop: 6 }}>proposta para {g.cliente}</div> : null}
          <div className="big ac" style={{ marginTop: 40 }}>{fmtBRL(g.valor)}</div>
          <div style={{ fontSize: 26, color: '#374151', marginTop: 12 }}>50% na confirmação da visita e 50% na postagem</div>
          <div style={{ height: 3, background: '#e5e7eb', margin: '40px 0' }} />
          <ul className="lista" style={{ fontSize: 28, gap: 18 }}>
            <li>Os produtos consumidos na gravação são por conta do restaurante</li>
            <li>Valor válido até {fmtData(validade)} — sujeito a alteração depois</li>
            <li>Agenda combinada por WhatsApp após a confirmação</li>
          </ul>
          <div className="cta">E aí, Vamo Nessa? 🤙</div>
        </div>
        <Foot n={n} rotulo={rotulo} />
      </section>

      {/* 9. Contato */}
      <section className="pg">
        <Logo />
        <h1 className="outline">CONTATO</h1>
        <p className="sub-t">Chama a gente por onde preferir</p>
        <div style={{ display: 'grid', gap: 28, fontSize: 40 }}>
          <a href={`https://instagram.com/${n.username}`} className="card" style={{ display: 'flex', justifyContent: 'space-between', color: '#000', textDecoration: 'none' }}><span className="lbl" style={{ fontSize: 26 }}>Instagram</span><span>@{n.username}</span></a>
          <a href={`https://tiktok.com/@${n.username}`} className="card" style={{ display: 'flex', justifyContent: 'space-between', color: '#000', textDecoration: 'none' }}><span className="lbl" style={{ fontSize: 26 }}>TikTok</span><span>@{n.username}</span></a>
          <a href="https://facebook.com" className="card" style={{ display: 'flex', justifyContent: 'space-between', color: '#000', textDecoration: 'none' }}><span className="lbl" style={{ fontSize: 26 }}>Facebook</span><span>Vamo Nessa SP</span></a>
          {m.whatsapp ? (
            <a href={`https://wa.me/55${m.whatsapp.replace(/\D/g, '')}`} className="card" style={{ display: 'flex', justifyContent: 'space-between', color: '#000', textDecoration: 'none', borderColor: 'var(--ac)' }}><span className="lbl" style={{ fontSize: 26 }}>WhatsApp</span><span>{m.whatsapp}</span></a>
          ) : null}
        </div>
        <div className="cta">E aí, Vamo Nessa? 🤙</div>
        <Foot n={n} rotulo={rotulo} />
      </section>
    </div>
  )
}
