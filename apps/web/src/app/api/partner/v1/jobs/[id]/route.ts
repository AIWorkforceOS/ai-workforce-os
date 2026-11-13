import { NextResponse } from 'next/server'
import { authenticatePartner, isPartnerContext, partnerError, resolvePartnerUnit } from '@/lib/partner-api/auth'
import { serializeJob } from '@/lib/partner-api/serialize-recruiter'
import type { JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

/** GET /api/partner/v1/jobs/{id} (escopo jobs:read) */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await authenticatePartner(request, 'jobs:read')
  if (!isPartnerContext(ctx)) return ctx

  const { id } = await params
  const { data } = await ctx.supabase.from('job_openings').select('*').eq('id', id).maybeSingle()
  const job = data as JobOpening | null
  if (!job) return partnerError(404, 'Vaga não encontrada.')

  const unit = await resolvePartnerUnit(ctx, { unitId: job.unit_id })
  if (!unit) return partnerError(404, 'Vaga não encontrada.')

  return NextResponse.json({ job: serializeJob(job) })
}
