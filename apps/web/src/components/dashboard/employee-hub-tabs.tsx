'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { brandGradient } from '@/components/ui/dashboard-ui'
import { WhatsAppStatusButton } from './whatsapp-status-button'
import type { HubAgentType } from './employee-hub-gate'

/**
 * Barra de abas no topo do painel de cada funcionário — pedido do
 * Vinicius (2026-09-18): "quando clicar em cada um deles abri todas as
 * funções... configurar, treinar, vizualizar seu empenho, relatório de
 * empenho, conexões". "Painel" (a própria página) já cobre
 * empenho/relatório; as outras abas reaproveitam rotas que já existem
 * (entrevista/testar/recursos em /dashboard/equipe-digital, o WhatsApp
 * dedicado já usado no catálogo) — nada aqui é uma tela nova, só um jeito
 * mais direto de chegar nelas a partir do painel de cada funcionário.
 *
 * "Configurar" só é um link de verdade pra sdr/recruiter (única tela de
 * edição pós-contratação que existe hoje, AgentConfigForm em
 * /dashboard/units/[id]/agent) — pros outros 4 tipos a aba aparece
 * desabilitada com "Em breve", mesmo padrão de honestidade já usado em
 * /dashboard/agents. Não inventei 4 telas de configuração novas aqui.
 */
export function EmployeeHubTabs({
  agentType,
  unitId,
  configId,
  panelHref,
  whatsappEligible,
  connectHref,
}: {
  agentType: HubAgentType
  /** unidade usada pra Materiais/Conexões/Configurar — null quando a org ainda não tem nenhuma unidade */
  unitId: string | null
  /** id do agent_configs — null quando o funcionário ainda não foi contratado (esconde Treinar/Testar) */
  configId: string | null
  panelHref: string
  /** sdr/recruiter/receptionist usam WhatsApp dedicado — mostra status ao vivo em vez de um link de aba */
  whatsappEligible: boolean
  /** tráfego/conteúdo conectam contas de anúncio/redes sociais — link de aba normal */
  connectHref?: string | null
}) {
  const pathname = usePathname()
  const canConfigure = agentType === 'sdr' || agentType === 'recruiter'

  const tabs: { key: string; label: string; href: string }[] = [{ key: 'painel', label: 'Painel', href: panelHref }]
  if (configId) {
    tabs.push({ key: 'treinar', label: 'Treinar', href: `/dashboard/equipe-digital/${configId}/entrevista` })
    tabs.push({ key: 'testar', label: 'Testar', href: `/dashboard/equipe-digital/${configId}/testar` })
  }
  if (canConfigure && unitId) {
    tabs.push({ key: 'configurar', label: 'Configurar', href: `/dashboard/units/${unitId}/agent` })
  }
  if (connectHref) {
    tabs.push({ key: 'conexoes', label: 'Conexões', href: connectHref })
  }
  if (unitId) {
    tabs.push({ key: 'materiais', label: 'Materiais', href: `/dashboard/equipe-digital/recursos?unit=${unitId}&employee=${agentType}` })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-b pb-3" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
      {tabs.map((tab) => {
        const isActive = tab.key === 'painel' ? pathname === tab.href : pathname.startsWith(tab.href.split('?')[0]!)
        return (
          <Link
            key={tab.key}
            href={tab.href}
            className="rounded-lg px-3 py-1.5 text-xs font-bold transition-colors"
            style={isActive ? { background: brandGradient, color: '#fff' } : { color: '#94a3b8', background: 'rgba(255,255,255,0.04)' }}
          >
            {tab.label}
          </Link>
        )
      })}
      {!canConfigure && (
        <span
          className="rounded-lg px-3 py-1.5 text-xs font-bold text-slate-600"
          title="Configuração dedicada pra este funcionário ainda não existe — em breve."
        >
          Configurar · Em breve
        </span>
      )}
      {whatsappEligible && unitId && (
        <div className="ml-0 w-full sm:ml-auto sm:w-56">
          <WhatsAppStatusButton unitId={unitId} agentType={agentType} label="WhatsApp" />
        </div>
      )}
    </div>
  )
}
