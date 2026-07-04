import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const { data: jobs } = await supabase
    .from('prospecting_jobs')
    .select('*')
    .eq('unit_id', id)
    .order('created_at', { ascending: false })
    .limit(5)

  return NextResponse.json({ jobs: jobs ?? [] })
}
