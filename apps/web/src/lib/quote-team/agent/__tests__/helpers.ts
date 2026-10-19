import { BudgetGuard } from '../../budget'
import type { Diagnosis } from '../../contracts'
import { InMemoryJobStore, type NewQuoteJob, type QuoteJobRow } from '../../job-store'
import type { StageContext } from '../../runner'
import type { AgentSnapshot } from '../context'

export const newJob = (over: Partial<NewQuoteJob> = {}): NewQuoteJob => ({
  org_id: 'org-1', unit_id: 'unit-1', appointment_id: 'appt-1', idempotency_key: 'k' + Math.random(), trigger_source: 'manual', mode: 'live',
  input_snapshot: { notes: 'Porta da loja não fecha direito', media_urls: ['https://x.supabase.co/a.jpg'], conversation: [] } satisfies AgentSnapshot as Record<string, unknown>,
  photo_count: 1, photo_exception_reason: null, budget_usd: 0.6, created_by: 'user-1', ...over,
})

/** Job em execução (com lease) + contexto de etapa com orçamento real (InMemory). */
export async function stageContext(opts: { snapshot?: AgentSnapshot; stepResults?: Record<string, unknown>; store?: InMemoryJobStore; budget?: number; rounds?: number } = {}) {
  const store = opts.store ?? new InMemoryJobStore()
  const { job } = await store.insert(newJob({ budget_usd: opts.budget ?? 0.6, ...(opts.snapshot ? { input_snapshot: opts.snapshot as Record<string, unknown> } : {}) }))
  await store.claim(job.id, 'w', 300)
  if (opts.rounds) await store.update(job.id, { rounds: opts.rounds })
  const row = (await store.get(job.id)) as QuoteJobRow
  const ctx: StageContext = { job: row, stepResults: opts.stepResults ?? {}, budget: new BudgetGuard(store, job.id) }
  return { store, job: row, ctx }
}

export const diagnosisFixture = (over: Partial<Diagnosis> = {}): Diagnosis => ({
  summary_pt: 'Porta comercial não fecha; mola aérea possivelmente desregulada.',
  problem_en: 'The storefront door does not latch closed.',
  evidence: [{ fact: 'The door closer arm is visible above the door.', photo_refs: [0], confidence: 'high' }],
  hypotheses: [{ text: 'Closer needs adjustment', confidence: 'medium' }],
  identified: { brand: null, model: null, part_numbers: [], labels_read: [] },
  additional_info_needed: [],
  safety_risks: [],
  scope_pt: 'Ajustar a mola aérea.',
  scope_en: 'Adjust the door closer.',
  photos_analyzed: 1,
  visual_confidence: 'medium',
  insufficient_photos: false,
  ...over,
})

export const materialsFixture = (items: Record<string, unknown>[] = [], questions: Record<string, unknown>[] = []) => ({
  items: items.map((i) => ({ kind: 'material', necessity: 'required', name_en: 'Door closer', description_pt: 'Mola aérea', quantity: 1, unit: 'ea', brand: null, model: null, part_number: null, dimensions: null, compatibility: null, reason: 'Replace worn closer', confidence: 'medium', needs_confirmation: null, waste_pct: null, waste_justification: null, ...i })),
  questions: questions.map((q) => ({ kind: 'label', request_pt: 'Foto da etiqueta da mola', blocking: true, ...q })),
})

export const laborFixture = (over: Record<string, unknown> = {}) => ({ technicians: 1, service_hours: 1.5, travel_hours: null, idle_hours: null, multi_technician_justification: null, justification_pt: 'Ajuste simples', description_en: 'Adjust closer and test.', breakdown: [{ phase: 'Adjust closer', hours: 1 }, { phase: 'Test door', hours: 0.5 }], ...over })
