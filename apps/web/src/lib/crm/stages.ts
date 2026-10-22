import type { LeadStatus } from '@/lib/types'

/** Com qual comportamento a etapa conta. É o que agentes, métricas e conversões leem (leads.status). */
export const STAGE_KINDS: { kind: LeadStatus; label: string; hint: string }[] = [
  { kind: 'new', label: 'Novo', hint: 'Lead que acabou de chegar' },
  { kind: 'contacted', label: 'Em contato', hint: 'Já foi abordado' },
  { kind: 'replied', label: 'Respondeu', hint: 'Respondeu ao contato' },
  { kind: 'negotiating', label: 'Negociando', hint: 'Em conversa comercial' },
  { kind: 'won', label: 'Convertido', hint: 'Virou cliente — conta como venda' },
  { kind: 'lost', label: 'Perdido', hint: 'Não vai fechar' },
]

export type StageColor = 'slate' | 'blue' | 'amber' | 'purple' | 'green' | 'red' | 'cyan' | 'pink'

export const STAGE_COLORS: Record<StageColor, { label: string; accent: string; bg: string; variant: 'slate' | 'blue' | 'amber' | 'purple' | 'green' | 'red' | 'cyan' }> = {
  slate: { label: 'Cinza', accent: 'linear-gradient(90deg,#64748b,#94a3b8)', bg: 'rgba(255,255,255,0.02)', variant: 'slate' },
  blue: { label: 'Azul', accent: 'linear-gradient(90deg,#2563eb,#3b82f6)', bg: 'rgba(59,130,246,0.04)', variant: 'blue' },
  amber: { label: 'Âmbar', accent: 'linear-gradient(90deg,#d97706,#f59e0b)', bg: 'rgba(245,158,11,0.04)', variant: 'amber' },
  purple: { label: 'Roxo', accent: 'linear-gradient(90deg,#7c3aed,#a78bfa)', bg: 'rgba(139,92,246,0.04)', variant: 'purple' },
  green: { label: 'Verde', accent: 'linear-gradient(90deg,#16a34a,#22c55e)', bg: 'rgba(34,197,94,0.04)', variant: 'green' },
  red: { label: 'Vermelho', accent: 'linear-gradient(90deg,#dc2626,#f87171)', bg: 'rgba(239,68,68,0.04)', variant: 'red' },
  cyan: { label: 'Ciano', accent: 'linear-gradient(90deg,#0891b2,#22d3ee)', bg: 'rgba(6,182,212,0.04)', variant: 'cyan' },
  pink: { label: 'Rosa', accent: 'linear-gradient(90deg,#db2777,#f472b6)', bg: 'rgba(236,72,153,0.04)', variant: 'purple' },
}

export type StageRow = { id: string; name: string; kind: LeadStatus; color: StageColor; position: number }

/** O funil padrão de hoje: usado enquanto a empresa não personaliza (nenhuma linha em crm_stages). */
export const DEFAULT_STAGES: Omit<StageRow, 'id'>[] = [
  { name: 'Novo', kind: 'new', color: 'slate', position: 0 },
  { name: 'Em Contato', kind: 'contacted', color: 'blue', position: 1 },
  { name: 'Respondeu', kind: 'replied', color: 'amber', position: 2 },
  { name: 'Negociando', kind: 'negotiating', color: 'purple', position: 3 },
  { name: 'Convertido', kind: 'won', color: 'green', position: 4 },
  { name: 'Perdido', kind: 'lost', color: 'red', position: 5 },
]

export type Column = { key: string; stageId: string | null; label: string; kind: LeadStatus; color: StageColor }

/** Colunas do quadro: as etapas da empresa em ordem, ou o funil padrão se ela ainda não personalizou. */
export function columnsFrom(rows: StageRow[] | null | undefined): Column[] {
  if (!rows || rows.length === 0) return DEFAULT_STAGES.map((s) => ({ key: s.kind, stageId: null, label: s.name, kind: s.kind, color: s.color }))
  return [...rows].sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR')).map((s) => ({ key: s.id, stageId: s.id, label: s.name, kind: s.kind, color: s.color }))
}

/**
 * Em qual coluna o lead está: a etapa escolhida, se ainda combina com o comportamento atual dele (status); senão a primeira etapa desse comportamento.
 * Assim um agente que muda o status sozinho nunca deixa o lead "preso" numa etapa errada, e leads antigos (sem etapa) caem na etapa certa.
 */
export function columnKeyOf(lead: { status: LeadStatus; stage_id?: string | null }, columns: Column[]): string {
  const chosen = lead.stage_id ? columns.find((c) => c.stageId === lead.stage_id && c.kind === lead.status) : undefined
  if (chosen) return chosen.key
  return (columns.find((c) => c.kind === lead.status) ?? columns[0]!).key
}

/** Coluna vizinha (-1 anterior, +1 próxima) na ordem do quadro; null nas pontas. */
export function neighborColumn<T extends Column>(current: string, columns: T[], direction: -1 | 1): T | null {
  const i = columns.findIndex((c) => c.key === current)
  if (i === -1) return null
  return columns[i + direction] ?? null
}

/** O funil precisa ter ao menos uma etapa de cada comportamento essencial para os agentes e as métricas funcionarem. */
const REQUIRED_KINDS: LeadStatus[] = ['new', 'won', 'lost']

export function validateStageSet(rows: { name: string; kind: LeadStatus }[]): string | null {
  if (rows.length === 0) return null // sem linhas = funil padrão
  const names = new Set<string>()
  for (const r of rows) {
    const n = r.name.trim().replace(/\s+/g, ' ').toLowerCase()
    if (!n) return 'Toda etapa precisa de um nome.'
    if (n.length > 40) return 'O nome da etapa pode ter no máximo 40 caracteres.'
    if (names.has(n)) return `Já existe uma etapa chamada "${r.name.trim()}".`
    names.add(n)
  }
  for (const kind of REQUIRED_KINDS) {
    if (!rows.some((r) => r.kind === kind)) {
      const label = STAGE_KINDS.find((k) => k.kind === kind)!.label
      return `O funil precisa de pelo menos uma etapa que conte como "${label}".`
    }
  }
  return null
}

export function canDeleteStage(rows: { id: string; kind: LeadStatus }[], id: string): string | null {
  const target = rows.find((r) => r.id === id)
  if (!target) return null
  if (rows.length <= 1) return 'O funil precisa ter ao menos uma etapa.'
  if (REQUIRED_KINDS.includes(target.kind) && rows.filter((r) => r.kind === target.kind).length === 1) {
    return `Esta é a única etapa que conta como "${STAGE_KINDS.find((k) => k.kind === target.kind)!.label}". Crie outra antes de apagar.`
  }
  return null
}
