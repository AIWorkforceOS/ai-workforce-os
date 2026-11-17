import { createClient as createSupabaseClient } from '@supabase/supabase-js'

/**
 * Service-role client for server-only code paths that run without a logged-in
 * user session (webhooks, background jobs). Never import this from client code.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceKey) {
    return null
  }

  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      // Leituras privilegiadas incluem chaves, escopos, revogações e estado
      // operacional. O fetch do Next pode manter respostas GET no Data Cache;
      // isso fez a API de parceiro enxergar scopes antigos mesmo depois da
      // atualização confirmada no Postgres. Dados service-role nunca devem
      // ser reutilizados pelo cache de aplicação.
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  })
}
