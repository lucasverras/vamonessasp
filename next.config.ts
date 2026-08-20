import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Chromium headless para o PDF do media kit: binário nativo, não empacotar.
  serverExternalPackages: ['@sparticuz/chromium', 'puppeteer-core'],
  // O binário (bin/*.br) fica fora do trace automático — sem isto a função
  // sobe sem o Chromium e a rota do PDF falha com "input directory does not exist".
  outputFileTracingIncludes: {
    '/api/media-kit/[id]/pdf': ['./node_modules/@sparticuz/chromium/bin/**'],
  },
}

export default nextConfig
