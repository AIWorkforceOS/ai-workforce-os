// Tipos de domínio do Recruiter Employee (agent_type = 'recruiter').
// Espelham a migration 20260713000006 e a spec docs/employees/recruiter-employee-spec.md.

export type JobStatus =
  | 'draft'
  | 'profiling'
  | 'profile_ready'
  | 'sourcing'
  | 'sourcing_expanded'
  | 'outreach'
  | 'screening'
  | 'shortlist_ready'
  | 'presented'
  | 'company_review'
  | 'candidate_selected'
  | 'handed_off'
  | 'closed'
  | 'stalled'
  | 'escalated_human'
  | 'cancelled'
  | 'expired'

export type CandidateStage =
  | 'sourced'
  | 'ranked'
  | 'contacted'
  | 'in_screening'
  | 'screened'
  | 'shortlisted'
  | 'presented'
  | 'approved'
  | 'not_selected'
  | 'unreachable'
  | 'withdrew'
  | 'disqualified'

/** Perfil ideal da vaga (job_openings.profile, jsonb) — §6.1.1 da spec. */
export type JobProfile = {
  course?: string | null
  semester_min?: number | null
  semester_max?: number | null
  city?: string | null
  modality?: string | null // presencial | hibrido | remoto
  scholarship?: string | null // bolsa (R$)
  schedule?: string | null
  soft_skills?: string[] | null
  hard_skills?: string[] | null
  experience?: string | null
  tools?: string[] | null
  languages?: string[] | null
  competencies?: string[] | null
  behavioral_profile?: string | null
  start_date?: string | null
  urgency_notes?: string | null
  /** campos respondidos de forma ambígua (confiança baixa — validar na triagem) */
  low_confidence_fields?: string[] | null
  /** resumo do perfil ideal gerado pela IA e confirmado com a empresa */
  ideal_profile_summary?: string | null
  /** flag interna: resumo enviado, aguardando "ok" da empresa */
  awaiting_confirmation?: boolean | null
  /** flag interna: turnos seguidos do intake sem preencher nenhum campo novo */
  intake_no_progress_count?: number | null
}

/**
 * Checklist do levantamento de perfil (§7.2). A ordem define a ordem
 * das perguntas do intake. `semester_min`/`semester_max` são cobertos
 * pela pergunta única de "semestre".
 */
export const PROFILE_FIELDS: { key: keyof JobProfile; label: string }[] = [
  { key: 'course', label: 'curso desejado' },
  { key: 'semester_min', label: 'semestre mínimo' },
  { key: 'semester_max', label: 'semestre máximo' },
  { key: 'city', label: 'cidade da vaga' },
  { key: 'modality', label: 'modalidade (presencial, híbrido ou remoto)' },
  { key: 'scholarship', label: 'valor da bolsa' },
  { key: 'schedule', label: 'horário de trabalho' },
  { key: 'soft_skills', label: 'soft skills desejadas' },
  { key: 'hard_skills', label: 'hard skills necessárias' },
  { key: 'experience', label: 'experiência prévia esperada' },
  { key: 'tools', label: 'ferramentas que precisa dominar' },
  { key: 'languages', label: 'idiomas' },
  { key: 'competencies', label: 'competências-chave' },
  { key: 'behavioral_profile', label: 'perfil comportamental desejado' },
  { key: 'start_date', label: 'data desejada de início' },
]

export type JobOpening = {
  id: string
  org_id: string
  unit_id: string
  lead_id: string | null
  title: string
  status: JobStatus
  previous_status: string | null
  profile: JobProfile
  profile_missing_fields: string[]
  target_shortlist_size: number
  urgency: 'low' | 'normal' | 'high'
  hiring_deadline: string | null
  source: string
  stalled_since: string | null
  follow_up_count: number
  selected_candidate_id: string | null
  handed_off_to: string | null
  /** id da vaga correspondente no sistema de vagas da Smarter (migration 019). Null fora do modo smarter ou antes da criação. */
  smarter_recruiting_vacancy_id: string | null
  created_at: string
  updated_at: string
}

