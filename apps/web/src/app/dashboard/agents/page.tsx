import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  Bot,
  Zap,
  MessageSquare,
  BarChart3,
  Settings,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import { Card, PageHeader, PrimaryButton, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'

const CAPABILITIES = [
  {
    icon: MessageSquare,
    iconGrad: 'from-cyan-400 to-teal-500',
    title: 'Prospecção ativa',
    desc: 'Envia mensagens personalizadas para empresas potenciais via WhatsApp, com linguagem natural e contextualizada.',
  },
  {
    icon: Sparkles,
    iconGrad: 'from-violet-400 to-purple-500',
    title: 'Qualificação inteligente',
    desc: 'Identifica interesse, coleta informações-chave e classifica leads automaticamente por potencial.',
  },
  {
    icon: Zap,
    iconGrad: 'from-amber-400 to-orange-500',
    title: 'Respostas em tempo real',
    desc: 'Responde dúvidas, objeções e perguntas dos leads 24/7 sem intervenção manual.',
  },
  {
    icon: BarChart3,
    iconGrad: 'from-blue-400 to-indigo-500',
    title: 'Atualização de status',
    desc: 'Atualiza automaticamente o status do lead (Novo → Contatado → Respondeu → Negociando).',
  },
  {
    icon: Bot,
    iconGrad: 'from-emerald-400 to-green-500',
    title: 'Histórico completo',
    desc: 'Todo o histórico da conversa fica registrado e acessível em Conversas → Lead.',
  },
  {
    icon: Settings,
    iconGrad: 'from-slate-400 to-slate-500',
    title: 'Configurável por unidade',
    desc: 'Cada unidade pode ter seu próprio número, prompt personalizado e agenda de prospecção.',
  },
]

export default async function AgentsPage() {
  const supabase = await createClient()
  const { data: units } = await supabase.from('units').select('id, name, whatsapp_phone').order('name')
  const unitRows = (units ?? []) as { id: string; name: string; whatsapp_phone: string | null }[]
  const connectedUnits = unitRows.filter(u => u.whatsapp_phone)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="automação"
        title="Agentes IA"
        subtitle="Configuração e monitoramento dos agentes por unidade."
        action={
          <PrimaryButton href="/dashboard/units" icon={<Settings size={14} />}>
            Configurar unidades
          </PrimaryButton>
        }
      />

      {/* Status banner */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <div
            className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            <Bot size={22} className="text-white" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-white">Agente SDR com IA</h2>
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: 'rgba(34,197,94,0.15)', color: '#4ade80' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                Ativo via WhatsApp
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">
              O agente está operando nas unidades com WhatsApp conectado. Ele prospecta, qualifica e conduz as primeiras conversas com leads automaticamente.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {connectedUnits.length > 0 ? (
                connectedUnits.map(u => (
                  <span
                    key={u.id}
                    className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-slate-200"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(34,197,94,0.25)' }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                    {u.name}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">Nenhuma unidade conectada ainda.</span>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Capabilities grid */}
      <div>
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">O que o agente faz</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {CAPABILITIES.map(({ icon: Icon, iconGrad, title, desc }) => (
            <Card key={title} className="flex gap-4 p-4">
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${iconGrad}`} style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}>
                <Icon size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{desc}</p>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Units status table */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-bold text-white">Status por unidade</h2>
          <Link href="/dashboard/units" className="text-xs font-semibold" style={{ color: '#06b6d4' }}>
            Gerenciar unidades
          </Link>
        </div>
        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
              <Bot size={22} className="text-slate-500" />
            </div>
            <p className="text-sm font-bold text-white">Nenhuma unidade cadastrada</p>
            <p className="text-xs text-slate-400">Crie unidades e conecte o WhatsApp para ativar o agente.</p>
            <Link
              href="/dashboard/units/new"
              className="mt-1 rounded-xl px-4 py-2 text-sm font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
            >
              Criar unidade
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <TableShell>
              <Th>Unidade</Th>
              <Th>WhatsApp</Th>
              <Th>Status do agente</Th>
              <th className="px-5 py-3" />
            </TableShell>
            <tbody>
              {unitRows.map((unit) => (
                <Tr key={unit.id}>
                  <Td className="font-medium text-white">{unit.name}</Td>
                  <Td className="text-slate-400">{unit.whatsapp_phone ?? '—'}</Td>
                  <Td>
                    {unit.whatsapp_phone ? (
                      <span className="flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold" style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
                        Agente ativo
                      </span>
                    ) : (
                      <span className="flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-slate-500" style={{ background: 'rgba(255,255,255,0.05)' }}>
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                        Aguardando WhatsApp
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link href={`/dashboard/units/${unit.id}`} className="flex items-center justify-end gap-1 text-xs text-slate-400 transition-colors hover:text-cyan-400">
                      Configurar
                      <ChevronRight size={12} />
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Coming soon note */}
      <div className="rounded-2xl px-5 py-4" style={{ border: '1px dashed rgba(255,255,255,0.12)' }}>
        <p className="text-xs font-black uppercase tracking-wider text-slate-500">Em breve</p>
        <p className="mt-1 text-sm text-slate-400">
          Painel de configuração avançada por agente: edição de prompt, horários de disparo, limites de mensagens por dia e análise de performance por unidade.
        </p>
      </div>
    </div>
  )
}
