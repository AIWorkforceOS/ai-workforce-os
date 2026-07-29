import type { SupabaseClient } from '@supabase/supabase-js'
import { connectInstance, getEvolutionConfig, getInstanceStatus } from '@/lib/evolution'
import { testGoogleAdsConnection, testMetaConnection } from '@/lib/traffic/connection-test'
import { testSocialConnection } from '@/lib/content/connection-test'
import { logSystemEvent } from '@/lib/system-events'
import type { AdAccount } from '@/lib/traffic/types'
import type { SocialAccount } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

// Ações reais que a Kai pode executar durante o chat (em vez de só orientar
// o cliente a navegar até outra tela) — tool calling da OpenAI. Cada tool
// reaproveita EXATAMENTE a mesma lógica das rotas/telas dedicadas (gerar QR
// do WhatsApp, testar conta de anúncio/social), então o resultado é sempre
// uma ação real no banco, nunca uma simulação.
//
// Escopo deliberadamente pequeno e de baixo risco: só leitura + ações
// idempotentes/reversíveis já expostas em outras telas pro próprio cliente.
// Nada de canal SMS/Twilio aqui (fora do escopo desta rodada).

export type ChatToolName =
  | 'generate_whatsapp_qr'
  | 'check_whatsapp_status'
  | 'retest_ad_account_connection'
  | 'retest_social_account_connection'

