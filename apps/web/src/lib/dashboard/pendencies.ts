// Central do Dia (Fase 3) — lista de pendências acionáveis da home do
// cliente. Fica em .ts puro (sem Supabase, sem JSX) de propósito: toda a
// lógica de "o que é pendência e em que ordem aparece" é testável sem
// mock de banco; quem busca os dados fica em home-views.tsx (server
// component, só monta os inputs e chama buildTodayPendencies).
//
// Princípio do briefing seguido aqui: "não use métricas decorativas, toda
// informação deve ajudar a tomar uma decisão" — por isso cada Pendency
// carrega href+ctaLabel (o botão que resolve), não só um número.

export type PendencyPriority = 'urgente' | 'decisao' | 'atencao'

const PRIORITY_RANK: Record<PendencyPriority, number> = { urgente: 0, decisao: 1, atencao: 2 }

export type Pendency = {
  id: string
  priority: PendencyPriority
  title: string
  description: string
  /** ISO — quando a pendência surgiu, pra "há Xmin" na UI e pra ordenar as mais antigas primeiro dentro da mesma prioridade */
  since: string
  href: string
  ctaLabel: string
}

/**
 * Dado o histórico bruto de eventos de intervenção humana (system_events,
 * tipos human_operator_message/human_intervention_released) de uma unidade
 * dentro da janela de 40min, devolve só os contatos cujo evento MAIS
 * RECENTE foi a trava (ainda aguardando humano agora) — mesma regra de
 * lib/human-intervention.ts:latestInterventionEventType, mas pra todos os
 * contatos de uma vez (a home não pode fazer 1 query por contato).
 */
export function groupLatestInterventions(
  events: { contactId: string; eventType: 'human_operator_message' | 'human_intervention_released'; createdAt: string }[],
): { contactId: string; since: string }[] {
  const latestByContact = new Map<string, { eventType: string; createdAt: string }>()
  // Assume input já ordenado do mais recente pro mais antigo (mesmo padrão da query original) — só guarda a primeira ocorrência de cada contato.
  for (const event of events) {
    if (!latestByContact.has(event.contactId)) {
      latestByContact.set(event.contactId, { eventType: event.eventType, createdAt: event.createdAt })
    }
  }
  const result: { contactId: string; since: string }[] = []
  for (const [contactId, latest] of latestByContact) {
    if (latest.eventType === 'human_operator_message') {
      result.push({ contactId, since: latest.createdAt })
    }
  }
  return result
}

export function buildTodayPendencies(input: {
  waitingHuman: { contactId: string; contactName: string; since: string }[]
  shortlistedCandidates: { id: string; candidateName: string; jobTitle: string; since: string }[]
  pendingContent: { id: string; caption: string; since: string }[]
  integrationErrors: { source: string; count: number; since: string }[]
}): Pendency[] {
  const items: Pendency[] = []

  for (const w of input.waitingHuman) {
    items.push({
      id: `waiting-human-${w.contactId}`,
      priority: 'decisao',
      title: `${w.contactName} está aguardando você`,
      description: 'Um humano assumiu essa conversa — a resposta automática está pausada até você responder ou devolver.',
      since: w.since,
      href: `/dashboard/conversations`,
      ctaLabel: 'Ver conversa',
    })
  }

  for (const c of input.shortlistedCandidates) {
    items.push({
      id: `candidate-${c.id}`,
      priority: 'decisao',
      title: `${c.candidateName} está na shortlist de "${c.jobTitle}"`,
      description: 'O Recrutador já fez a triagem — falta sua decisão de avançar ou não.',
      since: c.since,
      href: `/dashboard/recruiter`,
      ctaLabel: 'Ver candidato',
    })
  }

  for (const p of input.pendingContent) {
    items.push({
      id: `content-${p.id}`,
      priority: 'decisao',
      title: 'Post aguardando sua aprovação',
      description: p.caption.length > 80 ? `${p.caption.slice(0, 80)}…` : p.caption,
      since: p.since,
      href: `/dashboard/content`,
      ctaLabel: 'Revisar post',
    })
  }

  for (const e of input.integrationErrors) {
    items.push({
      id: `error-${e.source}`,
      priority: 'urgente',
      title: `Falha em ${e.source} nas últimas 24h`,
      description: e.count > 1 ? `${e.count} ocorrências — pode estar afetando o atendimento.` : 'Pode estar afetando o atendimento.',
      since: e.since,
      href: `/dashboard/settings`,
      ctaLabel: 'Ver detalhes',
    })
  }

  return items.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    if (rankDiff !== 0) return rankDiff
    return new Date(a.since).getTime() - new Date(b.since).getTime()
  })
}

/** "há 5min" / "há 2h" / "há 3 dias" — nunca precisão de segundos (não ajuda a decisão, só polui). */
export function relativeTimeFromNow(iso: string, now: Date): string {
  const diffMs = now.getTime() - new Date(iso).getTime()
  const minutes = Math.max(0, Math.round(diffMs / 60_000))
  if (minutes < 1) return 'agora mesmo'
  if (minutes < 60) return `há ${minutes}min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  return `há ${days} dia${days > 1 ? 's' : ''}`
}
