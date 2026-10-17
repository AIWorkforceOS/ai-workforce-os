import type { MetadataRoute } from 'next'

/**
 * Manifesto do app instalável (PWA). Ícones derivados do ícone oficial da Alizo
 * (app/icon.png) — o "maskable" é a mesma logo na zona segura sobre o fundo escuro da marca.
 * start_url = portal do funcionário (admin cai no /dashboard pelo guard do layout).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/portal-funcionario',
    name: 'Alizo AI',
    short_name: 'Alizo',
    description: 'Alizo AI — ordens de serviço, fotos, assinatura e check-in em campo, com envio automático quando a internet voltar.',
    lang: 'pt-BR',
    start_url: '/portal-funcionario',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0a0f1e',
    theme_color: '#0a0f1e',
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
