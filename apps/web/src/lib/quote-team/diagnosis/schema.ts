import { z } from 'zod'
import { diagnosisSchema } from '../contracts'

const DROP_KEYS = new Set(['$schema', 'default', 'format', 'minLength', 'maxLength', 'pattern', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minItems', 'maxItems', 'propertyNames', 'title', 'description'])

/**
 * Converte um schema Zod no JSON Schema aceito pelo modo estrito (strict: true) da OpenAI: todo objeto com
 * additionalProperties:false e TODAS as propriedades em "required" (opcional = união com null, já nos nossos contratos).
 * Restrições de faixa/tamanho saem do JSON Schema (nós validamos de novo com Zod no servidor, que é a autoridade).
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>
  return strictify(raw) as Record<string, unknown>
}

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify)
  if (node === null || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue
    out[key] = strictify(value)
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.additionalProperties = false
    out.required = Object.keys(out.properties as Record<string, unknown>)
  }
  return out
}

export const DIAGNOSIS_JSON_SCHEMA = toStrictJsonSchema(diagnosisSchema)
