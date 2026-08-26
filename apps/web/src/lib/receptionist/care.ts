import { generateChatReply } from '@/lib/openai'
import { buildReceptionistSystemPrompt } from './prompt'
import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Pós-venda + fidelização da Recepcionista (v1) — achado real da
 * auditoria de 2026-08-26: ela era 100% reativa, nunca iniciava contato,
 * então clientes nunca recebiam um "como foi?" depois do serviço nem um
 * "sentimos sua falta" quando somem. Pedido do Vinicius: "pos vendas,
 * fidelizar os clientes para retornar". Chamado por
 * app/api/cron/receptionist-care/route.ts — este módulo só decide
 * elegibilidade e escreve as mensagens; toda leitura/escrita de banco e
 * envio real ficam na rota (mesmo padrão de lib/scheduling/*).
 *
 * Quem responder a essas mensagens cai no fluxo normal de inbound da
 * Recepcionista (webhook do WhatsApp já existente) — não precisamos de
 * lógica nova pra tratar a resposta, ela já sabe conversar sobre
 * qualquer assunto.
 */

export const WINBACK_AFTER_DAYS = 60
export const WINBACK_COOLDOWN_DAYS = 30

export function isWinbackEligible(lastCompletedServiceAt: string | null, now: Date): boolean {
  if (!lastCompletedServiceAt) return false
  const daysSince = Math.floor((now.getTime() - new Date(lastCompletedServiceAt).getTime()) / (24 * 60 * 60 * 1000))
  return daysSince >= WINBACK_AFTER_DAYS
}

export async function generatePostServiceCheckinMessage(params: {
  apiKey: string
  agentConfig: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  customerName: string
  serviceName: string | null
}): Promise<string> {
  const systemPrompt = [
    buildReceptionistSystemPrompt(params.agentConfig, params.unit, params.organizationProfile),
    `Você está iniciando o contato agora (não é resposta a mensagem nenhuma) com ${params.customerName}, que teve um serviço${params.serviceName ? ` de "${params.serviceName}"` : ''} concluído ontem.`,
    'Escreva UMA mensagem curta e genuína perguntando como foi a experiência — tom de quem se importa de verdade, não de pesquisa/formulário automático. Termine com uma pergunta simples e fácil de responder.',
    'Não ofereça desconto nem prometa nada que não esteja na ficha da empresa.',
  ].join(' ')

  return generateChatReply({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Escreva a mensagem agora.' }],
  })
}

export async function generateWinbackMessage(params: {
  apiKey: string
  agentConfig: AgentConfig
  unit: Unit
  organizationProfile: Record<string, unknown> | null
  customerName: string
}): Promise<string> {
  const systemPrompt = [
    buildReceptionistSystemPrompt(params.agentConfig, params.unit, params.organizationProfile),
    `Você está iniciando o contato agora (não é resposta a mensagem nenhuma) com ${params.customerName}, cliente que não volta há mais de ${WINBACK_AFTER_DAYS} dias.`,
    'Escreva UMA mensagem curta e calorosa tipo "sentimos sua falta", convidando a pessoa a voltar — tom pessoal, nunca de propaganda em massa, sem exagero de emoji.',
    'Só mencione promoção/desconto se isso já estiver registrado na ficha da empresa como algo que você pode oferecer sem aprovação humana — nunca invente um.',
  ].join(' ')

  return generateChatReply({
    apiKey: params.apiKey,
    systemPrompt,
    history: [{ role: 'user', content: 'Escreva a mensagem agora.' }],
  })
}
