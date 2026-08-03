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
  },
}

export default nextConfig
