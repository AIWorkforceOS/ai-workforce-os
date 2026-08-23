import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { AgentConfig } from '@/lib/types'

/**
 * Dias da semana em que o Gestor de Conteúdo publica (planejamento
 * semanal, pedido do Vinicius 2026-08-23) — ex: [1,3,5] = seg/qua/sex.
 * Guardado em agent_configs.business_profile.dias_publicacao (ver
 * lib/content/planner.ts, postingDaysFrom). Escrita direta pela sessão —
 * agent_configs (diferente de organizations) já permite update de org
 * admin via RLS (can_access_unit + is_org_admin).
 *
 * PATCH { unit_id, dias_publicacao: number[] }  — 1=segunda ... 7=domingo
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; dias_publicacao?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.unit_id) return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })
  if (!Array.isArray(body.dias_publicacao) || body.dias_publicacao.some((d) => typeof d !== 'number' || d < 1 || d > 7)) {
    return NextResponse.json({ error: 'dias_publicacao deve ser uma lista de números de 1 (segunda) a 7 (domingo).' }, { status: 400 })
  }
  const days = [...new Set(body.dias_publicacao as number[])].sort((a, b) => a - b)

  const { data: config } = await supabase
    .from('agent_configs')
    .select('id, business_profile')
    .eq('unit_id', body.unit_id)
    .eq('agent_type', 'content_specialist')
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ error: 'Gestor de Conteúdo não encontrado nesta unidade, ou sem permissão.' }, { status: 404 })
  }

  const currentProfile = ((config as Pick<AgentConfig, 'business_profile'>).business_profile ?? {}) as Record<string, unknown>
  const { error } = await supabase
    .from('agent_configs')
    .update({ business_profile: { ...currentProfile, dias_publicacao: days } })
    .eq('id', config.id)

  if (error) return NextResponse.json({ error: 'Não foi possível salvar os dias de publicação. Tente de novo.' }, { status: 500 })
  return NextResponse.json({ dias_publicacao: days })
}
