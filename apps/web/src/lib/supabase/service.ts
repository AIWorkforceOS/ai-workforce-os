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
  })
}
