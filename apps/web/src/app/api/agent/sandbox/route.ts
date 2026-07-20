import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { generateChatReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import { buildSystemPrompt } from '@/lib/conversation-engine'
import { buildRecruiterBasePrompt } from '@/lib/recruiter/prompts'
import { buildReceptionistSystemPrompt } from '@/lib/receptionist/prompt'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import type { AgentConfig, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * POST /api/agent/sandbox — conversa de teste com o funcionário digital
 * da unidade, usando o MESMO prompt do atendimento real, mas sem tocar
 * WhatsApp nem gravar leads/conversas/clientes. É o "test drive" tanto do
 * onboarding (AI Sales Representative, `agentType` omitido = 'sdr') quanto
 * da tela "Testar Funcionário" (equipe-digital), que também cobre Recruiter
 * e Receptionist. Tráfego fica fora: seu único uso de LLM é um resumo
 * executivo sobre métricas agregadas, não uma conversa com cliente
 * simulado — não faz sentido nesta simulação.
 */
const SANDBOX_AGENT_TYPES = ['sdr', 'recruiter', 'receptionist'] as const
type SandboxAgentType = (typeof SANDBOX_AGENT_TYPES)[number]

function isSandboxAgentType(value: unknown): value is SandboxAgentType {
  return typeof value === 'string' && (SANDBOX_AGENT_TYPES as readonly string[]).includes(value)
}

function buildAgentSystemPrompt(
  agentType: SandboxAgentType,
  config: AgentConfig,
  unit: Unit,
  organizationProfile: Record<string, unknown> | null,
): string {
  switch (agentType) {
    case 'sdr':
      return buildSystemPrompt(config, unit, undefined, organizationProfile)
    case 'recruiter':
      return buildRecruiterBasePrompt(config, unit, organizationProfile)
    case 'receptionist':
      return buildReceptionistSystemPrompt(config, unit, organizationProfile)
  }
}

export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unitId
  // Omitido = 'sdr' (compatibilidade com o wizard de onboarding, que só testa o Sales Rep).
  const agentType: unknown = body?.agentType ?? 'sdr'
  const history: ChatMessage[] = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-12)
    : []

  if (!unitId || history.length === 0) {
    return NextResponse.json({ error: 'unitId e messages são obrigatórios.' }, { status: 400 })
  }
  if (!isSandboxAgentType(agentType)) {
    return NextResponse.json({ error: 'agentType inválido.' }, { status: 400 })
  }

  const supabase = await createClient()
  // RLS garante que o usuário só testa unidades da própria empresa
  const [{ data: unit }, { data: config }] = await Promise.all([
    supabase.from('units').select('*').eq('id', unitId).maybeSingle(),
    supabase.from('agent_configs').select('*').eq('unit_id', unitId).eq('agent_type', agentType).maybeSingle(),
  ])

  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const configRow = config as AgentConfig | null

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'O teste de conversa está temporariamente indisponível. Você pode ativar o funcionário mesmo assim.' },
      { status: 503 },
    )
  }

  // Ficha da Empresa compartilhada (organizations.business_profile) — mesma
  // fonte usada nas conversas reais dos 3 funcionários (buildCombinedBusinessContext).
  const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unitRow.org_id)

  // Mesmo prompt do motor real, com um adendo de contexto de simulação.
  const fallbackConfig = {
    persona_name: 'Assistente',
    persona_tone: 'friendly',
  } as AgentConfig
  const systemPrompt = [
    buildAgentSystemPrompt(agentType, configRow ?? fallbackConfig, unitRow, organizationProfile),
    'Esta é uma conversa de TESTE feita pelo dono da empresa para ver como você responde — atenda normalmente, como se fosse um cliente real.',
  ].join(' ')

  try {
    const reply = await generateChatReply({ apiKey, systemPrompt, history })
    return NextResponse.json({ reply })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao gerar resposta de teste.' },
      { status: 502 },
    )
  }
}
