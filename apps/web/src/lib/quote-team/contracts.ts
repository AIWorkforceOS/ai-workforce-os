import { z } from 'zod'

/**
 * Contratos de dados do Super Agente de Cotações (saídas estruturadas dos modelos, validadas NO SERVIDOR).
 * Regras codificadas aqui (não só no prompt):
 *  - sem foto analisada, não existe "diagnóstico visual" (confiança 'none', sem evidências);
 *  - part number nunca é obrigatório e nunca é inventado (opcional/nulo);
 *  - desperdício só com justificativa técnica;
 *  - 2+ técnicos só com justificativa concreta;
 *  - horas-homem NÃO vêm do modelo: são calculadas em código (técnicos × horas de serviço).
 */

export const confidenceSchema = z.enum(['high', 'medium', 'low'])

// ---------- 1. Diagnóstico visual ----------
export const diagnosisSchema = z
  .object({
    summary_pt: z.string().min(1),
    problem_en: z.string().min(1),
    /** Fatos VISÍVEIS (cada um aponta para as fotos que o sustentam). */
    evidence: z.array(z.object({ fact: z.string().min(1), photo_refs: z.array(z.number().int().nonnegative()), confidence: confidenceSchema })),
    /** Hipóteses: nunca apresentadas como diagnóstico confirmado. */
    hypotheses: z.array(z.object({ text: z.string().min(1), confidence: confidenceSchema })),
    identified: z.object({
      brand: z.string().nullable(),
      model: z.string().nullable(),
      part_numbers: z.array(z.string()),
      labels_read: z.array(z.string()),
    }),
    additional_info_needed: z.array(
      z.object({ kind: z.enum(['photo', 'label', 'measurement', 'model', 'dimensions', 'voltage', 'capacity', 'installation', 'other']), request_pt: z.string().min(1) }),
    ),
    safety_risks: z.array(z.object({ risk: z.string().min(1), severity: z.enum(['low', 'medium', 'high']) })),
    scope_pt: z.string().min(1),
    scope_en: z.string().min(1),
    photos_analyzed: z.number().int().nonnegative(),
    visual_confidence: z.enum(['none', 'low', 'medium', 'high']),
    insufficient_photos: z.boolean(),
  })
  .superRefine((value, ctx) => {
    if (value.photos_analyzed === 0) {
      if (value.visual_confidence !== 'none') ctx.addIssue({ code: 'custom', message: 'Sem foto analisada não pode haver diagnóstico visual (visual_confidence deve ser "none").', path: ['visual_confidence'] })
      if (value.evidence.length > 0) ctx.addIssue({ code: 'custom', message: 'Sem foto analisada não pode haver evidências visuais.', path: ['evidence'] })
    }
    for (const [i, e] of value.evidence.entries()) {
      if (e.photo_refs.some((ref) => ref >= value.photos_analyzed)) ctx.addIssue({ code: 'custom', message: 'Evidência aponta para uma foto que não foi analisada.', path: ['evidence', i, 'photo_refs'] })
    }
  })
export type Diagnosis = z.infer<typeof diagnosisSchema>

// ---------- 2. Materiais ----------
export const materialItemSchema = z
  .object({
    kind: z.enum(['material', 'consumable', 'tool']),
    necessity: z.enum(['required', 'conditional']),
    name_en: z.string().min(1),
    description_pt: z.string().min(1),
    quantity: z.number().positive(),
    unit: z.string().min(1),
    brand: z.string().nullable().optional(),
    model: z.string().nullable().optional(),
    part_number: z.string().nullable().optional(),
    dimensions: z.string().nullable().optional(),
    specs: z.record(z.string(), z.unknown()).nullable().optional(),
    compatibility: z.string().nullable().optional(),
    reason: z.string().min(1),
    confidence: confidenceSchema,
    needs_confirmation: z.string().nullable().optional(),
    waste_pct: z.number().min(0).max(100).nullable().optional(),
    waste_justification: z.string().nullable().optional(),
  })
  .superRefine((item, ctx) => {
    if (item.waste_pct != null && item.waste_pct > 0 && !item.waste_justification?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Desperdício só com justificativa técnica.', path: ['waste_justification'] })
    }
  })
export const materialsSchema = z.object({ items: z.array(materialItemSchema) })
export type MaterialItem = z.infer<typeof materialItemSchema>

// ---------- 3. Pesquisa de produto (resultado por item) ----------
export const productOptionSchema = z.object({
  supplier: z.string().min(1),
  product_url: z.string().url().refine((u) => u.startsWith('https://'), 'Somente https.'),
  title: z.string().nullable(),
  brand: z.string().nullable(),
  model: z.string().nullable(),
  sku: z.string().nullable(),
  price: z.number().nonnegative().nullable(),
  currency: z.string().default('USD'),
  /** Trecho da página que sustenta o preço. Sem citação ⇒ o preço é descartado pela camada de verificação. */
  citation: z.object({ url: z.string().url(), snippet: z.string().min(1) }).nullable(),
  match_score: z.number().min(0).max(1),
})
export const productSearchResultSchema = z.object({ options: z.array(productOptionSchema) })
export type ProductOption = z.infer<typeof productOptionSchema>

// ---------- 4. Mão de obra (SEM dinheiro; horas-homem calculadas em código) ----------
export const laborSchema = z
  .object({
    technicians: z.number().int().min(1),
    service_hours: z.number().nonnegative(),
    travel_hours: z.number().nonnegative().nullable().optional(),
    idle_hours: z.number().nonnegative().nullable().optional(),
    multi_technician_justification: z.string().nullable().optional(),
    justification_pt: z.string().min(1),
    description_en: z.string().min(1),
    breakdown: z.array(z.object({ phase: z.string().min(1), hours: z.number().nonnegative() })),
  })
  .superRefine((labor, ctx) => {
    if (labor.technicians > 1 && !labor.multi_technician_justification?.trim()) {
      ctx.addIssue({ code: 'custom', message: 'Dois ou mais técnicos só com justificativa concreta (peso, dimensão, segurança…).', path: ['multi_technician_justification'] })
    }
  })
export type LaborPlan = z.infer<typeof laborSchema>

/** Horas-homem: sempre código, nunca modelo. */
export function manHours(technicians: number, serviceHours: number): number {
  return Math.round(technicians * serviceHours * 1000) / 1000
}

// ---------- 6. Auditoria ----------
export const auditSchema = z.object({
  status: z.enum(['ready_for_review', 'needs_confirmation', 'blocked']),
  findings: z.array(z.object({ rule: z.string().min(1), severity: z.enum(['info', 'warning', 'critical']), message_pt: z.string().min(1), item_ref: z.string().nullable().optional() })),
})
export type AuditResult = z.infer<typeof auditSchema>

// ---------- Job ----------
export const jobStatusSchema = z.enum(['queued', 'running', 'needs_input', 'completed', 'failed', 'cancelled', 'budget_exhausted'])
export type JobStatus = z.infer<typeof jobStatusSchema>

export type PendingItem = { code: string; message_pt: string; item_ref?: string | null }
