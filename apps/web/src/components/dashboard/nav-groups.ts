import {
  LayoutDashboard,
  Building2,
  MapPin,
  Users,
  MessageSquare,
  UserCircle,
  Wallet,
  TrendingUp,
  Settings,
  ShoppingCart,
  Rocket,
  Kanban,
  Bot,
  Megaphone,
  Briefcase,
  Headset,
  Sparkles,
  CreditCard,
  Smartphone,
  ClipboardList,
  CalendarDays,
  Mail,
  FileText,
  Search,
  PieChart,
} from 'lucide-react'
import type { Locale } from '@/lib/i18n/config'
import type { ManagementMode } from '@/lib/types'

export type NavItem = {
  href: string
  label: Record<Locale, string>
  icon: typeof LayoutDashboard
  exact?: boolean
  /** visível apenas para super_admin (equipe Alizo) */
  superOnly?: boolean
  /** visível apenas quando organizations.management_mode = 'full_management' */
  fullManagementOnly?: boolean
}

// Arquitetura de navegação por OBJETIVO do usuário, não por tipo de
// funcionário digital que produz o dado — ex.: a página do Recrutador vive em
// "Pessoas e Recrutamento" ao lado da equipe humana, não agrupada com Tráfego
// só porque ambos são "agentes IA". Ver docs/ux-audit-fase1-2026-08-19.md §2.
//
// Fica num .ts separado (não no sidebar.tsx) de propósito: o vitest deste
// repo não tem transform de JSX configurado (tsconfig usa jsx:"preserve",
// que é o esperado pro compilador do Next, não pro esbuild do Vite) — nenhum
// teste existente importa um .tsx. Manter a lógica pura aqui deixa ela
// testável sem mexer na config compartilhada de testes.
export const navGroups: { label: Record<Locale, string>; items: NavItem[] }[] = [
  {
    label: { pt: 'Início', en: 'Home' },
    items: [
      { href: '/dashboard', label: { pt: 'Visão geral', en: 'Overview' }, icon: LayoutDashboard, exact: true },
      { href: '/dashboard/onboarding', label: { pt: 'Primeiros passos', en: 'Getting started' }, icon: Rocket },
      { href: '/dashboard/organizations', label: { pt: 'Clientes (empresas)', en: 'Clients (companies)' }, icon: Building2, superOnly: true },
    ],
  },
  {
    label: { pt: 'Caixa de Entrada', en: 'Inbox' },
    items: [
      { href: '/dashboard/conversations', label: { pt: 'Conversas', en: 'Conversations' }, icon: MessageSquare },
    ],
  },
  {
    label: { pt: 'Clientes e Vendas', en: 'Customers & Sales' },
    items: [
      { href: '/dashboard/receptionist/customers', label: { pt: 'Clientes', en: 'Customers' }, icon: Users, fullManagementOnly: true },
      { href: '/dashboard/crm', label: { pt: 'Funil de vendas', en: 'Sales pipeline' }, icon: Kanban },
      { href: '/dashboard/leads', label: { pt: 'Contatos (leads)', en: 'Contacts (leads)' }, icon: UserCircle },
      { href: '/dashboard/receptionist', label: { pt: 'AI Receptionist', en: 'AI Receptionist' }, icon: Headset },
      { href: '/dashboard/agents', label: { pt: 'AI Sales Representative', en: 'AI Sales Representative' }, icon: Bot },
    ],
  },
  {
    label: { pt: 'Agenda e Operação', en: 'Schedule & Operations' },
    items: [
      { href: '/dashboard/agenda', label: { pt: 'Agenda', en: 'Schedule' }, icon: CalendarDays, fullManagementOnly: true },
      { href: '/dashboard/operacao', label: { pt: 'Operação de serviços', en: 'Service operations' }, icon: ClipboardList },
    ],
  },
  {
    label: { pt: 'Pessoas e Recrutamento', en: 'People & Recruiting' },
    items: [
      { href: '/dashboard/employees', label: { pt: 'Equipe (pessoas)', en: 'Team (people)' }, icon: Users },
      { href: '/dashboard/recruiter', label: { pt: 'Recrutador (RH)', en: 'Recruiter (HR)' }, icon: Briefcase },
    ],
  },
  {
    label: { pt: 'Marketing', en: 'Marketing' },
    items: [
      { href: '/dashboard/traffic', label: { pt: 'Tráfego pago', en: 'Paid ads' }, icon: Megaphone },
      { href: '/dashboard/content', label: { pt: 'Conteúdo', en: 'Content' }, icon: FileText },
      { href: '/dashboard/seo', label: { pt: 'SEO', en: 'SEO' }, icon: Search },
      { href: '/dashboard/email-marketing', label: { pt: 'E-mail marketing', en: 'Email marketing' }, icon: Mail },
    ],
  },
  {
    label: { pt: 'Equipe Digital', en: 'Digital Team' },
    items: [
      { href: '/dashboard/equipe-digital', label: { pt: 'Contratar & ativar', en: 'Hire & activate' }, icon: Sparkles },
    ],
  },
  {
    label: { pt: 'Relatórios', en: 'Reports' },
    items: [
      { href: '/dashboard/results', label: { pt: 'Resultados', en: 'Results' }, icon: TrendingUp },
      { href: '/dashboard/financial', label: { pt: 'Cobranças', en: 'Billing' }, icon: Wallet, superOnly: true },
      { href: '/dashboard/sales', label: { pt: 'Vendas Alizo', en: 'Alizo sales' }, icon: ShoppingCart, exact: true, superOnly: true },
      { href: '/dashboard/sales/payments', label: { pt: 'Pagamentos (setup)', en: 'Payments (setup)' }, icon: CreditCard, superOnly: true },
      { href: '/dashboard/sales/financeiro', label: { pt: 'DRE (interno Alizo)', en: 'P&L (Alizo internal)' }, icon: PieChart, superOnly: true },
    ],
  },
  {
    label: { pt: 'Configurações', en: 'Settings' },
    items: [
      { href: '/dashboard/settings', label: { pt: 'Configurações gerais', en: 'General settings' }, icon: Settings },
      { href: '/dashboard/units', label: { pt: 'Unidades', en: 'Units' }, icon: MapPin },
      { href: '/dashboard/messaging/connect', label: { pt: 'Canal de mensagens (SMS)', en: 'Messaging channel (SMS)' }, icon: Smartphone },
    ],
  },
]

