import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIApiKey } from '@/lib/openai'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import { interpretInstruction } from '@/lib/content/instruction-interpreter'
import { postsNeedingReview, type ContentInstruction, type ReviewablePost } from '@/lib/content/instructions'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const bodySchema = z.object({
  unit_id: z.string().uuid(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(4000) })).min(1).max(12),
})

/**
 * Conversa de "Instruções": devolve perguntas, a interpretação para confirmar (com conflitos e posts agendados que
 * seriam alcançados) ou o motivo do bloqueio. NÃO grava nada — a gravação é POST /api/content/instructions.
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const parsed = bodySchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success || parsed.data.messages[parsed.data.messages.length - 1]!.role !== 'user') {
    return NextResponse.json({ error: 'Dados inválidos.' }, { status: 400 })
  }
  const { unit_id, messages } = parsed.data

  const { data: unit } = await supabase.from('units').select('*').eq('id', unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })
  const apiKey = getOpenAIApiKey()
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })

  const [{ data: config }, { data: existing }, orgProfile] = await Promise.all([
    supabase.from('agent_configs').select('*').eq('unit_id', unit_id).eq('agent_type', 'content_specialist').maybeSingle(),
    supabase.from('content_instructions').select('*').eq('unit_id', unit_id).is('superseded_by', null),
    fetchOrganizationBusinessProfile(supabase, (unit as Unit).org_id ?? ''),
  ])
  const context = buildCombinedBusinessContext(orgProfile, (config as AgentConfig | null)?.business_profile ?? null)
  const timeZone = (unit as Unit).timezone || 'America/Phoenix'

  let result
  try {
    result = await interpretInstruction({
      apiKey,
      messages,
      timeZone,
      existing: (existing ?? []) as ContentInstruction[],
      companyContext: context ? context.slice(0, 1500) : null,
    })
  } catch (error) {
    console.error('[content/instructions/interpret]', error)
    return NextResponse.json({ error: 'Não consegui interpretar agora. Tente de novo em instantes.' }, { status: 502 })
  }

  if (result.kind !== 'proposal') return NextResponse.json(result)

  const { data: posts } = await supabase
    .from('content_posts')
    .select('id, status, scheduled_for, instruction_id, caption, platform')
    .eq('unit_id', unit_id)
    .in('status', ['draft', 'pending_approval', 'approved', 'scheduled'])
    .not('scheduled_for', 'is', null)
  const affected = postsNeedingReview((posts ?? []) as ReviewablePost[], result.proposal, timeZone)
  return NextResponse.json({ ...result, affectedPostCount: affected.length })
}
