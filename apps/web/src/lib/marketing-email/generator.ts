// Geração de campanha de e-mail marketing (assunto + corpo em texto puro)
// via IA, mesma OPENAI_API_KEY do resto do projeto (lib/openai.ts).
//
// Dois modos, ambos produzindo a mesma saída {subject, bodyText, reasoning}:
//   - do zero, a partir de um objetivo em texto livre (ex.: "avisar sobre
//     promoção de inverno");
//   - adaptando um conteúdo já aprovado do Conteúdo/Social ou do SEO
//     (title/body existentes) para o formato de campanha por e-mail —
//     é o "transformar em e-mail" pedido no build.
//
// O link de descadastro NUNCA é gerado pela IA nem entra no body_text —
// é sempre montado por código no envio (lib/email.ts:buildMarketingEmailHtml),
// por destinatário, pra garantir que toda campanha em massa cumpra a
// exigência de opt-out mesmo se o modelo esquecer.

import { generateStructuredReply } from '@/lib/openai'
import { buildCombinedBusinessContext } from '@/lib/interview/engine'
import type { Unit } from '@/lib/types'

type CampaignCopyOutput = { subject?: string; body_text?: string; reasoning?: string }

export type GeneratedCampaignCopy = {
  subject: string
  bodyText: string
  reasoning: string
}

/** Conteúdo já existente (post ou item de SEO) a partir do qual a campanha é adaptada. */
export type CampaignSourceContent = {
  title: string
  text: string
}

/**
 * Monta o prompt de sistema da geração da campanha — função pura
 * (testável sem rede), no mesmo espírito de buildCaptionSystemPrompt.
 */
export function buildCampaignSystemPrompt(params: {
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  objective: string
  source: CampaignSourceContent | null
}): string {
  const { unit, organizationProfile, objective, source } = params
  const businessContext = buildCombinedBusinessContext(organizationProfile, null)

  const taskLine = source
    ? `Sua tarefa agora: adaptar o conteúdo abaixo, já produzido pela empresa, para uma campanha de E-MAIL MARKETING EM MASSA (newsletter) para a unidade ${unit.name}.` +
      ` Conteúdo original — título: "${source.title}". Texto: "${source.text}".` +
      (objective ? ` Instrução extra do responsável pela campanha: "${objective}".` : '')
    : `Sua tarefa agora: escrever do zero uma campanha de E-MAIL MARKETING EM MASSA (newsletter) para a unidade ${unit.name}, com este objetivo: "${objective}".`

  return [
    `Você é o redator de e-mail marketing digital da unidade ${unit.name}.`,
    taskLine,
    businessContext ??
      'Ainda não há uma ficha de negócio detalhada — escreva algo genérico, seguro e verdadeiro para uma empresa de serviços, sem inventar detalhes específicos.',
    'Isto é uma campanha EM MASSA para uma lista de contatos (leads e/ou clientes) — não é uma mensagem individual. Escreva um assunto curto e direto (sem parecer spam, sem excesso de maiúsculas ou pontos de exclamação) e um corpo em texto puro, em parágrafos curtos, tom humano e profissional.',
    'Nunca invente promoção, preço, prazo ou resultado que não esteja na ficha da empresa ou no conteúdo original informado. Nunca mencione concorrentes. Respeite qualquer proibição registrada na ficha.',
    'NÃO inclua link de descadastro, rodapé legal ou qualquer despedida do tipo "para não receber mais e-mails" — isso é adicionado automaticamente pelo sistema depois.',
    'FORMATO DA RESPOSTA — responda SOMENTE um JSON válido no formato:',
    '{"subject": "assunto do e-mail", "body_text": "corpo em texto puro, parágrafos separados por uma linha em branco (\\n\\n)", "reasoning": "1 frase curta, em português, explicando por que esta campanha faz sentido agora, para o dono da empresa entender"}',
  ]
    .filter(Boolean)
    .join(' ')
}

/** Gera assunto + corpo da campanha via chat em JSON mode. */
export async function generateCampaignCopy(params: {
  apiKey: string
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  objective: string
  source: CampaignSourceContent | null
}): Promise<GeneratedCampaignCopy> {
  const systemPrompt = buildCampaignSystemPrompt(params)
  const output = await generateStructuredReply<CampaignCopyOutput>({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Gere a campanha agora.' }],
    maxTokens: 800,
    temperature: 0.7,
  })

  const subject = (output.subject ?? '').trim()
  const bodyText = (output.body_text ?? '').trim()
  const reasoning = (output.reasoning ?? '').trim()
  if (!subject || !bodyText) {
    throw new Error('OpenAI não retornou assunto ou corpo válidos para a campanha.')
  }
  return { subject, bodyText, reasoning: reasoning || 'Campanha gerada conforme o objetivo informado.' }
}