export type Candidate = {
  id: string
  org_id: string
  source: string
  external_ref: string | null
  name: string
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  course: string | null
  semester: number | null
  institution: string | null
  skills: string[]
  languages: string[]
  experience_summary: string | null
  disc_profile: string | null
  resume_url: string | null
  profile_embedding: unknown
  consent_status: 'granted' | 'revoked' | 'unknown'
  consent_at: string | null
  opted_out: boolean
  created_at: string
  updated_at: string
}

/** Rubrica do ranking (§8.2) — dimensões e pesos fixos e explicáveis. */
export const SCORING_RUBRIC: { key: string; label: string; weight: number }[] = [
  { key: 'hard_skills', label: 'Hard skills / ferramentas', weight: 25 },
  { key: 'education', label: 'Curso + semestre + formação', weight: 20 },
  { key: 'experience', label: 'Experiência relevante', weight: 15 },
  { key: 'logistics', label: 'Localização / modalidade / horário', weight: 15 },
  { key: 'soft_skills', label: 'Soft skills / perfil comportamental (DISC)', weight: 10 },
  { key: 'platform_history', label: 'Histórico na plataforma', weight: 10 },
  { key: 'expectations', label: 'Ajuste de expectativa (bolsa, início)', weight: 5 },
]

export type ScoreDimension = { score: number; justification: string }

export type ScoreBreakdown = {
  dimensions?: Record<string, ScoreDimension>
  /** dados estruturados coletados na triagem conversacional */
  screening_data?: ScreeningData
}

export type ScreeningData = {
  interested?: boolean | null
  availability?: string | null
  salary_expectation?: string | null
  start_availability?: string | null
  enrollment_confirmed?: boolean | null
  modality_fit?: string | null
  notes?: string[] | null
  open_questions?: string[] | null
}

/** Relatório final por candidato (§7.6). */
export type CandidateReport = {
  summary: string
  strengths: string[]
  weaknesses: string[]
  score: number
  compatibility_pct: number
  risk: 'baixo' | 'medio' | 'alto'
  risk_reason: string
  availability: string
  expectations: string
}

export type JobCandidate = {
  id: string
  job_id: string
  candidate_id: string
  unit_id: string
  stage: CandidateStage
  stage_reason: string | null
  ai_score: number | null
  match_score: number | null
  rank: number | null
  score_breakdown: ScoreBreakdown
  report: CandidateReport | null
  outreach_attempts: number
  contacted_at: string | null
  screened_at: string | null
  presented_at: string | null
  /** quando este candidato foi adicionado à vaga correspondente na Smarter via POST /api/partners/applications (migration 019). */
  smarter_recruiting_added_at: string | null
  created_at: string
  updated_at: string
}

export type CandidateMessage = {
  id: string
  candidate_id: string
  job_id: string | null
  unit_id: string
  channel: 'whatsapp' | 'email'
  direction: 'outbound' | 'inbound'
  content: string
  template_key: string | null
  external_message_id: string | null
  status: 'sent' | 'delivered' | 'read' | 'failed'
  sent_at: string
  created_at: string
}

export type RecruiterDecisionType =
  | 'contact_candidate'
  | 'skip_candidate'
  | 'expand_sourcing'
  | 'pause'
  | 'follow_up'
  | 'escalate'
  | 'disqualify'
  | 'shortlist'
  | 'route_ambiguous'
  | 'opt_out'
  | 'reject_feedback'
  | 'stalled'
  | 'expire'
  | 'unreachable'
  | 'resume'

/** Limites operacionais (§15) com defaults; sobrescritos por agent_configs.escalation_rules. */
export type RecruiterLimits = {
  company_followup_max: number
  candidate_attempts_max: number
  screening_score_cutoff: number
  /** meta interna de candidatos qualificados no sourcing (match_score ≥ 65) */
  sourcing_qualified_target: number
  match_score_qualified: number
  outreach_batch_size: number
}

export const DEFAULT_RECRUITER_LIMITS: RecruiterLimits = {
  company_followup_max: 3,
  candidate_attempts_max: 2,
  screening_score_cutoff: 60,
  sourcing_qualified_target: 8,
  match_score_qualified: 65,
  outreach_batch_size: 8,
}
