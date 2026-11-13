import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { evaluateEmployeeCertification } from '@/lib/interview/certification'
import { fetchOrganizationVerticalKey } from '@/lib/organizations'
import type { AgentConfig, Service, Unit } from '@/lib/types'

export async function POST(request: Request) {
  const user = await getAppUser()
  if (!user || (user.role !== 'admin' && !user.isSuperAdmin)) {
    return NextResponse.json({ error: 'Sem permissão.' }, { status: 403 })
  }
  const body = await request.json().catch(() => null)
  const configId = typeof body?.configId === 'string' ? body.configId : null
  if (!configId) return NextResponse.json({ error: 'configId é obrigatório.' }, { status: 400 })
  if (body?.scenarioReviewCompleted !== true) {
    return NextResponse.json(
      { error: 'Execute os testes orientados e confirme a revisão antes de certificar.' },
      { status: 422 },
    )
  }

  const supabase = await createClient()
  const { data: config } = await supabase.from('agent_configs').select('*').eq('id', configId).maybeSingle()
  if (!config) return NextResponse.json({ error: 'Funcionário não encontrado.' }, { status: 404 })
  const configRow = config as AgentConfig
  const { data: unit } = await supabase.from('units').select('*').eq('id', configRow.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  const unitRow = unit as Unit
  const [{ data: services }, verticalKey] = await Promise.all([
    supabase.from('services').select('*').eq('unit_id', unitRow.id).eq('is_active', true),
    fetchOrganizationVerticalKey(supabase, unitRow.org_id),
  ])
  const result = evaluateEmployeeCertification({
    config: configRow,
    verticalKey,
    services: (services ?? []) as Service[],
    scenarioReviewCompleted: body.scenarioReviewCompleted,
  })
  const now = new Date().toISOString()
  const { error } = await supabase.from('agent_configs').update({
    certification_status: result.status,
    certification_issues: result.issues,
    certified_at: result.status === 'ready' ? now : null,
    is_active: result.status === 'ready',
  }).eq('id', configId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(result, { status: result.status === 'ready' ? 200 : 422 })
}
