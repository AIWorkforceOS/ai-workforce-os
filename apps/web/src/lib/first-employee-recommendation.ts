import type { WizardAgentType } from '@/lib/employee-wizard-meta'

export type BusinessNeed = 'customer_service' | 'sales' | 'hiring'

export type EmployeeRecommendation = {
  need: BusinessNeed
  agentType: Extract<WizardAgentType, 'receptionist' | 'sdr' | 'recruiter'>
  title: string
  description: string
  result: string
}

export const FIRST_EMPLOYEE_RECOMMENDATIONS: EmployeeRecommendation[] = [
  {
    need: 'customer_service',
    agentType: 'receptionist',
    title: 'Responder, organizar e agendar',
    description: 'Para quem perde mensagens, precisa fazer triagem, responder dúvidas e cuidar da agenda.',
    result: 'Recomendação: AI Receptionist',
  },
  {
    need: 'sales',
    agentType: 'sdr',
    title: 'Vender e acompanhar oportunidades',
    description: 'Para captar interessados, qualificar contatos, fazer follow-up e avançar negócios no CRM.',
    result: 'Recomendação: AI Sales Representative',
  },
  {
    need: 'hiring',
    agentType: 'recruiter',
    title: 'Contratar e selecionar pessoas',
    description: 'Para divulgar vagas, conversar com candidatos, fazer triagem e organizar o processo seletivo.',
    result: 'Recomendação: Recrutador (RH)',
  },
]

export function recommendFirstEmployee(need: BusinessNeed): EmployeeRecommendation {
  return FIRST_EMPLOYEE_RECOMMENDATIONS.find((item) => item.need === need) ?? FIRST_EMPLOYEE_RECOMMENDATIONS[0]!
}
