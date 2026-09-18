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
  CalendarDays,
  Link2,
  Mail,
  FileText,
  Search,
  PieChart,
  Camera,
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
  /** visível apenas quando organizations.facilit_integration_enabled = true (Mawi Pro, migration 083) — integração específica desse cliente */
  facilitOnly?: boolean
}

// Arquitetura de navegação por FUNCIONÁRIO DIGITAL, não por objetivo do
// usuário (arquitetura anterior, Fase 2/2026-08-20 — ver
// docs/ux-audit-fase1-2026-08-19.md §2) — pedido direto do Vinicius
// (2026-09-18): "o Sistema Alizo tem muita coisa no menu lateral... fica
// didático... precisamos deixar apenas o que de fato importa". Só o que é
// mais usado no dia a dia fica em destaque (Início, Funcionários, Agenda,
// Financeiro); o resto do sistema (Configurações, Clientes/Conversas,
// itens só de super_admin etc.) desce pros grupos finais, sem sumir do
// menu — só deixa de competir por atenção com o que importa mais.
//
// Cada funcionário aqui leva direto pro MESMO "painel" que
// employee-catalog.tsx já usa como panelHref — a barra de abas
// (EmployeeHubTabs, ver as 6 páginas em app/dashboard/{agents,recruiter,
// receptionist,traffic,content,seo}/page.tsx) é quem dá acesso, dali, a
// configurar/treinar/testar/conexões/materiais — não precisa de item de
// menu separado pra cada uma dessas ações.
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
      { href: '/dashboard/onboarding', label: { pt: 'Treinamento guiado', en: 'Guided training' }, icon: Rocket },
    ],
  },
  {
    label: { pt: 'Funcionários', en: 'Employees' },
    items: [
      { href: '/dashboard/agents', label: { pt: 'Vendas', en: 'Sales' }, icon: Bot },
      { href: '/dashboard/recruiter', label: { pt: 'RH (Recrutador)', en: 'HR (Recruiter)' }, icon: Briefcase },
      { href: '/dashboard/receptionist', label: { pt: 'Recepção', en: 'Receptionist' }, icon: Headset },
      { href: '/dashboard/content', label: { pt: 'Gestor de Conteúdo', en: 'Content Manager' }, icon: Camera },
      { href: '/dashboard/traffic', label: { pt: 'Tráfego pago', en: 'Paid ads' }, icon: Megaphone },
      { href: '/dashboard/seo', label: { pt: 'SEO', en: 'SEO' }, icon: Search },
    ],
  },
  {
    label: { pt: 'Agenda', en: 'Schedule' },
    items: [
      { href: '/dashboard/agenda', label: { pt: 'Agenda', en: 'Schedule' }, icon: CalendarDays, fullManagementOnly: true },
    ],
  },
  {
    label: { pt: 'Financeiro', en: 'Finance' },
    items: [
      { href: '/dashboard/operacao', label: { pt: 'Financeiro', en: 'Finance' }, icon: Wallet },
    ],
  },
  {
    label: { pt: 'Clientes e Conversas', en: 'Customers & Conversations' },
    items: [
      { href: '/dashboard/conversations', label: { pt: 'Caixa de Entrada', en: 'Inbox' }, icon: MessageSquare },
      { href: '/dashboard/crm', label: { pt: 'Funil de vendas', en: 'Sales pipeline' }, icon: Kanban },
      { href: '/dashboard/leads', label: { pt: 'Contatos (leads)', en: 'Contacts (leads)' }, icon: UserCircle },
      { href: '/dashboard/receptionist/customers', label: { pt: 'Clientes', en: 'Customers' }, icon: Users, fullManagementOnly: true },
    ],
  },
  {
    label: { pt: 'Sistema', en: 'System' },
    items: [
      { href: '/dashboard/equipe-digital', label: { pt: 'Contratar & ativar', en: 'Hire & activate' }, icon: Sparkles },
      { href: '/dashboard/employees', label: { pt: 'Equipe (pessoas)', en: 'Team (people)' }, icon: Users },
      { href: '/dashboard/results', label: { pt: 'Resultados', en: 'Results' }, icon: TrendingUp },
      { href: '/dashboard/email-marketing', label: { pt: 'E-mail marketing', en: 'Email marketing' }, icon: Mail },
      { href: '/dashboard/facilit', label: { pt: 'Facil-IT (360)', en: 'Facil-IT (360)' }, icon: Link2, facilitOnly: true },
      { href: '/dashboard/settings', label: { pt: 'Configurações gerais', en: 'General settings' }, icon: Settings },
      { href: '/dashboard/units', label: { pt: 'Unidades', en: 'Units' }, icon: MapPin },
      { href: '/dashboard/messaging/connect', label: { pt: 'Canal de mensagens (SMS)', en: 'Messaging channel (SMS)' }, icon: Smartphone },
      { href: '/dashboard/organizations', label: { pt: 'Clientes (empresas)', en: 'Clients (companies)' }, icon: Building2, superOnly: true },
      { href: '/dashboard/financial', label: { pt: 'Cobranças', en: 'Billing' }, icon: FileText, superOnly: true },
      { href: '/dashboard/sales', label: { pt: 'Vendas Alizo', en: 'Alizo sales' }, icon: ShoppingCart, exact: true, superOnly: true },
      { href: '/dashboard/sales/payments', label: { pt: 'Pagamentos (setup)', en: 'Payments (setup)' }, icon: CreditCard, superOnly: true },
      { href: '/dashboard/sales/financeiro', label: { pt: 'DRE (interno Alizo)', en: 'P&L (Alizo internal)' }, icon: PieChart, superOnly: true },
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
  facilitEnabled = false,
}: {
  role?: string
  unitId?: string | null
  managementMode?: ManagementMode
  /** organizations.facilit_integration_enabled (migration 083) — só Mawi Pro por enquanto */
  facilitEnabled?: boolean
}): { label: Record<Locale, string>; items: NavItem[] }[] {
  const isSuperAdmin = role === 'super_admin'
  const fullManagement = managementMode === 'full_management' && !isSuperAdmin

  return navGroups
    .map((group) => ({
      ...group,
      items: group.items
        .filter(
          (item) =>
            (isSuperAdmin || !item.superOnly) &&
            (fullManagement || !item.fullManagementOnly) &&
            (facilitEnabled || !item.facilitOnly),
        )
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
          if (item.href === '/dashboard/facilit' && unitId) {
            return { ...item, href: `/dashboard/units/${unitId}/facilit` }
          }
          return item
        }),
    }))
    .filter((group) => group.items.length > 0)
}
