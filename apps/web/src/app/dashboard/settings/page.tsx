import { createClient } from '@/lib/supabase/server'
import {
  Settings,
  Building2,
  Bot,
  Zap,
  ShieldCheck,
  Bell,
} from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/dashboard-ui'

const SECTIONS = [
  {
    icon: Building2,
    iconGrad: 'from-blue-400 to-indigo-500',
    title: 'Empresas e planos',
    desc: 'Gerencie as empresas clientes, planos contratados e limites de unidades/agentes.',
    href: '/dashboard/organizations',
    cta: 'Ver empresas',
    badge: null,
  },
  {
    icon: Bot,
    iconGrad: 'from-cyan-400 to-teal-500',
    title: 'Agentes IA',
    desc: 'Configure os prompts, horários de disparo e parâmetros dos agentes por unidade.',
    href: '/dashboard/agents',
    cta: 'Ver agentes',
    badge: 'Em breve',
  },
  {
    icon: Zap,
    iconGrad: 'from-amber-400 to-orange-500',
    title: 'Integrações',
    desc: 'Gerencie conexões com Evolution API, WhatsApp e outros serviços externos.',
    href: '/dashboard/units',
    cta: 'Ver unidades',
    badge: null,
  },
  {
    icon: ShieldCheck,
    iconGrad: 'from-violet-400 to-purple-500',
    title: 'Segurança',
    desc: 'Alteração de senha, autenticação e configurações de acesso à plataforma.',
    href: '#',
    cta: 'Em breve',
    badge: 'Em breve',
  },
  {
    icon: Bell,
    iconGrad: 'from-slate-400 to-slate-500',
    title: 'Notificações',
    desc: 'Configure alertas de leads, WhatsApp desconectado e relatórios automáticos.',
    href: '#',
    cta: 'Em breve',
    badge: 'Em breve',
  },
  {
    icon: Settings,
    iconGrad: 'from-slate-400 to-slate-500',
    title: 'Custos do sistema',
    desc: 'Acompanhe os custos mensais por serviço: Evolution API, Supabase, Vercel, IA.',
    href: '/dashboard/financial',
    cta: 'Ver financeiro',
    badge: null,
  },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="plataforma" title="Configurações" subtitle="Preferências e configurações gerais da plataforma." />

      {/* Account info */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-bold text-white">Conta de administrador</h2>
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-white"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 10px rgba(6,182,212,0.3)' }}
          >
            {user?.email?.slice(0, 2).toUpperCase() ?? 'AW'}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{user?.email ?? '—'}</p>
            <p className="text-xs text-slate-500">Administrador da plataforma</p>
          </div>
          <span className="ml-auto rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
            Admin
          </span>
        </div>
      </Card>

      {/* Settings sections */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {SECTIONS.map(({ icon: Icon, iconGrad, title, desc, href, cta, badge }) => (
          <Card key={title} className="flex flex-col gap-3 p-5">
            <div className="flex items-start justify-between">
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                <Icon size={16} className="text-white" />
              </div>
              {badge && (
                <span className="rounded-full px-2 py-0.5 text-[11px] font-medium text-slate-400" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  {badge}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{desc}</p>
            </div>
            <a
              href={href}
              className={`mt-auto text-xs font-semibold ${badge ? 'cursor-default text-slate-500' : 'hover:underline'}`}
              style={badge ? undefined : { color: '#06b6d4' }}
            >
              {cta} {!badge && '→'}
            </a>
          </Card>
        ))}
      </div>

      {/* Version */}
      <p className="text-center text-xs text-slate-500">Alizo · AI Workforce OS · v1.0 · RC0</p>
    </div>
  )
}
