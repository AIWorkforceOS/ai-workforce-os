import Link from 'next/link'
import { MessageSquareText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui/dashboard-ui'
import type { BadgeVariant } from '@/components/ui/dashboard-ui'
import { InstructionsChat } from '@/components/dashboard/instructions-chat'
import { InstructionRowActions } from '@/components/dashboard/instruction-row-actions'
import {
  INSTRUCTION_PRIORITY_ORDER,
  INSTRUCTION_STATE_LABEL,
  dateKeyIn,
  instructionState,
  postsNeedingReview,
  type ContentInstruction,
  type InstructionState,
  type ReviewablePost,
} from '@/lib/content/instructions'
import type { Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STATE_VARIANT: Record<InstructionState, BadgeVariant> = { active: 'green', scheduled: 'blue', paused: 'amber', expired: 'slate', superseded: 'slate' }
const ACTION_LABEL: Record<string, string> = { created: 'Criada', edited: 'Período alterado', paused: 'Pausada', resumed: 'Retomada', superseded: 'Substituída', cancelled: 'Cancelada' }
const brDate = (d: string) => d.split('-').reverse().join('/')

type HistoryRow = { id: string; instruction_id: string; action: string; actor: string; created_at: string }

export default async function InstructionsPage() {
  const supabase = await createClient()
  const { data: units } = await supabase.from('units').select('*').order('created_at', { ascending: true })
  const unit = (units ?? [])[0] as Unit | undefined
  const timeZone = unit?.timezone || 'America/Phoenix'
  const today = dateKeyIn(new Date(), timeZone)

  const [{ data: rows }, { data: history }, { data: posts }] = unit
    ? await Promise.all([
        supabase.from('content_instructions').select('*').eq('unit_id', unit.id).order('starts_on', { ascending: false }),
        supabase.from('content_instruction_history').select('id, instruction_id, action, actor, created_at').eq('unit_id', unit.id).order('created_at', { ascending: true }),
        supabase
          .from('content_posts')
          .select('id, status, scheduled_for, instruction_id, caption, platform')
          .eq('unit_id', unit.id)
          .in('status', ['draft', 'pending_approval', 'approved', 'scheduled'])
          .not('scheduled_for', 'is', null),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }]
  const instructions = (rows ?? []) as ContentInstruction[]
  const historyBy = new Map<string, HistoryRow[]>()
  for (const h of (history ?? []) as HistoryRow[]) historyBy.set(h.instruction_id, [...(historyBy.get(h.instruction_id) ?? []), h])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="gestor de conteúdo"
        title="Instruções"
        subtitle="Diga em linguagem natural o que a empresa precisa num período. O agente confirma o que entendeu, guarda com histórico e passa a seguir nos próximos posts."
        action={
          <Link href="/dashboard/content" className="rounded-xl border border-white/10 px-3.5 py-2 text-xs font-bold text-slate-300 hover:bg-white/5">
            Voltar ao Gestor de Conteúdo
          </Link>
        }
      />

      {unit ? <InstructionsChat unitId={unit.id} /> : <EmptyState icon={<MessageSquareText size={20} />} title="Nenhuma unidade encontrada" subtitle="Crie uma unidade para dar instruções ao agente." />}

      <Card className="p-4">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Ordem de prioridade que o agente segue</p>
        <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-xs text-slate-300">
          {INSTRUCTION_PRIORITY_ORDER.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-slate-500">Instruções orientam tema, ângulo, formato e chamada para ação. Não alteram permissões, credenciais, limites financeiros nem regras de publicação, e o agente nunca inventa clientes, depoimentos ou resultados.</p>
      </Card>

      <div className="flex flex-col gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">Instruções registradas</p>
        {instructions.length === 0 && <EmptyState icon={<MessageSquareText size={20} />} title="Nenhuma instrução ainda" subtitle="Escreva a primeira acima." />}
        {instructions.map((i) => {
          const state = instructionState(i, today)
          const review = state === 'active' || state === 'scheduled' ? postsNeedingReview((posts ?? []) as ReviewablePost[], i, timeZone) : []
          const hist = historyBy.get(i.id) ?? []
          return (
            <Card key={i.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATE_VARIANT[state]}>{INSTRUCTION_STATE_LABEL[state]}</Badge>
                {i.priority === 'alta' && <Badge variant="red">Prioridade alta</Badge>}
                <span className="text-xs text-slate-400">
                  {brDate(i.starts_on)} {i.ends_on ? `→ ${brDate(i.ends_on)}` : '→ sem data final'}
                </span>
              </div>
              <p className="mt-2 text-sm font-bold text-white">{i.objective}</p>
              <p className="mt-1 text-xs text-slate-400">{i.interpretation.summary}</p>
              <details className="mt-2 text-xs text-slate-400">
                <summary className="cursor-pointer text-slate-300">Texto original e histórico</summary>
                <p className="mt-1 whitespace-pre-wrap rounded-lg bg-white/5 p-2">{i.original_text}</p>
                <p className="mt-1">Responsável: {i.created_by}</p>
                <ul className="mt-1 space-y-0.5">
                  {hist.map((h) => (
                    <li key={h.id}>
                      {new Date(h.created_at).toLocaleString('pt-BR')} · {ACTION_LABEL[h.action] ?? h.action} · {h.actor}
                    </li>
                  ))}
                </ul>
              </details>
              {i.conflict_notes.length > 0 && <p className="mt-2 text-[11px] text-amber-300">Conflito registrado: {i.conflict_notes.join(' · ')}</p>}
              {review.length > 0 && (
                <p className="mt-2 text-[11px] text-amber-300">
                  {review.length} post(s) já agendado(s) neste período foram gerados antes desta instrução.{' '}
                  <Link href="/dashboard/content" className="underline">Revisar na fila</Link>
                </p>
              )}
              {(state === 'active' || state === 'scheduled' || state === 'paused') && (
                <div className="mt-3">
                  <InstructionRowActions id={i.id} paused={i.paused} endsOn={i.ends_on} today={today} />
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
