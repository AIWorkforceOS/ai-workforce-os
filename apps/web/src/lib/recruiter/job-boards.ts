import type { JobOpening, JobProfile } from './types'

// Busca externa de candidatos (§7.4 e §12.3 da spec).
//
// LIMITAÇÃO REAL, verificada em 2026-07-13: nem Indeed nem InfoJobs
// Brasil oferecem API pública de busca de currículos. O acesso ao banco
// de currículos do Indeed ("Smart Sourcing") é produto pago com
// integração restrita a parceiros; o InfoJobs Brasil não expõe API
// pública de candidatos. Scraping ou automação de contas violaria os
// Termos de Uso — está proibido por decisão de arquitetura (§12.3).
//
// V1 portanto implementa o fallback transparente: quando o sourcing
// interno é insuficiente, o Recruiter gera um BRIEFING DE BUSCA
// estruturado (com strings booleanas prontas) e envia ao recrutador
// humano para executar manualmente nos portais. A interface
// JobBoardProvider deixa o plug de APIs oficiais pronto para o V2,
// condicionado a parceria comercial aprovada.

export type ExternalCandidateResult = {
  externalRef: string
  name: string
  email?: string | null
  phone?: string | null
  city?: string | null
  course?: string | null
  skills?: string[]
  resumeUrl?: string | null
}

export type JobBoardSearchOutcome =
  | { kind: 'candidates'; provider: string; candidates: ExternalCandidateResult[] }
  | { kind: 'manual_briefing'; provider: string; briefing: SourcingBriefing }

export interface JobBoardProvider {
  readonly name: string
  /** true quando o provider tem credenciais/parceria configuradas */
  isAvailable(): boolean
  searchCandidates(job: JobOpening): Promise<JobBoardSearchOutcome>
}

export type SourcingBriefing = {
  jobTitle: string
  searchStrings: string[]
  filters: string[]
  screeningHints: string[]
}

/** Monta strings de busca booleanas a partir do perfil ideal. */
export function buildBooleanSearchStrings(profile: JobProfile): string[] {
  const orGroup = (values: (string | null | undefined)[] | null | undefined): string | null => {
    const clean = (values ?? []).filter((v): v is string => Boolean(v && v.trim()))
    if (clean.length === 0) return null
    return clean.length === 1 ? `"${clean[0]}"` : `(${clean.map((v) => `"${v}"`).join(' OR ')})`
  }

  const course = profile.course ? `"${profile.course}"` : null
  const tools = orGroup(profile.tools)
  const hardSkills = orGroup(profile.hard_skills)
  const city = profile.city ? `"${profile.city}"` : null

  const strings: string[] = []
  if (course && hardSkills) strings.push([course, 'AND', hardSkills, city ? `AND ${city}` : ''].join(' ').trim())
  if (course && tools) strings.push([course, 'AND', tools, city ? `AND ${city}` : ''].join(' ').trim())
  if (hardSkills && tools) strings.push(`${hardSkills} AND ${tools}`)
  if (strings.length === 0 && course) strings.push(city ? `${course} AND ${city}` : course)
  return strings
}

export function buildSourcingBriefing(job: JobOpening): SourcingBriefing {
  const profile = job.profile
  const filters: string[] = []
  if (profile.city) filters.push(`Cidade: ${profile.city}${profile.modality ? ` (${profile.modality})` : ''}`)
  if (profile.semester_min || profile.semester_max) {
    filters.push(`Semestre: ${profile.semester_min ?? '?'}º a ${profile.semester_max ?? '?'}º`)
  }
  if (profile.scholarship) filters.push(`Bolsa: ${profile.scholarship}`)
  if (profile.schedule) filters.push(`Horário: ${profile.schedule}`)
  if (profile.languages?.length) filters.push(`Idiomas: ${profile.languages.join(', ')}`)

  const screeningHints: string[] = []
  if (profile.hard_skills?.length) screeningHints.push(`Validar hard skills: ${profile.hard_skills.join(', ')}`)
  if (profile.tools?.length) screeningHints.push(`Validar ferramentas: ${profile.tools.join(', ')}`)
  if (profile.behavioral_profile) screeningHints.push(`Perfil comportamental desejado: ${profile.behavioral_profile}`)
  if (profile.start_date) screeningHints.push(`Disponibilidade de início: ${profile.start_date}`)

  return {
    jobTitle: job.title,
    searchStrings: buildBooleanSearchStrings(profile),
    filters,
    screeningHints,
  }
}

