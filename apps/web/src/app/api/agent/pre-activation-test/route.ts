import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIApiKey } from '@/lib/openai'
import { generatePostContent } from '@/lib/content/generator'
import { runSeoAudit } from '@/lib/seo/audit'
import { siteUrlFrom } from '@/lib/seo/planner'
import { fetchOrganizationBusinessProfile } from '@/lib/organizations'
import { getMetaConfig } from '@/lib/traffic/meta-ads'
import { getGoogleAdsConfig } from '@/lib/traffic/google-ads'
import { isDryRun } from '@/lib/traffic/launcher'
import type { AgentConfig, Unit } from '@/lib/types'

/**
 * POST /api/agent/pre-activation-test — "Test Your AI Employee" para os 3
 * funcionários que NÃO conversam com cliente simulado (item 13 do pedido de
 * prontidão pra beta: Paid Traffic, Content, SEO precisam de uma validação
 * pré-ativação, "não necessariamente baseada em chat"). Complementa
 * /api/agent/sandbox (SDR/Recruiter/Receptionist).
 *
 * Cada tipo roda a MESMA função real usada em produção (gerador de post,
 * auditoria de SEO, resolução de credenciais de ads), sem persistir nada —
 * é sempre uma pré-visualização. Nunca finge sucesso: quando a validação
 * real não é possível (sem site configurado, sem conta de anúncio
 * conectada), a resposta diz isso explicitamente em vez de simular (item 14
 * do pedido — nunca mostrar como sucesso o que não foi validado de verdade).
 */
const PRE_ACTIVATION_AGENT_TYPES = ['content_specialist', 'seo_specialist', 'traffic_specialist'] as const
type PreActivationAgentType = (typeof PRE_ACTIVATION_AGENT_TYPES)[number]

function isPreActivationAgentType(value: unknown): value is PreActivationAgentType {
  return typeof value === 'string' && (PRE_ACTIVATION_AGENT_TYPES as readonly string[]).includes(value)
}

async function runContentTest(config: AgentConfig, unit: Unit, organizationProfile: Record<string, unknown> | null) {
  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return { ok: false as const, error: 'OPENAI_API_KEY não configurada — a geração de conteúdo não está disponível agora.' }
  }
  try {
    const preview = await generatePostContent({
      apiKey,
      config,
      unit,
      organizationProfile,
      platform: 'instagram',
      pillar: null,
    })
    return { ok: true as const, preview }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : 'Erro ao gerar post de teste.' }
  }
}

async function runSeoTest(config: AgentConfig) {
  const siteUrl = siteUrlFrom(config.business_profile)
  if (!siteUrl) {
    return { ok: false as const, error: 'Nenhuma URL de site configurada no treinamento — configure antes de testar.' }
  }
  const result = await runSeoAudit({ siteUrl })
  if (result.errorMessage) {
    return { ok: false as const, error: result.errorMessage }
  }
  return { ok: true as const, preview: { score: result.score, checksCount: result.checks.length, siteUrl } }
}

async function runTrafficTest(supabase: Awaited<ReturnType<typeof createClient>>, unit: Unit) {
  const { data: accounts } = await supabase.from('ad_accounts').select('*').eq('unit_id', unit.id)
  const accountRows = (accounts ?? []) as {
    platform: 'meta' | 'google'
    external_account_id: string
    access_token: string | null
    refresh_token: string | null
    google_developer_token: string | null
    google_client_id: string | null
    google_client_secret: string | null
  }[]

  if (accountRows.length === 0) {
    return {
      ok: true as const,
      preview: {
        connected: false,
        message: 'Nenhuma conta de anúncio conectada ainda. Sem conexão real, as campanhas geradas ficam marcadas como SIMULADO — nenhuma vai ao ar de verdade.',
      },
    }
  }

  const dryRun = isDryRun()
  const connectedAccounts = accountRows.filter((account) => {
    const config = account.platform === 'meta' ? getMetaConfig(account) : getGoogleAdsConfig(account)
    return !!config
  })

  if (dryRun || connectedAccounts.length === 0) {
    return {
      ok: true as const,
      preview: {
        connected: false,
        message: dryRun
          ? 'TRAFFIC_DRY_RUN está ativo neste ambiente — nenhuma campanha vai ao ar de verdade, mesmo com conta conectada.'
          : `${accountRows.length} conta(s) cadastrada(s), mas sem credenciais válidas — as campanhas ficam marcadas como SIMULADO.`,
      },
    }
  }

  return {
    ok: true as const,
    preview: {
      connected: true,
      message: `${connectedAccounts.length} de ${accountRows.length} conta(s) com credenciais válidas — campanhas geradas a partir de agora vão ao ar de verdade nessas contas.`,
    },
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const unitId: string | undefined = body?.unitId
  const agentType: unknown = body?.agentType

  if (!unitId || !isPreActivationAgentType(agentType)) {
    return NextResponse.json({ error: 'unitId e agentType (content_specialist | seo_specialist | traffic_specialist) são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()
  // RLS garante que o usuário só testa unidades da própria empresa.
  const [{ data: unit }, { data: config }] = await Promise.all([
    supabase.from('units').select('*').eq('id', unitId).maybeSingle(),
    supabase.from('agent_configs').select('*').eq('unit_id', unitId).eq('agent_type', agentType).maybeSingle(),
  ])

  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada ou sem acesso.' }, { status: 404 })
  }
  if (!config) {
    return NextResponse.json({ error: 'Funcionário ainda não foi treinado nesta unidade.' }, { status: 404 })
  }

  const unitRow = unit as Unit
  const configRow = config as AgentConfig

  let result: { ok: boolean; error?: string; preview?: Record<string, unknown> }
  switch (agentType) {
    case 'content_specialist': {
      const organizationProfile = await fetchOrganizationBusinessProfile(supabase, unitRow.org_id)
      result = await runContentTest(configRow, unitRow, organizationProfile)
      break
    }
    case 'seo_specialist':
      result = await runSeoTest(configRow)
      break
    case 'traffic_specialist':
      result = await runTrafficTest(supabase, unitRow)
      break
  }

  return NextResponse.json(result, { status: result.ok ? 200 : 422 })
}
