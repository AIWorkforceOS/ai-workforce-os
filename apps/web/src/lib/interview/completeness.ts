import { INTERVIEW_PLAYBOOKS, isInterviewAgentType } from '@/lib/interview/engine'
import { humanizeFieldLabel } from '@/lib/interview/profile-format'
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

type CompletenessConfig = { agent_type: string; business_profile?: Record<string, unknown> | null }

/** Campos esperados no schema deste cargo (+ da vertical, quando houver) — compartilhado entre o score e a lista de pendências. */
function expectedFieldKeys(agentType: string, verticalKey?: VerticalKey | null): Set<string> {
  if (!isInterviewAgentType(agentType)) return new Set()
  const playbook = INTERVIEW_PLAYBOOKS[agentType]
  const schemas = [playbook.profileSchema]
  const extra = verticalKey ? VERTICAL_TEMPLATES[verticalKey]?.interviewExtra?.[agentType] : undefined
  if (extra) schemas.push(extra.profileSchemaFragment)

  const fieldKeys = new Set<string>()
  for (const schema of schemas) {
    for (const key of extractFieldKeys(schema)) fieldKeys.add(key)
  }
  return fieldKeys
}

/**
 * Score 0-100 de completude do treinamento de um agent_configs. Funciona
 * para os 4 agent_type (sdr, recruiter, traffic_specialist, receptionist).
 * Retorna 0 quando o agente ainda não existe, o agent_type não tem
 * entrevista, ou business_profile está vazio/nulo.
 */
export function computeTrainingCompleteness(config: CompletenessConfig | null | undefined, verticalKey?: VerticalKey | null): number {
  if (!config) return 0
  const fieldKeys = expectedFieldKeys(config.agent_type, verticalKey)
  if (fieldKeys.size === 0) return 0

  const profile = config.business_profile ?? {}
  let filled = 0
  for (const key of fieldKeys) {
    if (hasValue(profile[key])) filled++
  }
  return Math.round((filled / fieldKeys.size) * 100)
}

/**
 * Campos esperados que AINDA não têm valor em business_profile — a versão
 * acionável do score acima, para a tela "Manual de Trabalho" (Fase 6)
 * mostrar exatamente o que falta ensinar, não só uma porcentagem.
 */
export function missingProfileFields(config: CompletenessConfig | null | undefined, verticalKey?: VerticalKey | null): string[] {
  if (!config) return []
  const fieldKeys = expectedFieldKeys(config.agent_type, verticalKey)
  const profile = config.business_profile ?? {}
  return [...fieldKeys]
    .filter((key) => !hasValue(profile[key]))
    .map(humanizeFieldLabel)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
}
