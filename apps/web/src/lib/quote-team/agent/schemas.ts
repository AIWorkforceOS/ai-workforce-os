import { z } from 'zod'
import { confidenceSchema } from '../contracts'
import { toStrictJsonSchema } from '../diagnosis/schema'

const requestKind = z.enum(['photo', 'label', 'measurement', 'model', 'dimensions', 'voltage', 'capacity', 'installation', 'other'])

/** Saída do modelo na etapa de materiais (esquema simples e estrito; a validação de regras de negócio é feita depois, em código). */
export const materialsLlmSchema = z.object({
  items: z.array(
    z.object({
      kind: z.enum(['material', 'consumable', 'tool']),
      necessity: z.enum(['required', 'conditional']),
      name_en: z.string(),
      description_pt: z.string(),
      quantity: z.number(),
      unit: z.string(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      part_number: z.string().nullable(),
      dimensions: z.string().nullable(),
      compatibility: z.string().nullable(),
      reason: z.string(),
      confidence: confidenceSchema,
      needs_confirmation: z.string().nullable(),
      waste_pct: z.number().nullable(),
      waste_justification: z.string().nullable(),
    }),
  ),
  questions: z.array(z.object({ kind: requestKind, request_pt: z.string(), blocking: z.boolean() })),
})
export type MaterialsLlm = z.infer<typeof materialsLlmSchema>
export const MATERIALS_JSON_SCHEMA = toStrictJsonSchema(materialsLlmSchema)

export const laborLlmSchema = z.object({
  technicians: z.number(),
  service_hours: z.number(),
  travel_hours: z.number().nullable(),
  idle_hours: z.number().nullable(),
  multi_technician_justification: z.string().nullable(),
  justification_pt: z.string(),
  description_en: z.string(),
  breakdown: z.array(z.object({ phase: z.string(), hours: z.number() })),
})
export type LaborLlm = z.infer<typeof laborLlmSchema>
export const LABOR_JSON_SCHEMA = toStrictJsonSchema(laborLlmSchema)

/** Resultado da pesquisa de UM item (busca web). O modelo só PROPÕE; a verificação em código decide o que vale. */
export const priceSearchLlmSchema = z.object({
  options: z.array(
    z.object({
      supplier: z.string(),
      product_url: z.string(),
      title: z.string().nullable(),
      brand: z.string().nullable(),
      model: z.string().nullable(),
      sku: z.string().nullable(),
      price: z.number().nullable(),
      currency: z.string(),
      snippet: z.string().nullable(),
      match_score: z.number(),
      compatibility_note: z.string().nullable(),
    }),
  ),
})
export type PriceSearchLlm = z.infer<typeof priceSearchLlmSchema>
export const PRICE_SEARCH_JSON_SCHEMA = toStrictJsonSchema(priceSearchLlmSchema)
