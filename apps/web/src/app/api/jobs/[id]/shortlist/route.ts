import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'

export const dynamic = 'force-dynamic'

/**
 * GET /api/jobs/[id]/shortlist — dados da apresentação da shortlist
 * (§7.6): vaga + candidatos apresentados/shortlisted com relatórios.
 * Autenticado por sessão; RLS garante o escopo da org.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const appUser = await getAppUser()
  if (!appUser) return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })

  const supabase = await createClient()
  const [{ data: job }, { data: candidates }] = await Promise.all([
    supabase.from('job_openings').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('job_candidates')
      .select('*, candidates(*)')
      .eq('job_id', id)
      .in('stage', ['shortlisted', 'presented', 'approved', 'not_selected'])
      .order('ai_score', { ascending: false, nullsFirst: false }),
  ])

  if (!job) return NextResponse.json({ error: 'Vaga não encontrada ou sem acesso.' }, { status: 404 })

  return NextResponse.json({ job, shortlist: candidates ?? [] })
}
