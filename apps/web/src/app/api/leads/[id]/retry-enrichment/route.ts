import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { ensureLeadEnrichment } from '@/lib/leads/enrichment'
import type { Lead } from '@/lib/types'

/**
 * POST /api/leads/[id]/retry-enrichment — botão administrativo "Retry
 * enrichment" (achado P1.1 da auditoria de 18-19/08/2026): antes, um lead
 * sem e-mail encontrado na primeira pesquisa ficava travado pra sempre
 * (ensureLeadEnrichment só tentava uma vez). Agora há retry automático
 * (lib/leads/enrichment.ts, migration 067), mas este endpoint permite ao
 * admin forçar uma nova tentativa NA HORA, sem esperar o próximo ciclo
 * automático — force:true ignora next_enrichment_retry_at.
 *
 * Sessão de usuário (não service client): RLS de `leads` já garante que
 * só quem tem acesso à unidade do lead (e é admin — leads_write exige
 * is_org_admin()) consegue disparar isto.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: lead } = await supabase.from('leads').select('*').eq('id', id).maybeSingle()
  if (!lead) {
    return NextResponse.json({ error: 'Lead não encontrado.' }, { status: 404 })
  }

  const updated = await ensureLeadEnrichment(supabase, lead as Lead, { force: true })

  return NextResponse.json({
    ok: true,
    enrichment_status: updated.enrichment_status,
    email: updated.email,
    enrichment_attempts: updated.enrichment_attempts,
  })
}
