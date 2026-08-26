import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Gera um link de primeiro acesso (Supabase Auth) pra um e-mail — 'invite'
 * cria a conta de login; se já existir, cai pra 'recovery' (reset de
 * senha) na mesma conta. Nunca envolve senha em texto puro em lugar
 * nenhum. Extraído de app/api/admin/users/route.ts (2026-08-26) porque
 * agora o checkout self-service (lib/payments/webhook-handler.ts, depois
 * que o pagamento é aprovado) usa exatamente o mesmo padrão.
 */
export async function generateAccessLink(
  service: SupabaseClient,
  email: string,
  redirectTo: string,
): Promise<{ ok: true; link: string; linkType: 'invite' | 'recovery' } | { ok: false; error: string }> {
  const invite = await service.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })
  if (!invite.error) {
    const link = invite.data.properties?.action_link
    if (link) return { ok: true, link, linkType: 'invite' }
  } else {
    const alreadyExists = /already|registered|exists/i.test(invite.error.message)
    if (!alreadyExists) return { ok: false, error: invite.error.message }
  }

  const recovery = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
  const link = recovery.data?.properties?.action_link
  if (recovery.error || !link) {
    return { ok: false, error: recovery.error?.message ?? 'Não foi possível gerar o link de acesso.' }
  }
  return { ok: true, link, linkType: 'recovery' }
}
