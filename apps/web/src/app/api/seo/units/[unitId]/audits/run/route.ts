import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runSeoAudit } from '@/lib/seo/audit'
import { siteUrlFrom } from '@/lib/seo/planner'
import type { Unit } from '@/lib/types'

export const maxDuration = 60

/**
 * Roda a auditoria técnica de SEO agora (fora do ciclo do cron), a
 * pedido do cliente no painel.
 *
 * A URL auditada NUNCA vem do corpo da requisição — sempre lida do
 * business_profile aprendido na entrevista de contratação
 * (agent_configs.site_url), para esta rota nunca virar um proxy de fetch
 * de URL arbitrária (SSRF).
 *
 * Permissão: o select em `units` abaixo só encontra a unidade se a
 * sessão puder vê-la (RLS); a auditoria em si roda com service role
 * porque a escrita em seo_audits é restrita ao motor (ver migration 042).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const { unitId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const { data: visibleUnit } = await supabase.from('units').select('id').eq('id', unitId).maybeSingle()
  if (!visibleUnit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })
  }

  const { data: unit } = await service.from('units').select('*').eq('id', unitId).single()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  const unitRow = unit as Unit
  if (!unitRow.org_id) return NextResponse.json({ error: 'Unidade sem organização vinculada.' }, { status: 400 })

  const { data: config } = await service
    .from('agent_configs')
    .select('business_profile')
    .eq('unit_id', unitId)
    .eq('agent_type', 'seo_specialist')
    .maybeSingle()
  const siteUrl = siteUrlFrom((config as { business_profile?: Record<string, unknown> } | null)?.business_profile)

  if (!siteUrl) {
    return NextResponse.json(
      { error: 'Nenhuma URL de site cadastrada ainda — complete a entrevista do especialista em SEO informando o site da empresa.' },
      { status: 400 },
    )
  }

  const result = await runSeoAudit({ siteUrl })

  const { data: audit, error } = await service
    .from('seo_audits')
    .insert({
      org_id: unitRow.org_id,
      unit_id: unitId,
      site_url: siteUrl,
      score: result.score,
      checks: result.checks,
      error_message: result.errorMessage,
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ audit })
}
