import type { AgentConfig, Service } from '@/lib/types'
import type { VerticalKey } from '@/lib/verticals/catalog'

export type CertificationStatus = 'ready' | 'missing_information' | 'requires_review'
export type CertificationResult = { status: CertificationStatus; issues: string[] }

const ESSENTIAL_PROFILE_FIELDS: Record<string, string[]> = {
  sdr: ['sobre_a_empresa', 'produtos', 'politica_desconto', 'tipo_cliente', 'fechamento', 'fechamento_acao'],
  receptionist: ['tipo_negocio', 'como_atende_hoje', 'tarefas_automaticas', 'quando_avisar_humano', 'quem_avisar', 'horario_funcionamento', 'informacoes_proibidas_inventar'],
  recruiter: ['sobre_a_empresa', 'segmento', 'cargos_tipicos', 'cultura_valores', 'locais', 'processo_seletivo'],
  traffic_specialist: ['tipo_negocio', 'orcamento_mensal_brl', 'publico_alvo', 'regiao', 'objetivo_campanha'],
  content_specialist: ['pilares_conteudo', 'plataformas', 'frequencia_semanal', 'tom_visual', 'publico_alvo', 'proibicoes'],
  seo_specialist: ['site_url', 'palavras_chave_alvo', 'regiao_atuacao'],
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function hasValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (value && typeof value === 'object') return Object.keys(value).length > 0
  return value !== null && value !== undefined
}

function receptionistUsesScheduling(profile: Record<string, unknown>): boolean {
  const tasks = Array.isArray(profile.tarefas_automaticas)
    ? profile.tarefas_automaticas
    : [profile.tarefas_automaticas]
  return tasks.some((task) => typeof task === 'string' && /agend|marcar|remarcar|reagendar|desmarcar/i.test(task))
}

export function evaluateEmployeeCertification(params: {
  config: Pick<AgentConfig, 'agent_type' | 'business_profile' | 'interview_status'>
  verticalKey?: VerticalKey | null
  services?: Pick<Service, 'name' | 'price' | 'price_notes' | 'duration_minutes' | 'description' | 'booking_rules' | 'cancellation_rules'>[]
  scenarioReviewCompleted?: boolean
}): CertificationResult {
  const { config, services = [], scenarioReviewCompleted = false } = params
  const issues: string[] = []
  if (config.interview_status !== 'completed') issues.push('Concluir a entrevista de treinamento.')

  const profile = config.business_profile ?? {}
  const missingEssential = (ESSENTIAL_PROFILE_FIELDS[config.agent_type] ?? []).filter((field) => !hasValue(profile[field]))
  if (missingEssential.length > 0) issues.push(`Completar informações essenciais: ${missingEssential.join(', ')}.`)
  if (config.agent_type === 'sdr') {
    if (!Array.isArray(profile.produtos) || profile.produtos.length === 0) issues.push('Cadastrar produtos ou serviços vendidos.')
    if (!hasText(profile.politica_desconto)) issues.push('Definir a política de descontos e negociação.')
    if (!hasText(profile.fechamento)) issues.push('Definir se o Sales fecha sozinho ou transfere para uma pessoa.')
  }

  if (config.agent_type === 'receptionist') {
    if (receptionistUsesScheduling(profile)) {
      if (!hasValue(profile.servicos_regras)) issues.push('Definir as regras gerais dos serviços e atendimentos.')
      if (!hasText(profile.politica_agendamento)) issues.push('Definir a política de agendamento, cancelamento e reagendamento.')
      if (services.length === 0) issues.push('Cadastrar pelo menos um serviço ativo no catálogo da agenda.')
      for (const service of services) {
        if (!hasText(service.description)) issues.push(`Descrever o serviço “${service.name}”.`)
        if (!hasText(service.booking_rules)) issues.push(`Definir as regras de agendamento de “${service.name}”.`)
        if (!hasText(service.cancellation_rules)) issues.push(`Definir as regras de cancelamento de “${service.name}”.`)
        if (!Number.isFinite(service.duration_minutes) || service.duration_minutes <= 0) issues.push(`Definir a duração de “${service.name}”.`)
        if (service.price === null && !hasText(service.price_notes)) issues.push(`Informar o preço de “${service.name}” ou declarar no catálogo que é sob consulta.`)
      }
    }
  }

  if (issues.length > 0) return { status: 'missing_information', issues: [...new Set(issues)] }
  if (!scenarioReviewCompleted) {
    return { status: 'requires_review', issues: ['Executar e aprovar os cenários de teste antes da ativação.'] }
  }
  return { status: 'ready', issues: [] }
}
