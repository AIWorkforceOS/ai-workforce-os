import type { JobOpening } from '@/lib/recruiter/types'

/** URL pública de candidatura da vaga (/vaga/[token]); usa NEXT_PUBLIC_APP_URL quando configurada. */
export function publicApplicationUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return `${base}/vaga/${token}`
}

export function serializeJob(job: JobOpening) {
  return {
    id: job.id,
    unit_id: job.unit_id,
    lead_id: job.lead_id,
    title: job.title,
    status: job.status,
    urgency: job.urgency,
    hiring_deadline: job.hiring_deadline,
    target_shortlist_size: job.target_shortlist_size,
    profile: job.profile,
    profile_missing_fields: job.profile_missing_fields,
    selected_candidate_id: job.selected_candidate_id,
    public_application_token: job.public_application_token,
    public_application_url: publicApplicationUrl(job.public_application_token),
    created_at: job.created_at,
    updated_at: job.updated_at,
  }
}
