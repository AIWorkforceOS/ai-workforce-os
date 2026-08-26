import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Provisiona de verdade org + unidade principal + usuário + aceite de
 * Termos/Privacidade + cobrança pendente do 1º mês — extraído do antigo
 * app/api/checkout/complete/route.ts (removido em 2026-08-26) na mudança
 * de arquitetura: agora isso só roda DEPOIS que o pagamento é aprovado
 * (chamado por lib/payments/webhook-handler.ts a partir de um
 * pending_signups já pago), nunca mais antes.
 *
 * financial_records nasce 'pending' de propósito — é o MESMO registro que
 * webhook-handler.ts vira 'paid' logo em seguida, reaproveitando o
 * caminho que já existe pra cobranças recorrentes de org já existente.
 */

function slugify(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export type ProvisionInput = {
  company: string
  name: string
  email: string
  phone: string | null
  plan: string
  currency: 'BRL' | 'USD'
  amount: number
  paymentMethod: string
  region: 'BR' | 'US'
  termsVersion: string
  privacyVersion: string
  acceptIp: string | null
}

export type ProvisionResult = { ok: true; orgId: string; userId: string } | { ok: false; error: string }

export async function provisionOrgFromSignup(service: SupabaseClient, input: ProvisionInput): Promise<ProvisionResult> {
  const baseSlug = slugify(input.company) || 'empresa'
  let slug = baseSlug
  for (let i = 2; i <= 20; i += 1) {
    const { data: taken } = await service.from('organizations').select('id').eq('slug', slug).maybeSingle()
    if (!taken) break
    slug = `${baseSlug}-${i}`
  }

  const { data: org, error: orgError } = await service
    .from('organizations')
    .insert({ name: input.company, slug, plan: input.plan, owner_email: input.email, is_active: true })
    .select('id')
    .single()
  if (orgError || !org) {
    return { ok: false, error: orgError?.message ?? 'Falha ao criar a organização.' }
  }

  async function rollback() {
    await service.from('organizations').delete().eq('id', org!.id)
  }

  const { error: unitError } = await service.from('units').insert({
    org_id: org.id,
    name: `${input.company} — Principal`,
    slug: `${slug}-principal`,
    is_active: true,
  })
  if (unitError) {
    await rollback()
    return { ok: false, error: unitError.message }
  }

  const { data: newUser, error: userError } = await service
    .from('users')
    .insert({ email: input.email, name: input.name, org_id: org.id, role: 'admin', is_active: true })
    .select('id')
    .single()
  if (userError || !newUser) {
    await rollback()
    return { ok: false, error: userError?.message ?? 'Falha ao criar o usuário.' }
  }

  // Aceite de Termos/Privacidade (migration 066) — se não gravar, a conta
  // já existe mas nunca é desfeita por causa disso (mesmo padrão do
  // checkout antigo); quem chama esta função decide se loga o erro.
  await service.from('legal_acceptances').insert({
    user_id: newUser.id,
    org_id: org.id,
    terms_version: input.termsVersion,
    privacy_version: input.privacyVersion,
    ip: input.acceptIp,
    region: input.region,
    source: 'checkout',
  })

  const billingRow = {
    org_id: org.id,
    type: 'receivable',
    amount: input.amount,
    status: 'pending',
    category: 'client_payment',
    description: `Assinatura Alizo — plano ${input.plan} (1º mês) · ${input.paymentMethod} · ${input.currency}`,
  }
  // currency/payment_method existem a partir da migration 20260714000009;
  // se ela ainda não tiver sido aplicada, registra sem as colunas novas.
  const { error: billingError } = await service
    .from('financial_records')
    .insert({ ...billingRow, currency: input.currency, payment_method: input.paymentMethod })
  if (billingError) {
    await service.from('financial_records').insert(billingRow)
  }

  return { ok: true, orgId: org.id, userId: newUser.id }
}
