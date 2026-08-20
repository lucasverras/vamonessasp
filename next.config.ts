import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Chromium headless para o PDF do media kit: binário nativo, não empacotar.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
}

export default nextConfig
