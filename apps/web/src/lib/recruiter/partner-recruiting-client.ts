import type { Unit } from '@/lib/types'
import type { JobOpening } from './types'
import { createSmarterRecruitingClient } from './smarter-recruiting-client'

// Contrato genérico de recrutamento com parceiro externo (ex.: Smarter).
//
// A lógica de negócio do Recruiter (orchestrator/cron) fala SOMENTE com
// esta interface — nunca importa nada de smarter-recruiting-client.ts
// diretamente. Hoje a Smarter é a única implementação concreta, mas o
// dia que aparecer outro parceiro com outro sistema de vagas, basta
// escrever uma nova implementação de PartnerRecruitingClient e plugar
// em getPartnerRecruitingClient — a lógica de negócio não muda.
//
// Opt-in por unidade via units.recruiting_integration_mode (migration
// 019), mesmo padrão de units.crm_integration_mode (lib/sales/smarter-crm.ts).
// Quando o modo é 'native' (padrão) ou falta o token, getPartnerRecruitingClient
// retorna null e o pipeline nativo do Recruiter segue 100% inalterado.

export type PartnerVacancyInput = {
  title: string
  course?: string | null
  city?: string | null
  state?: string | null
  modality?: string | null
  semesterMin?: number | null
  semesterMax?: number | null
  /** Rótulo livre da vaga (ex.: "R$ 1.500"). Parceiros que exigem valor numérico convertem internamente. */
  scholarship?: string | null
  schedule?: string | null
  startDate?: string | null
  description?: string | null
  hardSkills?: string[] | null
  tools?: string[] | null
  languages?: string[] | null
  experience?: string | null
}

/** Shape esperado do contrato de parceria (campos ausentes são tolerados). */
export type PartnerVacancy = { id: string; [key: string]: unknown }

export interface PartnerRecruitingClient {
  readonly partnerName: string
  /** Cria a vaga no sistema do parceiro. Chamado uma única vez por job_opening. */
  createVacancy(input: PartnerVacancyInput): Promise<PartnerVacancy>
  /**
   * Associa um candidato já existente no parceiro (mesmo id retornado na
   * origem do sourcing) a uma vaga já criada lá.
   */
  addCandidateToVacancy(vacancyId: string, candidateExternalId: string): Promise<void>
}

/**
 * Fábrica do cliente de recrutamento parceiro para uma unidade. Retorna
 * null (nunca lança) quando a unidade está no modo 'native', sem token,
 * ou (Smarter) sem o companyId — o chamador trata isso como "sem
 * integração", sem precisar saber qual parceiro existiria. Use
 * isPartnerRecruitingMisconfigured para distinguir "desativado" de
 * "ativado mas faltando configuração".
 */
export function getPartnerRecruitingClient(unit: Unit): PartnerRecruitingClient | null {
  if (
    unit.recruiting_integration_mode === 'smarter' &&
    unit.smarter_recruiting_partner_token &&
    unit.smarter_recruiting_company_id
  ) {
    return createSmarterRecruitingClient(unit.smarter_recruiting_partner_token, unit.smarter_recruiting_company_id)
  }
  return null
}

/**
 * true quando a unidade ligou o modo smarter e tem token, mas falta o
 * companyId — configuração incompleta (diferente de "integração
 * desativada"), vale um aviso ao time humano.
 */
export function isPartnerRecruitingMisconfigured(unit: Unit): boolean {
  return (
    unit.recruiting_integration_mode === 'smarter' &&
    Boolean(unit.smarter_recruiting_partner_token) &&
    !unit.smarter_recruiting_company_id
  )
}

/** Monta o input genérico da vaga a partir do job_opening nativo do Alizo. */
export function jobOpeningToPartnerVacancyInput(job: JobOpening): PartnerVacancyInput {
  const profile = job.profile
  return {
    title: job.title,
    course: profile.course ?? null,
    city: profile.city ?? null,
    modality: profile.modality ?? null,
    semesterMin: profile.semester_min ?? null,
    semesterMax: profile.semester_max ?? null,
    scholarship: profile.scholarship ?? null,
    schedule: profile.schedule ?? null,
    startDate: profile.start_date ?? null,
    description: profile.ideal_profile_summary ?? null,
    hardSkills: profile.hard_skills ?? null,
    tools: profile.tools ?? null,
    languages: profile.languages ?? null,
    experience: profile.experience ?? null,
  }
}
