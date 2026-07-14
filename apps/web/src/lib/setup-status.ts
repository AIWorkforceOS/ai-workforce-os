import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Estado de configuração de uma empresa (org) na plataforma, derivado do
 * banco — nunca de estado local. É a fonte única usada pelo onboarding,
 * pelo dashboard do cliente e pelo painel admin (por isso é uma função
 * pura sobre linhas já carregadas: cada chamador busca as linhas com o
 * client certo — RLS pro cliente, service role pro admin).
 */
export type SetupStep = {
  id: 'account' | 'whatsapp' | 'agent' | 'active'
  /** rótulo curto, em linguagem de dono de negócio */
  label: string
  done: boolean
}

export type SetupStatus = {
  steps: SetupStep[]
  /** 0–100 */
  progress: number
  complete: boolean
  /** primeira pendência, pronta pra virar CTA ("o que fazer agora") */
  nextAction: { label: string; description: string; href: string } | null
}

type UnitRow = Pick<Unit, 'id' | 'whatsapp_phone' | 'is_active'>
type AgentConfigRow = Pick<AgentConfig, 'unit_id' | 'agent_type' | 'is_active' | 'persona_name'>

export function computeSetupStatus(units: UnitRow[], agentConfigs: AgentConfigRow[]): SetupStatus {
  const hasUnit = units.length > 0
  const whatsappConnected = units.some((u) => !!u.whatsapp_phone)
  const sdrConfigs = agentConfigs.filter((c) => c.agent_type === 'sdr')
  const agentConfigured = sdrConfigs.length > 0
  const agentActive = sdrConfigs.some((c) => c.is_active)

  const steps: SetupStep[] = [
    { id: 'account', label: 'Conta criada', done: hasUnit },
    { id: 'whatsapp', label: 'WhatsApp conectado', done: whatsappConnected },
    { id: 'agent', label: 'Funcionário configurado', done: agentConfigured },
    { id: 'active', label: 'Atendimento ligado', done: agentConfigured && agentActive },
  ]

  const doneCount = steps.filter((s) => s.done).length
  const progress = Math.round((doneCount / steps.length) * 100)
  const complete = doneCount === steps.length

  let nextAction: SetupStatus['nextAction'] = null
  if (!hasUnit) {
    nextAction = {
      label: 'Criar sua primeira unidade',
      description: 'Cadastre o local (ou matriz) que o funcionário digital vai atender.',
      href: '/dashboard/units/new',
    }
  } else if (!whatsappConnected) {
    nextAction = {
      label: 'Conectar seu WhatsApp',
      description: 'Escaneie um QR code com o celular da empresa — leva 2 minutos.',
      href: '/dashboard/onboarding',
    }
  } else if (!agentConfigured) {
    nextAction = {
      label: 'Configurar seu funcionário digital',
      description: 'Dê um nome e escolha o jeito de falar com seus clientes.',
      href: '/dashboard/onboarding',
    }
  } else if (!agentActive) {
    nextAction = {
      label: 'Ligar o atendimento automático',
      description: 'Teste uma conversa e ative — a partir daí ele atende sozinho.',
      href: '/dashboard/onboarding',
    }
  }

  return { steps, progress, complete, nextAction }
}
