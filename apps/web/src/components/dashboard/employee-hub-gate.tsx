import { UserPlus } from 'lucide-react'
import { AlertBanner, PrimaryButton } from '@/components/ui/dashboard-ui'

/** Os 6 funcionários digitais do catálogo — mesma lista de employee-catalog.tsx. */
export type HubAgentType = 'sdr' | 'recruiter' | 'receptionist' | 'content_specialist' | 'traffic_specialist' | 'seo_specialist'

export const HUB_AGENT_LABEL: Record<HubAgentType, string> = {
  sdr: 'o Sales Rep',
  recruiter: 'o Recrutador',
  receptionist: 'a Recepcionista',
  content_specialist: 'o Gestor de Conteúdo',
  traffic_specialist: 'o Gestor de Tráfego',
  seo_specialist: 'o Especialista em SEO',
}

/**
 * Banner "o que fazer agora" no topo do painel de cada funcionário —
 * pedido do Vinicius (2026-09-18): "se quando clicar o funcionário não tá
 * disponível no plano ou ainda não foi treinado o sistema irá indicar o
 * que fazer". Não existe hoje nenhum controle técnico de plano/entitlement
 * no código (confirmado — só uma frase pedindo pra falar com o suporte,
 * ver employee-catalog.tsx) — não inventei um sistema de planos novo aqui,
 * só cubro os dois estados reais que o banco já modela: nunca contratado
 * (sem linha em agent_configs) e contratado-mas-pausado (is_active=false).
 * `hired`/`active` vêm de uma contagem simples em agent_configs pro
 * agent_type — RLS já escopa pra org certa, sem precisar filtrar
 * org_id/unit_id explicitamente aqui.
 */
export function EmployeeHubGate({ agentType, hired, active }: { agentType: HubAgentType; hired: boolean; active: boolean }) {
  if (hired && active) return null
  const label = HUB_AGENT_LABEL[agentType]
  return (
    <AlertBanner
      tone="warning"
      icon={<UserPlus size={20} className="text-white" />}
      eyebrow={hired ? 'pausado' : 'ainda não contratado'}
      title={hired ? `Você pausou ${label}` : `Você ainda não contratou ${label}`}
      description={
        hired
          ? 'Reative pra ele voltar a trabalhar — os dados abaixo são do histórico, enquanto ele estiver pausado.'
          : 'Contrate em poucos passos — ele te entrevista rapidinho pra aprender sua empresa antes de começar.'
      }
      action={<PrimaryButton href="/dashboard/equipe-digital">{hired ? 'Ver e reativar' : 'Contratar agora'}</PrimaryButton>}
    />
  )
}
