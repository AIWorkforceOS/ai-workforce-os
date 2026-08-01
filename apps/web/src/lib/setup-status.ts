import type { AgentConfig, Unit } from '@/lib/types'

/**
 * Estado de configuração de uma empresa (org) na plataforma, derivado do
 * banco — nunca de estado local. É a fonte única usada pelo onboarding,
 * pelo dashboard do cliente e pelo painel admin (por isso é uma função
 * pura sobre linhas já carregadas: cada chamador busca as linhas com o
 * client certo — RLS pro cliente, service role pro admin).
 *
 * Os ids 'account'/'whatsapp'/'agent'/'active' são lidos por nome em
 * components/onboarding/wizard.tsx — não renomear/remover.
 */
export type SetupStep = {
  id: 'account' | 'whatsapp' | 'agent' | 'active' | `employee_${string}`
  /** rótulo curto, em linguagem de dono de negócio */
  label: string
  done: boolean
}

export type SetupStatus = {
  /** conta, WhatsApp, Sales Rep (configurado/ativo) + um passo por funcionário digital restante — pra render granular (chips). */
  steps: SetupStep[]
  /** 0–100 sobre TODOS os steps acima, incluindo os 6 funcionários digitais possíveis — quanto do potencial da plataforma o cliente já usa. Só bate 100 quando não sobra nenhum funcionário pra contratar. */
  progress: number
  /** true só quando TODOS os steps acima estão prontos (os 6 funcionários ativos) — não usar sozinho pra decidir "cliente travado no onboarding", ver `onboarded`. */
  complete: boolean
  /** true quando o básico está pronto — conta + WhatsApp + Sales Rep configurado e ativo. É o sinal certo pra "esse cliente está sendo atendido" / "esse cliente está travado no onboarding". */
  onboarded: boolean
  employeesActive: number
  employeesTotal: number
  /** primeira pendência, pronta pra virar CTA ("o que fazer agora") */
  nextAction: { label: string; description: string; href: string } | null
}

type UnitRow = Pick<Unit, 'id' | 'whatsapp_phone' | 'is_active'>
type AgentConfigRow = Pick<AgentConfig, 'unit_id' | 'agent_type' | 'is_active' | 'persona_name'>

/** Linha de unit_whatsapp_channels (migration 051) relevante pra saber se um número dedicado a um funcionário já foi conectado. */
export type UnitWhatsappChannelRow = { unit_id: string; agent_type: string; whatsapp_phone: string | null }

/**
 * Uma unidade "tem WhatsApp" quando o número compartilhado histórico
 * (units.whatsapp_phone) está preenchido OU quando existe uma instância
 * dedicada (unit_whatsapp_channels, migration 051) já conectada para o
 * `agentType` em questão — sem isso, unidades que conectaram o WhatsApp
 * de um funcionário específico via QR code (ver ensureDedicatedWhatsappChannel
 * em lib/evolution.ts) continuam aparecendo como "sem WhatsApp" pra sempre,
 * mesmo com a conexão funcionando de verdade.
 */
export function unitHasWhatsapp(
  unit: Pick<UnitRow, 'id' | 'whatsapp_phone'>,
  channels: UnitWhatsappChannelRow[],
  agentType: string,
): boolean {
  if (unit.whatsapp_phone) return true
  return channels.some((c) => c.unit_id === unit.id && c.agent_type === agentType && !!c.whatsapp_phone)
}

/**
 * Desempate determinístico pra escolher qual unidade uma tela mostra por
 * padrão quando a org tem mais de uma (ex.: catálogo de Equipe Digital,
 * onboarding) — nunca a ordem de retorno do banco, que NÃO é garantida
 * quando duas unidades têm o mesmo created_at (visto em produção: unidades
 * criadas no mesmo instante empatam e a ordem que o Postgres devolve pode
 * mudar). Entre as unidades ativas (ou todas, se nenhuma estiver ativa),
 * prioriza a que já tem mais progresso de configuração — WhatsApp
 * conectado, funcionários ativos — já que essa é a que o dono
 * provavelmente quer ver primeiro; o id como último desempate só existe
 * pra nunca sobrar ambiguidade nenhuma, nunca como critério "certo" por si só.
 */
export function pickDefaultUnit<U extends UnitRow>(
  units: U[],
  agentConfigs: AgentConfigRow[],
  whatsappChannels: UnitWhatsappChannelRow[] = [],
): U | null {
  if (units.length === 0) return null
  const candidates = units.some((u) => u.is_active) ? units.filter((u) => u.is_active) : units

  const score = (u: U): number => {
    const hasWhatsapp = unitHasWhatsapp(u, whatsappChannels, 'sdr') ? 1 : 0
    const activeAgents = agentConfigs.filter((c) => c.unit_id === u.id && c.is_active).length
    return hasWhatsapp * 100 + activeAgents
  }

  return [...candidates].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0] ?? null
}

/** Os outros 5 funcionários digitais possíveis, além do Sales Rep (coberto por 'agent'/'active' acima). */
const OTHER_EMPLOYEE_TYPES: { agentType: string; label: string }[] = [
  { agentType: 'receptionist', label: 'AI Receptionist ativo' },
  { agentType: 'recruiter', label: 'Recrutador ativo' },
  { agentType: 'traffic_specialist', label: 'Gestor de Tráfego ativo' },
  { agentType: 'content_specialist', label: 'Gestor de Conteúdo ativo' },
  { agentType: 'seo_specialist', label: 'Especialista em SEO ativo' },
]

export function computeSetupStatus(
  units: UnitRow[],
  agentConfigs: AgentConfigRow[],
  whatsappChannels: UnitWhatsappChannelRow[] = [],
): SetupStatus {
  const hasUnit = units.length > 0
  const whatsappConnected = units.some((u) => unitHasWhatsapp(u, whatsappChannels, 'sdr'))
  const sdrConfigs = agentConfigs.filter((c) => c.agent_type === 'sdr')
  const agentConfigured = sdrConfigs.length > 0
  const agentActive = sdrConfigs.some((c) => c.is_active)

  const otherEmployeeSteps: SetupStep[] = OTHER_EMPLOYEE_TYPES.map(({ agentType, label }) => ({
    id: `employee_${agentType}`,
    label,
    done: agentConfigs.some((c) => c.agent_type === agentType && c.is_active),
  }))

  const steps: SetupStep[] = [
    { id: 'account', label: 'Conta criada', done: hasUnit },
    { id: 'whatsapp', label: 'WhatsApp conectado', done: whatsappConnected },
    { id: 'agent', label: 'Sales Rep configurado', done: agentConfigured },
    { id: 'active', label: 'Sales Rep ativo', done: agentConfigured && agentActive },
    ...otherEmployeeSteps,
  ]

  const employeesActive = (agentActive ? 1 : 0) + otherEmployeeSteps.filter((s) => s.done).length
  const employeesTotal = 1 + OTHER_EMPLOYEE_TYPES.length

  const doneCount = steps.filter((s) => s.done).length
  const progress = Math.round((doneCount / steps.length) * 100)
  const complete = doneCount === steps.length
  const onboarded = hasUnit && whatsappConnected && agentConfigured && agentActive

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
  } else if (employeesActive < employeesTotal) {
    nextAction = {
      label: 'Contratar mais funcionários digitais',
      description: `Você já tem ${employeesActive} de ${employeesTotal} funcionários digitais trabalhando — dá pra automatizar mais áreas do negócio.`,
      href: '/dashboard/equipe-digital',
    }
  }

  return { steps, progress, complete, onboarded, employeesActive, employeesTotal, nextAction }
}
