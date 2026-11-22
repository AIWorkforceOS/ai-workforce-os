import { generateStructuredReply } from '@/lib/openai'

export type CreativeConcept = {
  name: string
  hook: string
  visual_direction: string
  business_impact: string
  template_family: string
}
export type CreativeDirection = {
  objective: string
  audience: string
  offer: string
  tone: string
  segment: string
  channel: string
  format: string
  identity: string
  references: string
  cta: string
  allowed_claims: string[]
  forbidden_claims: string[]
  concepts: CreativeConcept[]
  selected_concept: CreativeConcept
  selection_reason: string
}

export async function directCreative(params: {
  apiKey: string
  companyContext: string
  platform: string
  format: 'image' | 'carousel' | 'video'
  objective: string
  brandContext: string
  recentContext?: string
}): Promise<CreativeDirection> {
  return generateStructuredReply<CreativeDirection>({
    apiKey: params.apiKey,
    model: process.env.CONTENT_DIRECTOR_MODEL || 'gpt-4o',
    maxTokens: 2200,
    temperature: 0.65,
    systemPrompt: [
      'Você é o Diretor Criativo sênior de uma agência de marketing de alta performance, com 20 anos de experiência em estratégia, branding, direção de arte, social media e crescimento digital.',
      'Seu trabalho não é escrever a peça final. Você deve construir um briefing verificável, propor EXATAMENTE 3 conceitos realmente diferentes e escolher o mais forte para gerar resultado de negócio sem comprometer a marca.',
      'Nunca use um segmento, uniforme, cenário ou público que não esteja no contexto da empresa. Nunca invente preço, promoção, cliente, depoimento, número ou resultado.',
      `Empresa: ${params.companyContext}`,
      `Identidade: ${params.brandContext}`,
      `Canal: ${params.platform}. Formato: ${params.format}. Objetivo inicial: ${params.objective}.`,
      params.recentContext ? `Conteúdo recente a não repetir: ${params.recentContext}` : '',
      'Escolha uma família visual adequada entre: editorial-premium, fotografia-humana, prova-social, antes-depois, educativo-modular, oferta-elegante, bastidores, storytelling, dados-infografico, produto-destaque.',
      'Responda somente JSON com: objective, audience, offer, tone, segment, channel, format, identity, references, cta, allowed_claims[], forbidden_claims[], concepts[{name,hook,visual_direction,business_impact,template_family}], selected_concept e selection_reason.',
    ].filter(Boolean).join(' '),
    history: [{ role: 'user', content: 'Crie a direção criativa desta publicação.' }],
  })
}

export function creativeDirectionBlock(direction: CreativeDirection): string {
  const selected = direction.selected_concept
  return [
    'DIREÇÃO CRIATIVA APROVADA (obrigatória):',
    `Objetivo: ${direction.objective}. Público: ${direction.audience}. Oferta: ${direction.offer}. Tom: ${direction.tone}. Segmento: ${direction.segment}.`,
    `Conceito escolhido: ${selected.name}. Gancho: ${selected.hook}. Direção visual: ${selected.visual_direction}. Família de template: ${selected.template_family}.`,
    `CTA: ${direction.cta}. Pode afirmar: ${direction.allowed_claims.join('; ') || 'somente fatos da ficha'}. Não pode afirmar: ${direction.forbidden_claims.join('; ') || 'qualquer fato não comprovado'}.`,
  ].join(' ')
}
