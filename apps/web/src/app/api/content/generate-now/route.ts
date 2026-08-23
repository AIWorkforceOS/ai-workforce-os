import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getOpenAIApiKey } from '@/lib/openai'
import { generateSinglePostForAccount } from '@/lib/content/single-post'
import type { ContentPost, SocialAccount } from '@/lib/content/types'
import type { AgentConfig, Unit } from '@/lib/types'

export const maxDuration = 60

/**
 * Botão "Criar conteúdo agora" (pedido do Vinicius, 2026-08-23): gera UM
 * post pra hoje, na hora, sem esperar o cron diário rodar sozinho amanhã
 * de manhã. Mesma lógica e as mesmas regras do cron avulso
 * (lib/content/single-post.ts) — só muda quem disparou (clique humano, não
 * o relógio). A sessão só confirma que o usuário tem acesso à unidade; a
 * geração de verdade roda com o service role (mesmo padrão de
 * content/posts/[id]/route.ts).
 *
 * POST { unit_id, social_account_id? }
 */
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  let body: { unit_id?: string; social_account_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido.' }, { status: 400 })
  }
  if (!body.unit_id) return NextResponse.json({ error: 'unit_id é obrigatório.' }, { status: 400 })

  // RLS de units já restringe a leitura à(s) unidade(s) que este usuário pode acessar.
  const { data: unit } = await supabase.from('units').select('*').eq('id', body.unit_id).maybeSingle()
  if (!unit) return NextResponse.json({ error: 'Unidade não encontrada ou sem permissão.' }, { status: 404 })

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('agent_type', 'content_specialist')
    .eq('is_active', true)
    .maybeSingle()
  if (!config) {
    return NextResponse.json({ error: 'O Gestor de Conteúdo ainda não está ativo nesta unidade — complete a contratação primeiro.' }, { status: 400 })
  }

  let accountQuery = supabase
    .from('social_accounts')
    .select('*')
    .eq('unit_id', unit.id)
    .eq('is_active', true)
    .eq('connection_status', 'connected')
  if (body.social_account_id) accountQuery = accountQuery.eq('id', body.social_account_id)
  const { data: account } = await accountQuery.limit(1).maybeSingle()
  if (!account) return NextResponse.json({ error: 'Nenhuma conta conectada encontrada — conecte o Instagram/Facebook primeiro.' }, { status: 404 })

  const apiKey = getOpenAIApiKey()
  if (!apiKey) return NextResponse.json({ error: 'OPENAI_API_KEY não configurada.' }, { status: 500 })

  const service = createServiceClient()
  if (!service) return NextResponse.json({ error: 'Serviço não configurado (service role).' }, { status: 500 })

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const { data: recent } = await service
    .from('content_posts')
    .select('platform, content_pillar, created_at, caption, image_prompt')
    .eq('social_account_id', account.id)
    .gte('created_at', sevenDaysAgo.toISOString())
    .order('created_at', { ascending: false })
    .limit(50)
  const recentPosts = (recent ?? []) as Pick<ContentPost, 'platform' | 'content_pillar' | 'created_at' | 'caption' | 'image_prompt'>[]

  const outcome = await generateSinglePostForAccount({
    supabase: service,
    apiKey,
    config: config as AgentConfig,
    unit: unit as Unit,
    account: account as SocialAccount,
    recentPosts,
  })

  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 })
  return NextResponse.json({ post: outcome.post, published: outcome.published, publishError: outcome.publishError })
}
