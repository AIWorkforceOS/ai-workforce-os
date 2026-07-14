import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { generateChatReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'
import type { AgentConfig, AgentTone, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TONE_LABEL: Record<AgentTone, string> = {
  professional: 'profissional e direto',
  friendly: 'amigável e caloroso',
  formal: 'formal e cortês',
}

/**
 * POST /api/agent/sandbox — conversa de teste com o funcionário digital
 * da unidade, usando o MESMO prompt do atendimento real, mas sem tocar
 * WhatsApp nem gravar leads/conversas. É o "test drive" do onboarding.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unitId
  const history: ChatMessage[] = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: ChatMessage) => (m?.role === 'user' || m?.role === 'assistant') && typeof m?.content === 'string')
        .slice(-12)
    : []

  if (!unitId || history.length === 0) {
    return NextResponse.json({ error: 'unitId e messages são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()
  // RLS garante que o usuário só testa unidades da própria empresa
  const [{ data: unit }, { data: config }] = await Promise.all([
    supabase.from('units').select('*').eq('id', unitId).maybeSingle(),
    supabase.from('agent_configs').select('*').eq('unit_id', unitId).eq('agent_type', 'sdr').maybeSingle(),
  ])

  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const configRow = config as AgentConfig | null
  const personaName = configRow?.persona_name ?? 'Assistente'
  const tone = TONE_LABEL[configRow?.persona_tone ?? 'friendly']

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'O teste de conversa está temporariamente indisponível. Você pode ativar o funcionário mesmo assim.' },
      { status: 503 },
    )
  }

  // Mesmo prompt do motor real (conversation-engine.buildSystemPrompt),
  // com um adendo de contexto de simulação.
  const systemPrompt = [
    `Você é ${personaName}, um agente de SDR (pré-vendas) que atende pelo WhatsApp em nome da unidade ${unitRow.name}${unitRow.region_city ? ` (${unitRow.region_city})` : ''}.`,
    `Seu tom de comunicação deve ser ${tone}.`,
    'Seu objetivo é qualificar o lead e conseguir agendar uma conversa com um vendedor humano.',
    'Responda sempre em português do Brasil, de forma breve (no máximo 3 frases curtas), sem usar markdown ou listas.',
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
