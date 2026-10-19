import type { AuditResult, Diagnosis, PendingItem } from '../contracts'
import type { StageHandler } from '../runner'
import { diagnosisFromSteps } from './context'
import type { LaborStageResult } from './labor'
import type { MaterialsStageResult } from './materials'
import type { PricingStageResult } from './pricing'

/** Auditoria por REGRAS (determinística, sem IA): confere o que o pipeline produziu e decide o estado técnico da cotação. */
export function auditQuote(stepResults: Record<string, unknown>): AuditResult {
  const findings: AuditResult['findings'] = []
  const diagnosis: Diagnosis | null = diagnosisFromSteps(stepResults)
  const materials = stepResults.materials as MaterialsStageResult | { skipped: string } | undefined
  const labor = stepResults.labor as LaborStageResult | { skipped: string } | undefined
  const pricing = stepResults.pricing as PricingStageResult | undefined
  const add = (rule: string, severity: 'info' | 'warning' | 'critical', message_pt: string, item_ref?: string) => findings.push({ rule, severity, message_pt, item_ref: item_ref ?? null })

  if (!diagnosis) add('diagnosis_missing', 'critical', 'Não há diagnóstico por IA: o texto e o escopo precisam ser preenchidos manualmente.')
  else {
    if (diagnosis.photos_analyzed === 0) add('no_visual_diagnosis', 'warning', 'Sem fotografias analisadas: não há diagnóstico visual.')
    else if (diagnosis.visual_confidence === 'low' || diagnosis.visual_confidence === 'none') add('low_visual_confidence', 'warning', 'Confiança visual baixa: confirme o diagnóstico antes de aprovar.')
    if (diagnosis.insufficient_photos) add('insufficient_photos', 'warning', 'As fotografias não foram suficientes para um diagnóstico seguro.')
    if (diagnosis.safety_risks.some((r) => r.severity === 'high')) add('safety_high', 'warning', 'Risco de segurança alto identificado: revise as medidas de segurança antes da execução.')
  }

  const items = materials && 'items' in materials ? materials.items : null
  if (!items) add('materials_missing', 'warning', 'Lista de materiais não gerada: preencha manualmente.')
  else {
    if (items.length === 0) add('materials_empty', 'info', 'Nenhum material listado.')
    items.forEach((item, index) => {
      if (item.needs_confirmation) add('item_needs_confirmation', 'warning', `${item.name_en}: ${item.needs_confirmation}`, String(index))
      if (item.necessity === 'required' && !item.brand && !item.model && !item.part_number && item.confidence === 'low') add('item_low_confidence', 'info', `${item.name_en}: especificação de baixa confiança — confira antes de comprar.`, String(index))
    })
  }

  if (!labor || !('labor' in labor)) add('labor_missing', 'warning', 'Estimativa de mão de obra não gerada: informe técnicos e horas.')
  else {
    if (labor.labor.technicians > 1 && !labor.labor.multi_technician_justification) add('crew_unjustified', 'critical', 'Mais de um técnico sem justificativa operacional.')
    if (labor.man_hours <= 0) add('labor_zero', 'warning', 'Horas-homem zeradas: confirme a estimativa.')
    for (const w of labor.warnings) add('labor_check', 'info', w)
  }

  const unresolved = pricing?.items.filter((i) => i.status !== 'verified').length ?? 0
  if (unresolved > 0) add('prices_pending', 'warning', `${unresolved} material(is) com preço pendente ou produto não confirmado.`)

  const status: AuditResult['status'] = findings.some((f) => f.severity === 'critical') ? 'blocked' : findings.some((f) => f.severity === 'warning') ? 'needs_confirmation' : 'ready_for_review'
  return { status, findings }
}

export function createAuditHandler(): StageHandler {
  return {
    needsAi: false,
    async run(ctx) {
      const result = auditQuote(ctx.stepResults)
      const pending: PendingItem[] = result.findings.filter((f) => f.severity === 'critical').map((f) => ({ code: `audit_${f.rule}`, message_pt: f.message_pt, item_ref: f.item_ref ?? null }))
      return { kind: 'done', result, pending }
    },
  }
}