export const CHAT_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'generate_whatsapp_qr' as ChatToolName,
      description:
        'Gera um QR code novo pra conectar o WhatsApp de uma unidade da empresa, exibido direto na conversa. Use quando o cliente pedir pra conectar, reconectar, ou gerar um QR code do WhatsApp.',
      parameters: {
        type: 'object',
        properties: {
          unit_name: {
            type: 'string',
            description: 'Nome da unidade, só se o cliente tiver mais de uma e tiver dito qual. Omita se não souber.',
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'check_whatsapp_status' as ChatToolName,
      description: 'Confere agora, de verdade, se o WhatsApp de uma unidade está conectado. Use quando o cliente perguntar se está conectado ou disser que não tem certeza.',
      parameters: {
        type: 'object',
        properties: {
          unit_name: { type: 'string', description: 'Nome da unidade, se houver mais de uma. Omita se não souber.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'retest_ad_account_connection' as ChatToolName,
      description:
        'Testa de novo, com uma chamada real na API, uma conta de anúncio (Meta Ads ou Google Ads) que o cliente já tentou conectar antes e ficou pendente ou com erro. Use quando o cliente disser que já compartilhou a conta/aceitou o convite e quer que você confirme se funcionou, em vez de mandar ele voltar pra tela de conexão.',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', enum: ['meta', 'google'], description: 'Qual plataforma testar, se o cliente especificou.' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'retest_social_account_connection' as ChatToolName,
      description:
        'Testa de novo, com uma chamada real na API, a Página do Facebook/Instagram que o cliente já tentou conectar antes e ficou pendente ou com erro. Use quando o cliente disser que já compartilhou a Página e quer confirmação.',
      parameters: { type: 'object', properties: {} },
    },
  },
]

/** Conteúdo especial que o front-end do chat renderiza além do texto (ex.: a imagem do QR code). */
export type ChatClientAction =
  | { type: 'whatsapp_qr'; qrCode: string; unitName: string }
  | { type: 'connection_result'; ok: boolean; label: string }

export type ChatToolResult = {
  /** texto que volta pro modelo terminar a resposta em linguagem natural */
  forModel: string
  clientAction?: ChatClientAction
}

async function resolveUnit(
  supabase: SupabaseClient,
  unitName?: string,
): Promise<{ unit: Unit } | { error: string }> {
  const { data } = await supabase
    .from('units')
    .select('*')
    .order('created_at', { ascending: true })
  const units = (data ?? []) as Unit[]

  if (units.length === 0) return { error: 'A empresa ainda não tem nenhuma unidade cadastrada.' }
  if (units.length === 1) return { unit: units[0]! }

  if (unitName) {
    const match = units.find((u) => u.name.toLowerCase().includes(unitName.toLowerCase()))
    if (match) return { unit: match }
  }

  return { error: `A empresa tem mais de uma unidade (${units.map((u) => u.name).join(', ')}) — pergunte pro cliente qual delas antes de chamar esta ação de novo, passando o nome dela.` }
}

async function runGenerateWhatsappQr(supabase: SupabaseClient, unitName?: string): Promise<ChatToolResult> {
  const resolved = await resolveUnit(supabase, unitName)
  if ('error' in resolved) return { forModel: resolved.error }
  const { unit } = resolved

  const config = getEvolutionConfig(unit)
  if (!config) {
    return { forModel: 'O serviço de WhatsApp ainda não está habilitado pra essa unidade — oriente o cliente a chamar suporte@alizo.com.br.' }
  }

  if (!unit.evolution_instance_name) {
    await supabase.from('units').update({ evolution_instance_name: config.instanceName }).eq('id', unit.id)
  }

  try {
    const data = await connectInstance(config)
    const qrCode: string | null = data?.base64 ?? data?.qrcode?.base64 ?? null
    if (!qrCode) {
      return { forModel: `Não veio um QR code válido pra unidade ${unit.name} — peça pro cliente tentar de novo em instantes, ou usar a tela normal de conexão.` }
    }
    return {
      forModel: `QR code gerado com sucesso pra unidade ${unit.name}. Ele já está sendo exibido na conversa — instrua o cliente a abrir WhatsApp > Dispositivos conectados > Conectar dispositivo e escanear.`,
      clientAction: { type: 'whatsapp_qr', qrCode, unitName: unit.name },
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    return { forModel: `Falha ao gerar o QR code da unidade ${unit.name}: ${message}. Sugira tentar de novo em instantes ou chamar o suporte se persistir.` }
  }
}

async function runCheckWhatsappStatus(supabase: SupabaseClient, unitName?: string): Promise<ChatToolResult> {
  const resolved = await resolveUnit(supabase, unitName)
  if ('error' in resolved) return { forModel: resolved.error }
  const { unit } = resolved

  const config = getEvolutionConfig(unit)
  if (!config) return { forModel: `WhatsApp ainda não habilitado pra unidade ${unit.name}.` }

  try {
    const status = await getInstanceStatus(config)
    const label =
      status === 'open'
        ? 'conectado e funcionando'
        : status === 'connecting'
          ? 'com QR code gerado, aguardando o cliente escanear'
          : status === 'not_configured'
            ? 'ainda não configurado'
            : 'desconectado'
    return { forModel: `Status real do WhatsApp da unidade ${unit.name}: ${label}.` }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'erro desconhecido'
    return { forModel: `Não foi possível checar o status agora (${message}). Sugira tentar de novo.` }
  }
}

async function runRetestAdAccount(
  supabase: SupabaseClient,
  orgId: string | null,
  platform?: string,
): Promise<ChatToolResult> {
  let query = supabase.from('ad_accounts').select('*').neq('connection_status', 'connected')
  if (platform === 'meta' || platform === 'google') query = query.eq('platform', platform)
  const { data } = await query.order('created_at', { ascending: false }).limit(1)
  const account = ((data ?? [])[0] ?? null) as AdAccount | null

  if (!account) {
    return { forModel: 'Não encontrei nenhuma conta de anúncio pendente ou com erro pra essa empresa. Se o cliente ainda não conectou nenhuma, oriente a ir em Tráfego > Conectar contas.' }
  }

  const test =
    account.platform === 'meta'
      ? await testMetaConnection({ externalAccountId: account.external_account_id, accessToken: account.access_token })
      : await testGoogleAdsConnection({
          externalAccountId: account.external_account_id,
          refreshToken: account.refresh_token,
          developerToken: account.google_developer_token,
          clientId: account.google_client_id,
          clientSecret: account.google_client_secret,
        })

  await supabase
    .from('ad_accounts')
    .update({
      connection_status: test.ok ? 'connected' : 'error',
      connection_error: test.ok ? null : test.error,
    })
    .eq('id', account.id)

  await logSystemEvent(supabase, {
    level: test.ok ? 'info' : 'warning',
    source: account.platform === 'meta' ? 'meta_ads' : 'google_ads',
    eventType: test.ok ? 'traffic_chat_retest_ok' : 'traffic_chat_retest_failed',
    message: test.ok
      ? `Kai reconfirmou a conexão da conta "${test.label}" (${account.platform}) via chat.`
      : `Kai retestou a conta ${account.external_account_id} (${account.platform}) via chat e continua falhando: ${test.rawError}`,
    orgId: orgId ?? account.org_id,
    unitId: account.unit_id,
  })

  return {
    forModel: test.ok
      ? `Testei agora a conta de anúncio ${account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'} (${account.name || account.external_account_id}) e funcionou: ${test.label}. Já está marcada como conectada.`
      : `Testei agora a conta de anúncio ${account.platform === 'meta' ? 'Meta Ads' : 'Google Ads'} (${account.name || account.external_account_id}) e ainda não funcionou: ${test.error}`,
    clientAction: { type: 'connection_result', ok: test.ok, label: test.ok ? test.label : test.error },
  }
}

async function runRetestSocialAccount(supabase: SupabaseClient, orgId: string | null): Promise<ChatToolResult> {
  const { data } = await supabase
    .from('social_accounts')
    .select('*')
    .neq('connection_status', 'connected')
    .order('created_at', { ascending: false })
    .limit(1)
  const account = ((data ?? [])[0] ?? null) as SocialAccount | null

  if (!account) {
    return { forModel: 'Não encontrei nenhuma Página pendente ou com erro pra essa empresa. Se o cliente ainda não conectou nenhuma, oriente a ir em Conteúdo > Conectar.' }
  }

  const test = await testSocialConnection({ pageId: account.page_id, pageAccessToken: account.page_access_token })

  await supabase
    .from('social_accounts')
    .update({
      connection_status: test.ok ? 'connected' : 'error',
      connection_error: test.ok ? null : test.error,
      ...(test.ok ? { instagram_business_account_id: test.instagramBusinessAccountId, instagram_username: test.instagramUsername } : {}),
    })
    .eq('id', account.id)

  await logSystemEvent(supabase, {
    level: test.ok ? 'info' : 'warning',
    source: 'content',
    eventType: test.ok ? 'content_chat_retest_ok' : 'content_chat_retest_failed',
    message: test.ok
      ? `Kai reconfirmou a conexão da Página "${test.label}" via chat.`
      : `Kai retestou a Página ${account.page_id} via chat e continua falhando: ${test.rawError}`,
    orgId: orgId ?? account.org_id,
    unitId: account.unit_id,
  })

  return {
    forModel: test.ok
      ? `Testei agora a Página (${account.page_name || account.page_id}) e funcionou: ${test.label}.`
      : `Testei agora a Página (${account.page_name || account.page_id}) e ainda não funcionou: ${test.error}`,
    clientAction: { type: 'connection_result', ok: test.ok, label: test.ok ? test.label : test.error },
  }
}

export async function executeChatTool(
  supabase: SupabaseClient,
  orgId: string | null,
  name: string,
  rawArgs: string,
): Promise<ChatToolResult> {
  let args: Record<string, unknown> = {}
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {}
  } catch {
    // args malformados do modelo — segue com objeto vazio em vez de falhar a ação inteira
  }

  switch (name) {
    case 'generate_whatsapp_qr':
      return runGenerateWhatsappQr(supabase, typeof args.unit_name === 'string' ? args.unit_name : undefined)
    case 'check_whatsapp_status':
      return runCheckWhatsappStatus(supabase, typeof args.unit_name === 'string' ? args.unit_name : undefined)
    case 'retest_ad_account_connection':
      return runRetestAdAccount(supabase, orgId, typeof args.platform === 'string' ? args.platform : undefined)
    case 'retest_social_account_connection':
      return runRetestSocialAccount(supabase, orgId)
    default:
      return { forModel: `Ação desconhecida: ${name}.` }
  }
}
