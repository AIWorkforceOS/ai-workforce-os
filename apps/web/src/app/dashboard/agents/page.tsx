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

export default async function AgentsPage() {
  const supabase = await createClient()
  const { data: units } = await supabase.from('units').select('id, name, whatsapp_phone').order('name')
  const unitRows = (units ?? []) as { id: string; name: string; whatsapp_phone: string | null }[]
  const connectedUnits = unitRows.filter(u => u.whatsapp_phone)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Agentes IA</h1>
          <p className="mt-0.5 text-sm text-slate-500">Configuração e monitoramento dos agentes por unidade.</p>
        </div>
        <Link
          href="/dashboard/units"
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-green-700"
        >
          <Settings size={15} />
          Configurar unidades
        </Link>
      </div>

      {/* Status banner */}
      <div className="flex items-start gap-4 rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 p-5 shadow-sm">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-green-500 shadow-lg shadow-green-500/20">
          <Bot size={22} className="text-white" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-green-900">Agente SDR com IA</h2>
            <span className="flex items-center gap-1 rounded-full bg-green-200 px-2 py-0.5 text-[11px] font-bold text-green-800">
              <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
              Ativo via WhatsApp
            </span>
          </div>
          <p className="mt-1 text-sm text-green-800">
            O agente está operando nas unidades com WhatsApp conectado. Ele prospecta, qualifica e conduz as primeiras conversas com leads automaticamente.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {connectedUnits.length > 0 ? (
              connectedUnits.map(u => (
                <span key={u.id} className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-green-700 shadow-sm ring-1 ring-green-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  {u.name}
                </span>
              ))
            ) : (
              <span className="text-xs text-green-700">Nenhuma unidade conectada ainda.</span>
            )}
          </div>
        </div>
      </div>

      {/* Capabilities grid */}
      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">O que o agente faz</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: MessageSquare,
              color: 'text-green-600',
              bg: 'bg-green-50',
              title: 'Prospecção ativa',
              desc: 'Envia mensagens personalizadas para empresas potenciais via WhatsApp, com linguagem natural e contextualizada.',
            },
            {
              icon: Sparkles,
              color: 'text-violet-600',
              bg: 'bg-violet-50',
              title: 'Qualificação inteligente',
              desc: 'Identifica interesse, coleta informações-chave e classifica leads automaticamente por potencial.',
            },
            {
              icon: Zap,
              color: 'text-amber-600',
              bg: 'bg-amber-50',
              title: 'Respostas em tempo real',
              desc: 'Responde dúvidas, objeções e perguntas dos leads 24/7 sem intervenção manual.',
            },
            {
              icon: BarChart3,
              color: 'text-blue-600',
              bg: 'bg-blue-50',
              title: 'Atualização de status',
              desc: 'Atualiza automaticamente o status do lead (Novo → Contatado → Respondeu → Negociando).',
            },
            {
              icon: Bot,
              color: 'text-emerald-600',
              bg: 'bg-emerald-50',
              title: 'Histórico completo',
              desc: 'Todo o histórico da conversa fica registrado e acessível em Conversas → Lead.',
            },
            {
              icon: Settings,
              color: 'text-slate-600',
              bg: 'bg-slate-100',
              title: 'Configurável por unidade',
              desc: 'Cada unidade pode ter seu próprio número, prompt personalizado e agenda de prospecção.',
            },
          ].map(({ icon: Icon, color, bg, title, desc }) => (
            <div key={title} className="flex gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${bg}`}>
                <Icon size={16} className={color} />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-500">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Units status table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-slate-900">Status por unidade</h2>
          <Link href="/dashboard/units" className="text-xs text-green-600 hover:underline">
            Gerenciar unidades
          </Link>
        </div>
        {unitRows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
              <Bot size={22} className="text-slate-400" />
            </div>
            <p className="text-sm font-medium text-slate-700">Nenhuma unidade cadastrada</p>
            <p className="text-xs text-slate-500">Crie unidades e conecte o WhatsApp para ativar o agente.</p>
            <Link href="/dashboard/units/new" className="mt-1 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700">
              Criar unidade
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                <th className="px-5 py-3 font-medium">Unidade</th>
                <th className="px-5 py-3 font-medium">WhatsApp</th>
                <th className="px-5 py-3 font-medium">Status do agente</th>
                <th className="px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {unitRows.map((unit) => (
                <tr key={unit.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50">
                  <td className="px-5 py-3 font-medium text-slate-900">{unit.name}</td>
                  <td className="px-5 py-3 text-slate-600">{unit.whatsapp_phone ?? '—'}</td>
                  <td className="px-5 py-3">
                    {unit.whatsapp_phone ? (
                      <span className="flex w-fit items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Agente ativo
                      </span>
                    ) : (
                      <span className="flex w-fit items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                        Aguardando WhatsApp
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/dashboard/units/${unit.id}`}
                      className="flex items-center justify-end gap-1 text-xs text-slate-500 hover:text-green-600"
                    >
                      Configurar
                      <ChevronRight size={12} />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Coming soon note */}
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Em breve</p>
        <p className="mt-1 text-sm text-slate-600">
          Painel de configuração avançada por agente: edição de prompt, horários de disparo, limites de mensagens por dia e análise de performance por unidade.
        </p>
      </div>
    </div>
  )
}
