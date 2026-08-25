import {
  Bot, Briefcase, Camera, Headset, Megaphone, Search, type LucideIcon,
} from 'lucide-react'

// Metadados dos 6 funcionários digitais possíveis, usados pelo wizard de
// contratação guiado (components/dashboard/hire-wizard.tsx) — generaliza
// o padrão que hoje só existe pro Sales Rep em components/onboarding/wizard.tsx.
// Mantido separado dos textos de marketing do catálogo
// (components/dashboard/employee-catalog.tsx) de propósito: aqui é só o
// que o wizard precisa pra decidir seus passos.

export type WizardAgentType =
  | 'sdr'
  | 'recruiter'
  | 'traffic_specialist'
  | 'receptionist'
  | 'content_specialist'
  | 'seo_specialist'

export function isWizardAgentType(value: string): value is WizardAgentType {
  return (
    value === 'sdr' ||
    value === 'recruiter' ||
    value === 'traffic_specialist' ||
    value === 'receptionist' ||
    value === 'content_specialist' ||
    value === 'seo_specialist'
  )
}

/** O que o passo "Conectar" do wizard deve mostrar, por tipo de funcionário. */
export type ConnectStepConfig =
  | { type: 'whatsapp' }
  | { type: 'external-link'; label: string; description: string; href: string }
  | { type: 'seo-audit' }
  | { type: 'none'; description: string }

export type EmployeeWizardMeta = {
  agentType: WizardAgentType
  name: string
  icon: LucideIcon
  color: string
  /** true = o funcionário se apresenta pra pessoas (cliente/candidato) e precisa de nome próprio */
  askName: boolean
  defaultName: string
  /** true = conversa com pessoas de verdade e por isso tem "jeito de falar" configurável */
  askTone: boolean
  connectStep: ConnectStepConfig
  /** true = tem "Testar Funcionário" (simulação de conversa) — só quem conversa com cliente/candidato simulado */
  testable: boolean
  panelHref: string
}

export const EMPLOYEE_WIZARD_META: Record<WizardAgentType, EmployeeWizardMeta> = {
  sdr: {
    agentType: 'sdr',
    name: 'AI Sales Representative',
    icon: Bot,
    color: '#818cf8',
    askName: true,
    // Nunca "Kai" — esse nome é reservado pra assistente da própria Alizo
    // (kai-launcher.tsx); um funcionário SDR com o mesmo nome padrão confundia
    // o cliente assim que a Kai passou a orquestrar a contratação dele.
    defaultName: 'Théo',
    askTone: true,
    connectStep: { type: 'whatsapp' },
    testable: true,
    panelHref: '/dashboard/agents',
  },
  recruiter: {
    agentType: 'recruiter',
    name: 'Recrutador (RH)',
    icon: Briefcase,
    color: '#f59e0b',
    askName: true,
    defaultName: 'Rafa',
    askTone: true,
    connectStep: { type: 'whatsapp' },
    testable: true,
    panelHref: '/dashboard/recruiter',
  },
  receptionist: {
    agentType: 'receptionist',
    name: 'AI Receptionist',
    icon: Headset,
    color: '#22d3ee',
    askName: true,
    defaultName: 'Ana',
    askTone: true,
    connectStep: {
      type: 'none',
      description:
        'Não precisa conectar nada agora: os clientes aparecem automaticamente no cadastro assim que o Sales Rep fechar um negócio, e ele usa o mesmo WhatsApp já conectado da unidade.',
    },
    testable: true,
    panelHref: '/dashboard/receptionist',
  },
  traffic_specialist: {
    agentType: 'traffic_specialist',
    name: 'Gestor de Tráfego',
    icon: Megaphone,
    color: '#ef4444',
    askName: false,
    defaultName: 'Gestor de Tráfego',
    askTone: false,
    connectStep: {
      type: 'external-link',
      label: 'Conectar suas contas de anúncio',
      description:
        'Você mesmo conecta pelo painel (Facebook/Instagram e Google) — testamos e confirmamos na hora, sem precisar gerar token.',
      href: '/dashboard/traffic/connect',
    },
    testable: false,
    panelHref: '/dashboard/traffic',
  },
  content_specialist: {
    agentType: 'content_specialist',
    name: 'Gestor de Conteúdo',
    icon: Camera,
    color: '#a855f7',
    askName: false,
    defaultName: 'Gestor de Conteúdo',
    askTone: false,
    connectStep: {
      type: 'external-link',
      label: 'Conectar Instagram e Facebook',
      description:
        'Você mesmo conecta pelo painel a Página do Facebook (o Instagram vinculado a ela vem junto) — testamos e confirmamos na hora.',
      href: '/dashboard/content/connect',
    },
    testable: false,
    panelHref: '/dashboard/content',
  },
  seo_specialist: {
    agentType: 'seo_specialist',
    name: 'Especialista em SEO',
    icon: Search,
    color: '#10b981',
    askName: false,
    defaultName: 'Especialista em SEO',
    askTone: false,
    connectStep: { type: 'seo-audit' },
    testable: false,
    panelHref: '/dashboard/seo',
  },
}
