// Rótulos e cores compartilhados pelas telas do Recruiter (dashboard).

export const JOB_STATUS_LABEL: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Rascunho', color: '#cbd5e1', bg: 'rgba(255,255,255,0.08)' },
  profiling: { label: 'Levantando perfil', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
  profile_ready: { label: 'Perfil pronto', color: '#60a5fa', bg: 'rgba(59,130,246,0.15)' },
  sourcing: { label: 'Buscando candidatos', color: '#22d3ee', bg: 'rgba(6,182,212,0.15)' },
  sourcing_expanded: { label: 'Busca ampliada', color: '#22d3ee', bg: 'rgba(6,182,212,0.15)' },
  outreach: { label: 'Contatando candidatos', color: '#a78bfa', bg: 'rgba(139,92,246,0.15)' },
  screening: { label: 'Triagem', color: '#a78bfa', bg: 'rgba(139,92,246,0.15)' },
  shortlist_ready: { label: 'Shortlist pronta', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)' },
  presented: { label: 'Apresentada', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)' },
  company_review: { label: 'Empresa avaliando', color: '#fbbf24', bg: 'rgba(245,158,11,0.15)' },
  candidate_selected: { label: 'Candidato escolhido', color: '#4ade80', bg: 'rgba(34,197,94,0.15)' },
  handed_off: { label: 'Entregue ao humano', color: '#4ade80', bg: 'rgba(34,197,94,0.15)' },
  closed: { label: 'Encerrada', color: '#4ade80', bg: 'rgba(34,197,94,0.15)' },
  stalled: { label: 'Parada', color: '#f87171', bg: 'rgba(239,68,68,0.15)' },
  escalated_human: { label: 'Escalada p/ humano', color: '#f87171', bg: 'rgba(239,68,68,0.15)' },
  cancelled: { label: 'Cancelada', color: '#94a3b8', bg: 'rgba(255,255,255,0.06)' },
  expired: { label: 'Expirada', color: '#94a3b8', bg: 'rgba(255,255,255,0.06)' },
}

export const CANDIDATE_STAGE_LABEL: Record<string, string> = {
  sourced: 'Encontrado',
  ranked: 'Ranqueado',
  contacted: 'Contatado',
  in_screening: 'Em triagem',
  screened: 'Triado',
  shortlisted: 'Shortlist',
  presented: 'Apresentado',
  approved: 'Aprovado ✓',
  not_selected: 'Não selecionado',
  unreachable: 'Inalcançável',
  withdrew: 'Desistiu',
  disqualified: 'Reprovado',
}

export const ACTIVE_JOB_STATUSES = [
  'draft', 'profiling', 'profile_ready', 'sourcing', 'sourcing_expanded',
  'outreach', 'screening', 'shortlist_ready', 'presented', 'company_review',
]

export const PROFILE_FIELD_LABEL: Record<string, string> = {
  course: 'Curso',
  semester_min: 'Semestre mín.',
  semester_max: 'Semestre máx.',
  city: 'Cidade',
  modality: 'Modalidade',
  scholarship: 'Bolsa',
  schedule: 'Horário',
  soft_skills: 'Soft skills',
  hard_skills: 'Hard skills',
  experience: 'Experiência',
  tools: 'Ferramentas',
  languages: 'Idiomas',
  competencies: 'Competências',
  behavioral_profile: 'Perfil comportamental',
  start_date: 'Início desejado',
  urgency_notes: 'Notas de urgência',
}
