import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Manrope } from 'next/font/google'
import './globals.css'

/**
 * Manrope carrega a interface: geométrica-humanista, aberta em corpo pequeno,
 * com figuras tabulares — o parente mais próximo da Satoshi disponível no
 * Google Fonts. Bricolage Grotesque assina os títulos e os números grandes:
 * é onde o painel tem voz própria em vez de parecer template.
 */
const manrope = Manrope({
  subsets: ['latin'],
  variable: '--font-manrope',
  display: 'swap',
})

const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Painel Vamo Nessa', template: '%s · Vamo Nessa' },
  description: 'Crescimento e relacionamento do Instagram @vamonessasp.',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#171a1f',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${manrope.variable} ${bricolage.variable}`}>
      <body>{children}</body>
    </html>
  )
}
