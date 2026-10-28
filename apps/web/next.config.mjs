/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@ai-workforce-os/ui', '@ai-workforce-os/utils', '@ai-workforce-os/types'],
  experimental: {
    // O Router Cache do App Router (client-side) guarda por padrão o RSC
    // payload de rotas dinâmicas por 30s, mesmo usando cookies()/cache:
    // 'force-dynamic' no servidor — isso é cache no cliente, separado do
    // Data Cache. Nesse painel, praticamente toda tela é dado do Supabase
    // que muda a qualquer momento (cliente editado, fatura enviada por
    // outra aba etc.), então zerar o staleTime evita ver dado desatualizado
    // ao navegar entre telas logo após uma edição.
    staleTimes: { dynamic: 0 },
    // ffmpeg-static localiza o binário pelo próprio __dirname: não pode ser empacotado pelo webpack, e o arquivo precisa ir junto das funções que
    // renderizam vídeo (cron e edição). Sem isso o servidor não acha o ffmpeg e a renderização falha com erro claro.
    serverComponentsExternalPackages: ['ffmpeg-static'],
    outputFileTracingIncludes: {
      '/api/cron/content': ['./node_modules/ffmpeg-static/ffmpeg'],
      '/api/content/generate-week': ['./node_modules/ffmpeg-static/ffmpeg'],
      '/api/content/generate-now': ['./node_modules/ffmpeg-static/ffmpeg'],
      '/api/content/posts/[id]/video': ['./node_modules/ffmpeg-static/ffmpeg'],
    },
  },
  webpack: (config) => {
    // pdf.js (visualizador do Sign Off) lista o módulo nativo "canvas" como opcional, só para rodar no Node. Nós só usamos o pdf.js no navegador (o servidor
    // apenas compila o componente, sem executá-lo): sem este alias o webpack tenta resolver o módulo nativo e a compilação quebra.
    config.resolve.alias = { ...config.resolve.alias, canvas: false }
    return config
  },
  async headers() {
    return [
      {
        // O Service Worker nunca pode ficar preso em cache do navegador: versão nova (ou o rollback) vale na próxima abertura.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default nextConfig
