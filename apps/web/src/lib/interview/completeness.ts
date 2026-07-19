import { INTERVIEW_PLAYBOOKS, isInterviewAgentType } from '@/lib/interview/engine'
import { VERTICAL_TEMPLATES, type VerticalKey } from '@/lib/verticals/catalog'

// Training Completeness Score: heurística simples de o quanto um funcionário
// digital já foi treinado. Conta quantos dos campos esperados no schema da
// entrevista (profileSchema do playbook + profileSchemaFragment da vertical,
// quando a org tiver uma) já têm valor preenchido em
// agent_configs.business_profile. É só contagem de campos preenchidos —
// NÃO é uma avaliação semântica da qualidade/coerência do conteúdo, e não
// deve virar uma.

/** Extrai nomes de campo de um schema informal — cobre os dois formatos
 * usados em lib/interview/engine.ts e lib/verticals/catalog.ts:
 * JSON-like ("chave": tipo) e fragmento de vertical (chave (tipo)). */
function extractFieldKeys(schema: string): string[] {
  const keys = new Set<string>()
  for (const match of schema.matchAll(/"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*[:(]/g)) {
    keys.add(match[1]!)
  }
  return [...keys]
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

/**
 * Score 0-100 de completude do treinamento de um agent_configs. Funciona
 * para os 4 agent_type (sdr, recruiter, traffic_specialist, receptionist).
 * Retorna 0 quando o agente ainda não existe, o agent_type não tem
 * entrevista, ou business_profile está vazio/nulo.
 */
export function computeTrainingCompleteness(
  config: { agent_type: string; business_profile?: Record<string, unknown> | null } | null | undefined,
  verticalKey?: VerticalKey | null,
): number {
  if (!config || !isInterviewAgentType(config.agent_type)) return 0
  const playbook = INTERVIEW_PLAYBOOKS[config.agent_type]

  const schemas = [playbook.profileSchema]
  const extra = verticalKey ? VERTICAL_TEMPLATES[verticalKey]?.interviewExtra?.[config.agent_type] : undefined
  if (extra) schemas.push(extra.profileSchemaFragment)

  const fieldKeys = new Set<string>()
  for (const schema of schemas) {
    for (const key of extractFieldKeys(schema)) fieldKeys.add(key)
  }
  if (fieldKeys.size === 0) return 0

  const profile = config.business_profile ?? {}
  let filled = 0
  for (const key of fieldKeys) {
    if (hasValue(profile[key])) filled++
  }
  return Math.round((filled / fieldKeys.size) * 100)
}
