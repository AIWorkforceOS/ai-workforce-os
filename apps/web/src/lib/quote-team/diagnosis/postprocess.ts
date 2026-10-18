import type { Diagnosis } from '../contracts'
import type { UnreadablePhoto } from './photos'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export type DiagnosisPostResult = { diagnosis: Diagnosis; warnings: string[] }

/**
 * Travas determinísticas DEPOIS do modelo (a IA não é a autoridade final):
 *  - part number só fica se aparece, de fato, no texto lido da etiqueta (nunca inventado);
 *  - sem foto analisada: nada de confiança visual;
 *  - foto que não carregou vira pedido ao técnico.
 */
export function sanitizeDiagnosis(input: Diagnosis, ctx: { unreadable: UnreadablePhoto[] }): DiagnosisPostResult {
  const warnings: string[] = []
  const d: Diagnosis = structuredClone(input)

  const labelText = norm(d.identified.labels_read.join(' '))
  const kept: string[] = []
  for (const pn of d.identified.part_numbers) {
    if (labelText.includes(norm(pn)) && norm(pn).length >= 3) kept.push(pn)
    else warnings.push(`Part number "${pn}" removido: não aparece em nenhuma etiqueta legível nas fotos (não pode ser inventado).`)
  }
  d.identified.part_numbers = kept

  if (d.photos_analyzed === 0) {
    d.visual_confidence = 'none'
    d.evidence = []
    d.insufficient_photos = true
  } else if (d.evidence.length === 0 && d.visual_confidence !== 'none') {
    d.visual_confidence = 'low'
    warnings.push('Sem evidências visuais citadas: a confiança do diagnóstico foi reduzida.')
  }

  if (ctx.unreadable.length > 0) {
    d.additional_info_needed.push({
      kind: 'photo',
      request_pt: `${ctx.unreadable.length} foto(s) não puderam ser carregadas para análise. Envie-as novamente ou tire novas fotos.`,
    })
  }

  return { diagnosis: d, warnings }
}

export function pendingFromDiagnosis(d: Diagnosis): { code: string; message_pt: string }[] {
  return d.additional_info_needed.map((a) => ({ code: `need_${a.kind}`, message_pt: a.request_pt }))
}
