import type { SupabaseClient } from '@supabase/supabase-js'
import { getAppUser, type AppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { effectiveQuoteTeamMode, type QuoteTeamMode } from '../config'
import { SupabaseJobStore, type QuoteJobRow } from '../job-store'
import { assertNoCommercialFields, toAdminJobStatus, toTechnicianDraftView } from '../visibility'
import { listQuoteMessages, toTechnicianMessage, type QuoteMessageRow } from './messages'
import { technicianStatusLabel } from './status'

export type AgentAppointment = {
  id: string
  unit_id: string
  org_id: string
  employee_id: string | null
  service_order_status: string | null
  service_order_number: string | null
  service_order_client_po: string | null
  service_order_location_name: string | null
  service_order_material_description: string | null
  service_order_photos: { url: string; kind?: string; uploaded_at?: string }[] | null
  address: string | null
  starts_at: string
}

export type AgentContext = {
  actor: 'technician' | 'admin'
  appUser: AppUser
  db: SupabaseClient
  appointment: AgentAppointment
  unit: { id: string; org_id: string; mode: QuoteTeamMode }
  store: SupabaseJobStore
}

export type AgentContextResult = { ok: true; ctx: AgentContext } | { ok: false; status: number; error: string }

const APPOINTMENT_COLUMNS = 'id, unit_id, org_id, employee_id, service_order_status, service_order_number, service_order_client_po, service_order_location_name, service_order_material_description, service_order_photos, address, starts_at'

/**
 * Quem pode usar o Super Agente numa WO (regra no SERVIDOR, em cima da RLS):
 *  - técnico: dono da ordem, funcionário marcado no piloto (employees.quote_agent_enabled) e unidade em modo 'live';
 *  - admin da empresa (ou super admin): unidade em 'shadow' ou 'live';
 *  - qualquer outro: 404 (não revela que existe).
 */
export async function loadAgentContext(unitId: string, appointmentId: string): Promise<AgentContextResult> {
  const appUser = await getAppUser()
  if (!appUser) return { ok: false, status: 401, error: 'Não autenticado.' }
  const db = createServiceClient()
  if (!db) return { ok: false, status: 503, error: 'Serviço indisponível.' }

  // a RLS do usuário decide se ele enxerga esta ordem (técnico só a própria; admin só da sua empresa)
  const userDb = await createClient()
  const { data } = await userDb.from('appointments').select(APPOINTMENT_COLUMNS).eq('id', appointmentId).eq('unit_id', unitId).maybeSingle()
  const appointment = data as AgentAppointment | null
  if (!appointment) return { ok: false, status: 404, error: 'Não encontrado.' }

  const { data: unitRow } = await db.from('units').select('id, org_id, quote_ai_team_mode').eq('id', unitId).maybeSingle()
  const unitData = unitRow as { id: string; org_id: string | null; quote_ai_team_mode?: string | null } | null
  if (!unitData?.org_id) return { ok: false, status: 404, error: 'Não encontrado.' }
  const mode = effectiveQuoteTeamMode(unitData.quote_ai_team_mode)
  const unit = { id: unitData.id, org_id: unitData.org_id, mode }
  const store = new SupabaseJobStore(db)

  const isAdmin = appUser.isSuperAdmin || (appUser.role === 'admin' && appUser.orgId === unit.org_id && (!appUser.unitId || appUser.unitId === unit.id))
  if (isAdmin) {
    if (mode === 'off') return { ok: false, status: 409, error: 'Super Agente desligado para esta unidade.' }
    return { ok: true, ctx: { actor: 'admin', appUser, db, appointment, unit, store } }
  }
  if (appUser.role === 'employee' && appUser.employeeId && appUser.employeeId === appointment.employee_id && appUser.orgId === unit.org_id) {
    if (mode !== 'live') return { ok: false, status: 404, error: 'Não encontrado.' }
    const { data: emp } = await db.from('employees').select('quote_agent_enabled, is_active').eq('id', appUser.employeeId).maybeSingle()
    const e = emp as { quote_agent_enabled?: boolean; is_active?: boolean } | null
    if (!e?.quote_agent_enabled || e.is_active === false) return { ok: false, status: 404, error: 'Não encontrado.' }
    return { ok: true, ctx: { actor: 'technician', appUser, db, appointment, unit, store } }
  }
  return { ok: false, status: 404, error: 'Não encontrado.' }
}

/** O técnico deste usuário pode ver o painel do agente nesta ordem? (usado pela página, sem montar o contexto completo) */
export async function isAgentAvailableForEmployee(db: SupabaseClient, employeeId: string, unitId: string): Promise<boolean> {
  const [{ data: emp }, { data: unit }] = await Promise.all([
    db.from('employees').select('quote_agent_enabled, is_active').eq('id', employeeId).maybeSingle(),
    db.from('units').select('quote_ai_team_mode').eq('id', unitId).maybeSingle(),
  ])
  const e = emp as { quote_agent_enabled?: boolean; is_active?: boolean } | null
  return Boolean(e?.quote_agent_enabled) && e?.is_active !== false && effectiveQuoteTeamMode((unit as { quote_ai_team_mode?: string | null } | null)?.quote_ai_team_mode) === 'live'
}

type Row = Record<string, unknown>
export type DraftSummary = { id: string; version: number; status: string; technical_check: string; created_at: string; approved_at: string | null }

async function loadDraftBundle(db: SupabaseClient, draftId: string) {
  const [items, options, labor, media] = await Promise.all([
    db.from('quote_items').select('*').eq('draft_id', draftId).order('position', { ascending: true }),
    db.from('quote_item_options').select('*').eq('draft_id', draftId),
    db.from('quote_labor_plan').select('*').eq('draft_id', draftId).maybeSingle(),
    db.from('quote_draft_media').select('*').eq('draft_id', draftId).order('position', { ascending: true }),
  ])
  return { items: (items.data as Row[] | null) ?? [], options: (options.data as Row[] | null) ?? [], labor: (labor.data as Row | null) ?? null, media: (media.data as Row[] | null) ?? [] }
}

/** Estado completo da cotação para a tela. TÉCNICO: lista permitida + detector de vazamento; ADMIN: também custos de IA e camada comercial. */
export async function buildAgentState(ctx: AgentContext) {
  const { db, appointment } = ctx
  const job: QuoteJobRow | null = await ctx.store.findByAppointment(appointment.id)
  const { data: draftRows } = await db.from('quote_drafts').select('*').eq('appointment_id', appointment.id).order('version', { ascending: false })
  const drafts = (draftRows as Row[] | null) ?? []
  const current = drafts.find((d) => d.status === 'approved') ?? drafts.find((d) => d.status === 'draft') ?? drafts[0] ?? null
  const versions: DraftSummary[] = drafts.map((d) => ({ id: String(d.id), version: Number(d.version), status: String(d.status), technical_check: String(d.technical_check), created_at: String(d.created_at), approved_at: (d.approved_at as string | null) ?? null }))
  const messages = (await listQuoteMessages(db, appointment.id)).filter((m) => ctx.actor === 'admin' || m.role !== 'system' || m.kind === 'status')
  const status = technicianStatusLabel(job, current ? { status: String(current.status) } : null)

  const bundle = current ? await loadDraftBundle(db, String(current.id)) : null
  const view = current && bundle ? toTechnicianDraftView({ draft: current, ...bundle }) : null
  const technicianJob = job ? { id: job.id, status: job.status, stage: job.stage, rounds: job.rounds, pending: job.pending_items.map((p) => ({ code: p.code, message_pt: p.message_pt, item_ref: p.item_ref ?? null })) } : null
  const pendingQuestion = [...messages].reverse().find((m) => m.kind === 'question' && m.role === 'agent') ?? null
  const awaiting = job?.status === 'needs_input' ? pendingQuestion : null

  const base = {
    status,
    job: technicianJob,
    draft: view,
    versions,
    messages: messages.map(toTechnicianMessage),
    awaiting_question: awaiting ? toTechnicianMessage(awaiting) : null,
    photo_policy: (job?.input_snapshot as { photo_policy?: unknown } | undefined)?.photo_policy ?? null,
  }
  assertNoCommercialFields(base)

  if (ctx.actor !== 'admin') return { actor: 'technician' as const, ...base }

  let commercial: Row | null = null
  if (current) {
    const { data } = await db.from('quote_commercial').select('*').eq('draft_id', String(current.id)).maybeSingle()
    commercial = (data as Row | null) ?? null
  }
  return { actor: 'admin' as const, ...base, admin: { job: job ? toAdminJobStatus(job) : null, commercial, ai_original: current ? (current.ai_original as unknown) : null } }
}

export type { QuoteMessageRow }