/**
 * Provider V1: não busca em portal nenhum — devolve o briefing para o
 * humano executar nos portais (Indeed, InfoJobs) pela conta da unidade.
 */
export class ManualBriefingProvider implements JobBoardProvider {
  readonly name = 'manual_briefing'

  isAvailable(): boolean {
    return true
  }

  async searchCandidates(job: JobOpening): Promise<JobBoardSearchOutcome> {
    return { kind: 'manual_briefing', provider: this.name, briefing: buildSourcingBriefing(job) }
  }
}

/**
 * Placeholder para Indeed. V2: ativar quando houver parceria comercial com Indeed.
 * Estado: Indeed descontinuou a Publisher API de busca em 2023. Sem API pública viável.
 * Alternativa: produto pago "Indeed Smart Sourcing" (UI) ou parceria vendas-led.
 * Docs: https://docs.indeed.com/
 */
export class IndeedProvider implements JobBoardProvider {
  readonly name = 'indeed'

  isAvailable(): boolean {
    const apiKey = process.env.INDEED_API_KEY
    return Boolean(apiKey?.trim())
  }

  async searchCandidates(job: JobOpening): Promise<JobBoardSearchOutcome> {
    if (!this.isAvailable()) {
      return { kind: 'manual_briefing', provider: this.name, briefing: buildSourcingBriefing(job) }
    }
    throw new Error('Indeed API integration not implemented yet (V2)')
  }
}

/**
 * Placeholder para Infojobs Brasil. V2: ativar quando houver parceria comercial com Infojobs.
 * Estado: Infojobs não expõe API pública de busca de candidatos. Acesso à base de talentos
 * exige acordo comercial/parceria direto com Infojobs Brasil.
 * Docs: https://developer.infojobs.net/ (somente para candidatos, não employer)
 */
export class InfojobsProvider implements JobBoardProvider {
  readonly name = 'infojobs'

  isAvailable(): boolean {
    const apiUrl = process.env.INFOJOBS_API_URL
    const apiKey = process.env.INFOJOBS_API_KEY
    return Boolean(apiUrl?.trim() && apiKey?.trim())
  }

  async searchCandidates(job: JobOpening): Promise<JobBoardSearchOutcome> {
    if (!this.isAvailable()) {
      return { kind: 'manual_briefing', provider: this.name, briefing: buildSourcingBriefing(job) }
    }
    throw new Error('Infojobs API integration not implemented yet (V2)')
  }
}

/** Providers registrados, em ordem de preferência. V2 pluga APIs oficiais aqui. */
export function getJobBoardProviders(): JobBoardProvider[] {
  return [
    new IndeedProvider(),
    new InfojobsProvider(),
    new ManualBriefingProvider(), // fallback final
  ]
}

export function briefingToHtml(briefing: SourcingBriefing): string {
  const list = (items: string[]) => items.map((item) => `<li>${item}</li>`).join('')
  return `
    <p>O Recruiter IA não encontrou candidatos qualificados suficientes na base interna para a vaga
    <strong>${briefing.jobTitle}</strong> e preparou este briefing de busca externa.</p>
    <p><strong>Strings de busca (Indeed / InfoJobs / LinkedIn):</strong></p>
    <ul>${list(briefing.searchStrings.map((s) => `<code>${s}</code>`))}</ul>
    ${briefing.filters.length ? `<p><strong>Filtros:</strong></p><ul>${list(briefing.filters)}</ul>` : ''}
    ${briefing.screeningHints.length ? `<p><strong>O que validar ao selecionar currículos:</strong></p><ul>${list(briefing.screeningHints)}</ul>` : ''}
    <p>Cadastre os currículos encontrados no banco de talentos (fonte "manual") e o Recruiter
    assume o contato, a triagem e o ranking automaticamente.</p>
    <p><em>Nota: Indeed e InfoJobs não oferecem API pública de busca de currículos; a busca externa
    automática depende de parceria comercial (roadmap V2) e por isso esta etapa é assistida.</em></p>
  `
}
