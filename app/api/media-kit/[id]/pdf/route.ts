import { NextResponse } from 'next/server'
import { cookies, headers } from 'next/headers'
import { exigirSessao } from '@/lib/auth/guarda'
import { getGerado } from '@/lib/analytics/media-kit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * PDF do media kit gerado NO SERVIDOR (Chromium headless), 1080×1920 por
 * página, imagens reduzidas (?pdf=1). Existe porque "Salvar PDF" pelo
 * window.print() no celular sai com escala/quebras erradas; aqui o arquivo
 * já vem pronto para mandar no WhatsApp. A sessão do usuário é repassada ao
 * navegador headless — ele abre a mesma página protegida.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await exigirSessao()
  } catch {
    return NextResponse.json({ erro: 'sessão' }, { status: 401 })
  }
  const { id } = await params
  const g = await getGerado(id)
  if (!g) return NextResponse.json({ erro: 'não encontrado' }, { status: 404 })

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const origem = `${proto}://${host}`
  const sessao = (await cookies()).get('vn_sessao')?.value ?? ''

  const puppeteer = await import('puppeteer-core')
  const chromium = (await import('@sparticuz/chromium')).default
  const local = process.env.CHROME_PATH // dev no Mac: binário do Chrome instalado
  const browser = await puppeteer.launch(
    local
      ? { executablePath: local, headless: true, args: ['--no-sandbox'] }
      : { executablePath: await chromium.executablePath(), headless: true, args: chromium.args, defaultViewport: { width: 1080, height: 1920 } },
  )
  try {
    const page = await browser.newPage()
    await page.setCookie({ name: 'vn_sessao', value: sessao, domain: host.split(':')[0], path: '/', httpOnly: true, secure: proto === 'https' })
    await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 })
    await page.emulateMediaType('print')
    await page.goto(`${origem}/media-kit/${id}?pdf=1`, { waitUntil: 'networkidle0', timeout: 45_000 })
    await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready)
    const pdf = await page.pdf({
      width: '1080px', height: '1920px', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    const nome = `Media Kit ${g.rotulo}${g.cliente ? ` - ${g.cliente}` : ''}.pdf`.replace(/[\\/:*?"<>|]/g, '')
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${nome.normalize('NFD').replace(/[̀-ͯ]/g, '')}"; filename*=UTF-8''${encodeURIComponent(nome)}`,
        'Cache-Control': 'private, no-store',
      },
    })
  } finally {
    await browser.close()
  }
}
