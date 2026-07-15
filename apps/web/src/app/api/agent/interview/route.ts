import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { getOpenAIApiKey } from '@/lib/openai'
import { isInterviewAgentType, runInterviewTurn } from '@/lib/interview/engine'
import type { AgentConfig, InterviewTranscriptEntry, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Entrevista de contratação do funcionário digital (SDR, Recrutador,
// Gestor de Tráfego). GET devolve o estado atual (pra retomar de onde
// parou); POST processa um turno — message=null gera a abertura.
// Quando o próprio modelo conclui que cobriu tudo (sempre depois da
// pergunta final "tem mais alguma coisa?"), a rota marca
// interview_status='completed' e ativa o funcionário (is_active=true).

async function loadConfig(configId: string) {
  const supabase = await createClient()
  // RLS garante que o usuário só acessa configs da própria organização
  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('id', configId)
    .maybeSingle()
  if (!config) return { supabase, config: null, unit: null }

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', (config as AgentConfig).unit_id)
    .maybeSingle()
  return { supabase, config: config as AgentConfig, unit: unit as Unit | null }
}

export async function GET(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const configId = new URL(request.url).searchParams.get('configId')
  if (!configId) return NextResponse.json({ error: 'configId é obrigatório.' }, { status: 400 })

  const { config } = await loadConfig(configId)
  if (!config) {
    return NextResponse.json({ error: 'Funcionário não encontrado ou sem acesso.' }, { status: 404 })
  }

  const transcript = (config.interview_transcript ?? []) as InterviewTranscriptEntry[]
  return NextResponse.json({
    status: config.interview_status ?? 'pending',
    personaName: config.persona_name,
    agentType: config.agent_type,
    isActive: config.is_active,
    transcript: transcript.map(({ role, content }) => ({ role, content })),
  })
}

export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const configId: string | undefined = body?.configId
  const message: string | null = typeof body?.message === 'string' ? body.message : null

  if (!configId) return NextResponse.json({ error: 'configId é obrigatório.' }, { status: 400 })

  const { supabase, config, unit } = await loadConfig(configId)
  if (!config || !unit) {
    return NextResponse.json({ error: 'Funcionário não encontrado ou sem acesso.' }, { status: 404 })
  }
  if (!isInterviewAgentType(config.agent_type)) {
    return NextResponse.json({ error: 'Este tipo de agente não tem entrevista.' }, { status: 400 })
  }
  if (config.interview_status === 'completed') {
    return NextResponse.json({ reply: null, done: true, alreadyCompleted: true })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'A entrevista está temporariamente indisponível (IA não configurada). Tente novamente mais tarde.' },
      { status: 503 },
    )
  }

  let result
  try {
    result = await runInterviewTurn({ apiKey, config, unit, userMessage: message })
  } catch (error) {
    console.error('[interview] OpenAI error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Não consegui gerar a próxima pergunta. Tente de novo.' }, { status: 502 })
  }

  const update: Record<string, unknown> = {
    interview_transcript: result.transcript,
    business_profile: result.profile,
    interview_status: result.done ? 'completed' : 'in_progress',
  }
  // Entrevista concluída = funcionário pronto pra trabalhar
  if (result.done) update.is_active = true

  const { error: saveError } = await supabase.from('agent_configs').update(update).eq('id', config.id)
  if (saveError) {
    console.error('[interview] persist error:', saveError.message)
    const migrationMissing = /business_profile|interview_status|interview_transcript/.test(saveError.message)
    return NextResponse.json(
      {
        error: migrationMissing
          ? 'O banco ainda não tem as colunas da entrevista — aplique a migration 20260715000012_agent_interview.sql no Supabase.'
          : 'Não foi possível salvar o andamento da entrevista. Tente de novo.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ reply: result.reply, done: result.done })
}
