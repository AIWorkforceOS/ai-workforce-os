import { createClient } from '@/lib/supabase/server'
import {
  Settings,
  Building2,
  Bot,
  Zap,
  ShieldCheck,
  Bell,
} from 'lucide-react'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Configurações</h1>
        <p className="mt-0.5 text-sm text-slate-500">Preferências e configurações gerais da plataforma.</p>
      </div>

      {/* Account info */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="mb-4 text-sm font-semibold text-slate-900">Conta de administrador</h2>
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-500 text-sm font-black text-white shadow-sm">
            {user?.email?.slice(0, 2).toUpperCase() ?? 'AW'}
          </div>
          <div>
            <p className="text-sm font-semibold text-slate-800">{user?.email ?? '—'}</p>
            <p className="text-xs text-slate-500">Administrador da plataforma</p>
          </div>
          <span className="ml-auto rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
            Admin
          </span>
        </div>
      </div>

      {/* Settings sections */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          {
            icon: Building2,
            color: 'text-blue-600',
            bg: 'bg-blue-50',
            title: 'Empresas e planos',
            desc: 'Gerencie as empresas clientes, planos contratados e limites de unidades/agentes.',
            href: '/dashboard/organizations',
            cta: 'Ver empresas',
            badge: null,
          },
          {
            icon: Bot,
            color: 'text-green-600',
            bg: 'bg-green-50',
            title: 'Agentes IA',
            desc: 'Configure os prompts, horários de disparo e parâmetros dos agentes por unidade.',
            href: '/dashboard/agents',
            cta: 'Ver agentes',
            badge: 'Em breve',
          },
          {
            icon: Zap,
            color: 'text-amber-600',
            bg: 'bg-amber-50',
            title: 'Integrações',
            desc: 'Gerencie conexões com Evolution API, WhatsApp e outros serviços externos.',
            href: '/dashboard/units',
            cta: 'Ver unidades',
            badge: null,
          },
          {
            icon: ShieldCheck,
            color: 'text-violet-600',
            bg: 'bg-violet-50',
            title: 'Segurança',
            desc: 'Alteração de senha, autenticação e configurações de acesso à plataforma.',
            href: '#',
            cta: 'Em breve',
            badge: 'Em breve',
          },
          {
            icon: Bell,
            color: 'text-slate-600',
            bg: 'bg-slate-100',
            title: 'Notificações',
            desc: 'Configure alertas de leads, WhatsApp desconectado e relatórios automáticos.',
            href: '#',
            cta: 'Em breve',
            badge: 'Em breve',
          },
          {
            icon: Settings,
            color: 'text-slate-600',
            bg: 'bg-slate-100',
            title: 'Custos do sistema',
            desc: 'Acompanhe os custos mensais por serviço: Evolution API, Supabase, Vercel, IA.',
            href: '/dashboard/financial',
            cta: 'Ver financeiro',
            badge: null,
          },
        ].map(({ icon: Icon, color, bg, title, desc, href, cta, badge }) => (
          <div key={title} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}>
                <Icon size={16} className={color} />
              </div>
              {badge && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
                  {badge}
                </span>
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800">{title}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
            </div>
            <a
              href={href}
              className={`mt-auto text-xs font-medium ${badge ? 'cursor-default text-slate-400' : 'text-green-600 hover:underline'}`}
            >
              {cta} {!badge && '→'}
            </a>
          </div>
        ))}
      </div>

      {/* Version */}
      <p className="text-center text-xs text-slate-400">AI Workforce OS · v1.0 · RC0</p>
    </div>
  )
}
