import { createClient } from '@/lib/supabase/server'
import { getAppUser, ROLE_LABEL } from '@/lib/app-user'
import {
  Settings,
  Building2,
  Bot,
  Zap,
  ShieldCheck,
  Bell,
  Webhook,
} from 'lucide-react'
import { Card, PageHeader } from '@/components/ui/dashboard-ui'
import { CopyField } from '@/components/dashboard/copy-field'
import type { Unit } from '@/lib/types'

const SECTIONS = [
  {
    icon: Building2,
    iconGrad: 'from-blue-400 to-indigo-500',
    title: 'Empresas e planos',
    desc: 'Gerencie as empresas clientes, planos contratados e limites de unidades/agentes.',
    href: '/dashboard/organizations',
    cta: 'Ver empresas',
    badge: null,
    superOnly: true,
  },
  {
    icon: Bot,
    iconGrad: 'from-cyan-400 to-teal-500',
    title: 'Agentes IA',
    desc: 'Configure os prompts, horários de disparo e parâmetros dos agentes por unidade.',
    href: '/dashboard/agents',
    cta: 'Ver agentes',
    badge: 'Em breve',
    superOnly: false,
  },
  {
    icon: Zap,
    iconGrad: 'from-amber-400 to-orange-500',
    title: 'Integrações',
    desc: 'Gerencie conexões com Evolution API, WhatsApp e outros serviços externos.',
    href: '/dashboard/units',
    cta: 'Ver unidades',
    badge: null,
    superOnly: false,
  },
  {
    icon: ShieldCheck,
    iconGrad: 'from-violet-400 to-purple-500',
    title: 'Segurança',
    desc: 'Alteração de senha, autenticação e configurações de acesso à plataforma.',
    href: '#',
    cta: 'Em breve',
    badge: 'Em breve',
    superOnly: false,
  },
  {
    icon: Bell,
    iconGrad: 'from-slate-400 to-slate-500',
    title: 'Notificações',
    desc: 'Configure alertas de leads, WhatsApp desconectado e relatórios automáticos.',
    href: '#',
    cta: 'Em breve',
    badge: 'Em breve',
    superOnly: false,
  },
  {
    icon: Settings,
    iconGrad: 'from-slate-400 to-slate-500',
    title: 'Custos do sistema',
    desc: 'Acompanhe os custos mensais por serviço: Evolution API, Supabase, Vercel, IA.',
    href: '/dashboard/financial',
    cta: 'Ver financeiro',
    badge: null,
    superOnly: true,
  },
]

export default async function SettingsPage() {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const isSuperAdmin = appUser?.isSuperAdmin ?? false

  // Com RLS ativo, o cliente só recebe as próprias unidades aqui
  const { data: units } = await supabase
    .from('units')
    .select('id, name, slug, intake_token')
    .eq('is_active', true)
    .order('name')

  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name' | 'slug' | 'intake_token'>[]
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://SEU-DOMINIO.vercel.app'
  const webhookUrl = `${baseUrl.replace(/\/+$/, '')}/api/intake/lead`

  const visibleSections = SECTIONS.filter((section) => isSuperAdmin || !section.superOnly)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="plataforma" title="Configurações" subtitle="Preferências e configurações gerais da plataforma." />

      {/* Account info */}
      <Card className="p-5">
        <h2 className="mb-4 text-sm font-bold text-white">Sua conta</h2>
        <div className="flex items-center gap-4">
          <div
            className="flex h-12 w-12 items-center justify-center rounded-full text-sm font-black text-white"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 10px rgba(6,182,212,0.3)' }}
          >
            {appUser?.email?.slice(0, 2).toUpperCase() ?? 'AW'}
          </div>
          <div>
            <p className="text-sm font-semibold text-white">{appUser?.email ?? '—'}</p>
            <p className="text-xs text-slate-500">
              {appUser?.isSuperAdmin
                ? 'Administrador da plataforma'
                : appUser?.orgName
                  ? `Empresa: ${appUser.orgName}`
                  : 'Usuário da plataforma'}
            </p>
          </div>
          <span className="ml-auto rounded-full px-3 py-1 text-xs font-bold" style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
            {appUser ? ROLE_LABEL[appUser.role] : '—'}
          </span>
        </div>
      </Card>

      {/* Webhook de intake — integração self-service com CRM externo */}
      <Card className="p-5">
        <div className="mb-4 flex items-start gap-3">
          <div
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-blue-500"
            style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
          >
            <Webhook size={16} className="text-white" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">Receber leads de outros sistemas (webhook)</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
              Conecte seu site, Zapier, Make ou qualquer CRM: envie um POST para a URL abaixo e o lead
              cai direto no pipeline — com primeiro contato automático via WhatsApp quando o agente
              estiver ativo.
            </p>
          </div>
        </div>

        <div className="mb-4">
          <CopyField label="URL do webhook (POST)" value={webhookUrl} />
        </div>

        {unitRows.length === 0 ? (
          <p className="text-xs text-slate-500">Nenhuma unidade ativa — crie uma unidade para gerar o token de integração.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {unitRows.map((unit) => (
              <div
                key={unit.id}
                className="rounded-xl p-4"
                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <p className="mb-3 text-xs font-bold text-white">{unit.name}</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <CopyField label="unit_slug (no corpo do POST)" value={unit.slug} />
                  {unit.intake_token ? (
                    <CopyField label="Token (header Authorization: Bearer ...)" value={unit.intake_token} mask />
                  ) : (
                    <p className="self-end text-[11px] text-amber-400">
                      Token ainda não gerado — aplique a migration 4 no Supabase.
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs font-semibold" style={{ color: '#06b6d4' }}>
            Como configurar no Zapier / Make (passo a passo)
          </summary>
          <div className="mt-3 space-y-2 text-xs leading-relaxed text-slate-400">
            <p>1. Crie um Zap/Cenário com o gatilho do seu formulário ou CRM (ex.: novo lead no RD Station, nova linha no Google Sheets).</p>
            <p>2. Adicione uma ação <strong className="text-slate-300">Webhooks → POST</strong> apontando para a URL acima.</p>
            <p>3. Em Headers, adicione <code className="text-cyan-300">Authorization</code> = <code className="text-cyan-300">Bearer SEU_TOKEN</code> (token da unidade acima).</p>
            <p>4. No corpo (JSON), envie:</p>
            <pre
              className="overflow-x-auto rounded-xl p-3 text-[11px] leading-relaxed text-slate-300"
              style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.06)' }}
            >{`{
  "unit_slug": "sua-unidade",
  "name": "Nome do lead",
  "phone": "5511999999999",
  "email": "lead@empresa.com",
  "source": "zapier",
  "send_whatsapp": true
}`}</pre>
            <p>5. Teste: o lead deve aparecer em CRM Pipeline em segundos. Com <code className="text-cyan-300">send_whatsapp: true</code> e agente ativo, o primeiro contato sai automaticamente.</p>
          </div>
        </details>
      </Card>

      {/* Settings sections */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {visibleSections.map(({ icon: Icon, iconGrad, title, desc, href, cta, badge }) => (
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
