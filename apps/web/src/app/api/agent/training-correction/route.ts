import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import type { AgentConfig, TrainingCorrectionEntry } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * POST /api/agent/training-correction — grava uma correção ensinada pelo
 * dono ao testar o funcionário na tela "Testar Funcionário" (sub-etapa 5/7).
 * Só anexa o texto da correção em agent_configs.training_corrections — NÃO
 * chama LLM nenhuma, é puramente síncrono (ver lib/agent-training.ts para
 * como isso volta a entrar no prompt de sistema real).
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const configId: string | undefined = body?.configId
  const correction = typeof body?.correction === 'string' ? body.correction.trim() : ''
  const context = typeof body?.context === 'string' ? body.context.trim() : ''

  if (!configId || !correction) {
    return NextResponse.json({ error: 'configId e correction são obrigatórios.' }, { status: 400 })
  }

  const supabase = await createClient()
  // RLS garante que o usuário só corrige funcionários da própria organização
  const { data: config } = await supabase
    .from('agent_configs')
    .select('training_corrections')
    .eq('id', configId)
    .maybeSingle()

  if (!config) {
    return NextResponse.json({ error: 'Funcionário não encontrado ou sem acesso.' }, { status: 404 })
  }

  const current = ((config as Pick<AgentConfig, 'training_corrections'>).training_corrections ??
    []) as TrainingCorrectionEntry[]
  const next: TrainingCorrectionEntry[] = [
    ...current,
    { timestamp: new Date().toISOString(), context, correction },
  ]

  const { error: saveError } = await supabase
    .from('agent_configs')
    .update({ training_corrections: next })
    .eq('id', configId)

  if (saveError) {
    console.error('[training-correction] persist error:', saveError.message)
    const migrationMissing = /training_corrections/.test(saveError.message)
    return NextResponse.json(
      {
        error: migrationMissing
          ? 'O banco ainda não tem a coluna training_corrections — aplique a migration 20260718000025_business_profile_and_verticals.sql no Supabase.'
          : 'Não foi possível salvar a correção. Tente de novo.',
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, trainingCorrections: next })
}
