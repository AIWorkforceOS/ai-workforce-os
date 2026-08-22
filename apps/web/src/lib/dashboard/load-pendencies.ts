import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTodayPendencies, groupLatestInterventions, type Pendency } from '@/lib/dashboard/pendencies'
import { HUMAN_INTERVENTION_LOCK_MINUTES } from '@/lib/human-intervention'

// Busca os dados brutos das 4 fontes de pendência da Central do Dia (Fase
// 3) e monta a lista final via buildTodayPendencies (lógica pura, testada
// separadamente em lib/dashboard/__tests__/pendencies.test.ts). Fica fora
// de home-views.tsx pra manter a busca de dados isolada da lógica de
// montagem/ordenação.

function scopedToUnit<Q>(query: Q, unitId: string | null): Q {
  if (!unitId) return query
  return (query as { eq(column: string, value: string): unknown }).eq('unit_id', unitId) as Q
}

export async function loadTodayPendencies(supabase: SupabaseClient, unitId: string | null, now: Date): Promise<Pendency[]> {
  const since40min = new Date(now.getTime() - HUMAN_INTERVENTION_LOCK_MINUTES * 60 * 1000)
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)

  const [{ data: interventionRows }, { data: candidateRows }, { data: contentRows }, { data: errorRows }] = await Promise.all([
    scopedToUnit(
      supabase
        .from('system_events')
        .select('event_type, metadata, created_at')
        .in('event_type', ['human_operator_message', 'human_intervention_released'])
        .gte('created_at', since40min.toISOString())
        .order('created_at', { ascending: false })
        .limit(200),
      unitId,
    ),
    scopedToUnit(supabase.from('job_candidates').select('id, job_id, candidate_id, updated_at').eq('stage', 'shortlisted'), unitId),
    scopedToUnit(supabase.from('content_posts').select('id, caption, created_at').eq('status', 'pending_approval'), unitId),
    scopedToUnit(
      supabase.from('system_events').select('source, created_at').eq('level', 'error').gte('created_at', since24h.toISOString()),
      unitId,
    ),
  ])

  // 1) Conversas aguardando humano — dedup pelo evento mais recente por contato, depois resolve o nome (lead ou cliente cadastrado).
  const events = ((interventionRows ?? []) as { event_type: string; metadata: Record<string, unknown> | null; created_at: string }[])
    .map((row) => ({
      contactId: String((row.metadata as Record<string, unknown> | null)?.contact_id ?? ''),
      eventType: row.event_type as 'human_operator_message' | 'human_intervention_released',
      createdAt: row.created_at,
    }))
    .filter((e) => e.contactId.length > 0)
  const activeInterventions = groupLatestInterventions(events)

  const contactNames = new Map<string, string>()
  if (activeInterventions.length > 0) {
    const contactIds = activeInterventions.map((i) => i.contactId)
    const [{ data: leadRows }, { data: customerRows }] = await Promise.all([
      supabase.from('leads').select('id, contact_name, company_name').in('id', contactIds),
      supabase.from('customers').select('id, name').in('id', contactIds),
    ])
    for (const lead of (leadRows ?? []) as { id: string; contact_name: string | null; company_name: string }[]) {
      contactNames.set(lead.id, lead.contact_name ?? lead.company_name)
    }
    for (const customer of (customerRows ?? []) as { id: string; name: string }[]) {
      contactNames.set(customer.id, customer.name)
    }
  }
  const waitingHuman = activeInterventions.map((i) => ({
    contactId: i.contactId,
    contactName: contactNames.get(i.contactId) ?? 'Um contato',
    since: i.since,
  }))

  // 2) Candidatos na shortlist — resolve nome do candidato e título da vaga.
  const candidateJcs = (candidateRows ?? []) as { id: string; job_id: string; candidate_id: string; updated_at: string }[]
  let shortlistedCandidates: { id: string; candidateName: string; jobTitle: string; since: string }[] = []
  if (candidateJcs.length > 0) {
    const [{ data: candidatesData }, { data: jobsData }] = await Promise.all([
      supabase.from('candidates').select('id, name').in('id', candidateJcs.map((jc) => jc.candidate_id)),
      supabase.from('job_openings').select('id, title').in('id', candidateJcs.map((jc) => jc.job_id)),
    ])
    const candidateNames = new Map(((candidatesData ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
    const jobTitles = new Map(((jobsData ?? []) as { id: string; title: string }[]).map((j) => [j.id, j.title]))
    shortlistedCandidates = candidateJcs.map((jc) => ({
      id: jc.id,
      candidateName: candidateNames.get(jc.candidate_id) ?? 'Candidato',
      jobTitle: jobTitles.get(jc.job_id) ?? 'vaga',
      since: jc.updated_at,
    }))
  }

  // 3) Conteúdo aguardando aprovação
  const pendingContent = ((contentRows ?? []) as { id: string; caption: string; created_at: string }[]).map((p) => ({
    id: p.id,
    caption: p.caption,
    since: p.created_at,
  }))

  // 4) Falhas de integração — agrupa por origem, mantém a ocorrência mais recente
  const errorsBySource = new Map<string, { count: number; since: string }>()
  for (const row of (errorRows ?? []) as { source: string; created_at: string }[]) {
    const current = errorsBySource.get(row.source)
    if (!current || row.created_at > current.since) {
      errorsBySource.set(row.source, { count: (current?.count ?? 0) + 1, since: row.created_at })
    } else {
      current.count += 1
    }
  }
  const integrationErrors = Array.from(errorsBySource.entries()).map(([source, v]) => ({ source, count: v.count, since: v.since }))

  return buildTodayPendencies({ waitingHuman, shortlistedCandidates, pendingContent, integrationErrors })
}
