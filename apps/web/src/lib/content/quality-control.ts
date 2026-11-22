import { generateStructuredReply, generateStructuredReplyFromImage } from '@/lib/openai'

export type QualityAssessment = {
  professional_quality: number
  brand_fidelity: number
  legibility: number
  factual_safety: number
  segment_fit: number
  engagement_potential: number
  pass: boolean
  issues: string[]
  correction: string
}
const RULES = 'Avalie de 0 a 100: professional_quality, brand_fidelity, legibility, factual_safety, segment_fit e engagement_potential. Só aprove se qualidade, marca, legibilidade e segmento >= 80 e segurança factual >= 95. Responda JSON com essas notas, pass, issues[] e correction.'

export async function assessCreativeText(params: { apiKey: string; format: string; companyContext: string; creative: unknown }): Promise<QualityAssessment> {
  return generateStructuredReply<QualityAssessment>({
    apiKey: params.apiKey,
    model: process.env.CONTENT_QUALITY_MODEL || 'gpt-4o',
    maxTokens: 900,
    temperature: 0.1,
    systemPrompt: `Você é o Diretor de Qualidade de uma agência premium e não participou da criação. Seja rigoroso e independente. ${RULES}`,
    history: [{ role: 'user', content: `Empresa: ${params.companyContext}\nFormato: ${params.format}\nPeça: ${JSON.stringify(params.creative)}` }],
  })
}

export async function assessCreativeImage(params: { apiKey: string; imageBase64: string; expected: string }): Promise<QualityAssessment> {
  return generateStructuredReplyFromImage<QualityAssessment>({
    apiKey: params.apiKey,
    model: process.env.CONTENT_QUALITY_MODEL || 'gpt-4o',
    imageUrl: `data:image/png;base64,${params.imageBase64}`,
    maxTokens: 900,
    temperature: 0.1,
    systemPrompt: `Você é um diretor de arte sênior revisando uma peça antes da publicação. Procure aparência de IA barata, anatomia errada, texto ilegível, marca incorreta, composição amadora e desalinhamento com o briefing. ${RULES}`,
    userText: `Briefing esperado: ${params.expected}`,
  })
}

export function qualityFeedback(assessment: QualityAssessment): string {
  return `A revisão profissional reprovou a primeira versão. Corrija obrigatoriamente: ${assessment.issues.join('; ')}. Orientação do revisor: ${assessment.correction}`
}
