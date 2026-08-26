import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getAppUser } from '@/lib/app-user'
import { getOpenAIApiKey, generateStructuredReply } from '@/lib/openai'
import {
  buildKaiOnboardingPrompt,
  extractOrganizationIntake,
  reduceInterview,
  type InterviewerOutput,
} from '@/lib/interview/engine'
import { researchCompanyWebsite } from '@/lib/company-research'
import type { InterviewTranscriptEntry, Organization } from '@/lib/types'

// Detecta uma URL solta na mensagem do dono (ex.: "www.padariaestrela.com.br"
// ou "https://..."), pra estudar o site automaticamente sem exigir um campo
// dedicado no chat — casa http(s):// opcional + domínio.tld, sem espaço.
const URL_PATTERN = /\b((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?)\b/i

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Entrevista de boas-vindas conduzida pela KAI — roda uma vez por
// organização, logo após o pagamento, ANTES de qualquer funcionário ser
// contratado. Pedido do Vinicius, 2026-08-24: "assim que o cliente novo
// entrar já abre uma tela com a KAI e ela dá as boas-vindas... e pode
// fazer uma entrevista inicial pra entender qual o segmento da empresa".
//
// Reaproveita a mesma mecânica da entrevista de contratação
// (lib/interview/engine.ts: orgIntakeTopics, reduceInterview,
// extractOrganizationIntake) mas SEM estar amarrada a um agent_configs —
// o estado (transcript + perfil em coleta) fica em
// organizations.business_profile._kai_onboarding até a entrevista
// terminar, quando é promovido pros campos reais (vertical_key +
// business_profile) e a chave temporária é removida.
//
// A escrita em organizations exige o service client (RLS
// organizations_write = is_super_admin(), ver commit do fix do Tráfego,
// 2026-08-24) — o client de sessão do usuário só serve pra leitura aqui.

type KaiIntakeState = { transcript: InterviewTranscriptEntry[]; profile: Record<string, unknown> }

function readIntakeState(org: Organization): KaiIntakeState {
  const raw = (org.business_profile as Record<string, unknown> | null)?._kai_onboarding
  if (!raw || typeof raw !== 'object') return { transcript: [], profile: {} }
  const state = raw as Partial<KaiIntakeState>
  return {
    transcript: Array.isArray(state.transcript) ? state.transcript : [],
    profile: state.profile && typeof state.profile === 'object' ? state.profile : {},
  }
}

async function loadOrg(orgId: string) {
  const supabase = await createClient()
  const { data } = await supabase.from('organizations').select('*').eq('id', orgId).maybeSingle()
  return data as Organization | null
}

function lastAssistantAskedFinal(transcript: InterviewTranscriptEntry[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const entry = transcript[i]!
    if (entry.role === 'assistant') return entry.asked_final === true
  }
  return false
}

export async function GET() {
  const appUser = await getAppUser()
  if (!appUser?.orgId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const org = await loadOrg(appUser.orgId)
  if (!org) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })

  if (org.vertical_key) {
    return NextResponse.json({ status: 'completed', transcript: [] })
  }

  const { transcript } = readIntakeState(org)
  return NextResponse.json({
    status: transcript.length > 0 ? 'in_progress' : 'pending',
    transcript: transcript.map(({ role, content }) => ({ role, content })),
  })
}

export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser?.orgId) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const message: string | null = typeof body?.message === 'string' ? body.message : null

  const org = await loadOrg(appUser.orgId)
  if (!org) return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })

  if (org.vertical_key) {
    return NextResponse.json({ reply: null, done: true, alreadyCompleted: true })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'A KAI está temporariamente indisponível (IA não configurada). Tente novamente mais tarde.' },
      { status: 503 },
    )
  }

  const { transcript: baseTranscript, profile: baseProfile } = readIntakeState(org)
  const transcript: InterviewTranscriptEntry[] =
    message && message.trim().length > 0 ? [...baseTranscript, { role: 'user', content: message.trim() }] : [...baseTranscript]

  // Estuda o site automaticamente quando o dono cola uma URL no chat —
  // best-effort: falha (site fora do ar, sem conteúdo etc.) nunca trava a
  // entrevista, a KAI só segue sem ter "lido" nada. Só tenta uma vez por
  // URL (guarda em _website_research_url) pra não reprocessar a cada turno.
  let profile = baseProfile
  const urlMatch = message?.match(URL_PATTERN)?.[1]
  if (urlMatch && profile._website_research_url !== urlMatch) {
    const research = await researchCompanyWebsite({ url: urlMatch, apiKey })
    profile = {
      ...profile,
      _website_research_url: urlMatch,
      ...(research.ok ? { _website_research: research.summary } : {}),
    }
  }

  const history = transcript.slice(-24).map(({ role, content }) => ({ role, content }))
  if (history.length === 0) {
    history.push({
      role: 'user',
      content: '(o cliente acabou de assinar o Alizo e está vendo a KAI pela primeira vez — dê boas-vindas e comece)',
    })
  }

  let output: InterviewerOutput
  try {
    output = await generateStructuredReply<InterviewerOutput>({
      apiKey,
      systemPrompt: buildKaiOnboardingPrompt({
        companyName: org.name,
        profile,
        finalAlreadyAsked: lastAssistantAskedFinal(transcript),
        websiteFindings: typeof profile._website_research === 'string' ? profile._website_research : null,
      }),
      history,
      maxTokens: 900,
    })
  } catch (error) {
    console.error('[kai-onboarding] OpenAI error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Não consegui gerar a próxima pergunta. Tente de novo.' }, { status: 502 })
  }

  const result = reduceInterview({ profile, transcript, output })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  if (result.done) {
    const orgIntake = extractOrganizationIntake(result.profile)
    const nextBusinessProfile = { ...(org.business_profile ?? {}) }
    delete nextBusinessProfile._kai_onboarding
    // Dossiê do site estudado durante esta entrevista (ver URL_PATTERN
    // acima) vira conhecimento permanente da empresa — visível a todos os
    // 6 funcionários via buildCombinedBusinessContext, igual ao
    // team_knowledge de cada entrevista individual.
    const websiteDossier = typeof result.profile._website_research === 'string' ? result.profile._website_research : null
    if (websiteDossier) nextBusinessProfile.company_dossier = websiteDossier
    const { error } = await service
      .from('organizations')
      .update({
        vertical_key: orgIntake?.vertical_key ?? 'other',
        business_profile: orgIntake ? { ...nextBusinessProfile, ...orgIntake.business_profile } : nextBusinessProfile,
      })
      .eq('id', org.id)
      .is('vertical_key', null)
    if (error) {
      console.error('[kai-onboarding] persist error:', error.message)
      return NextResponse.json({ error: 'Não foi possível salvar. Tente de novo.' }, { status: 500 })
    }
  } else {
    const { error } = await service
      .from('organizations')
      .update({
        business_profile: {
          ...(org.business_profile ?? {}),
          _kai_onboarding: { transcript: result.transcript, profile: result.profile },
        },
      })
      .eq('id', org.id)
    if (error) {
      console.error('[kai-onboarding] persist error:', error.message)
      return NextResponse.json({ error: 'Não foi possível salvar o andamento. Tente de novo.' }, { status: 500 })
    }
  }

  return NextResponse.json({ reply: result.reply, done: result.done })
}