/**
 * Lógica pura de visibilidade do menu — separada do componente pra ser
 * testável sem DOM/renderer.
 */
export function getVisibleNavGroups({
  role = 'admin',
  unitId = null,
  managementMode = 'digital_employees',
}: {
  role?: string
  unitId?: string | null
  managementMode?: ManagementMode
}): { label: Record<Locale, string>; items: NavItem[] }[] {
  const isSuperAdmin = role === 'super_admin'
  const fullManagement = managementMode === 'full_management' && !isSuperAdmin

  return navGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter((item) => (isSuperAdmin || !item.superOnly) && (fullManagement || !item.fullManagementOnly))
        .map((item) => {
          // Dono de unidade não gerencia a lista de unidades — vai direto pra sua
          if (item.href === '/dashboard/units' && unitId) {
            return { ...item, href: `/dashboard/units/${unitId}`, label: { pt: 'Minha unidade', en: 'My unit' } as Record<Locale, string> }
          }
          // ...e a Operação e a Agenda dele são as da própria unidade, sem passar pelo hub
          if (item.href === '/dashboard/operacao' && unitId) {
            return { ...item, href: `/dashboard/units/${unitId}/operacao` }
          }
          if (item.href === '/dashboard/agenda' && unitId) {
            return { ...item, href: `/dashboard/units/${unitId}/agenda/calendario` }
          }
          return item
        }),
    }))
    .filter((group) => group.items.length > 0)
}
