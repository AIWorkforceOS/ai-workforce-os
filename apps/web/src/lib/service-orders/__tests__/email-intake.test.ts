import { describe, expect, it, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/__tests__/fake-supabase'
import { findIntakeUnitId, ingestOrderEmail, intakeAddress, pickOrderAttachment, safeFileName, MAX_AWAITING_PER_UNIT } from '../email-intake'

const UNIT = '11111111-1111-4111-8111-111111111111'

describe('endereço e destinatário', () => {
  it('monta e reconhece o endereço da unidade', () => {
    const addr = intakeAddress(UNIT, 'in.alizoai.com')
    expect(findIntakeUnitId([`Mawi <${addr.toUpperCase()}>`], 'in.alizoai.com')).toBe(UNIT)
    expect(findIntakeUnitId([addr], 'outro.com')).toBeNull()
    expect(findIntakeUnitId(['ordens+not-a-uuid@in.alizoai.com'], 'in.alizoai.com')).toBeNull()
    expect(findIntakeUnitId([`reply+${UNIT}@in.alizoai.com`], 'in.alizoai.com')).toBeNull()
  })
})

describe('pickOrderAttachment', () => {
  const a = (id: string, type: string, extra = {}) => ({ id, filename: `${id}`, content_type: type, content_disposition: 'attachment', size: 1000, ...extra })
  it('prefere PDF, ignora inline e arquivos grandes/estranhos', () => {
    expect(pickOrderAttachment([a('img', 'image/png'), a('pdf', 'application/pdf')])?.id).toBe('pdf')
    expect(pickOrderAttachment([a('sig', 'image/png', { content_disposition: 'inline' })])).toBeNull()
    expect(pickOrderAttachment([a('big', 'application/pdf', { size: 20 * 1024 * 1024 })])).toBeNull()
    expect(pickOrderAttachment([a('zip', 'application/zip')])).toBeNull()
    expect(pickOrderAttachment([a('photo', 'image/jpeg')])?.id).toBe('photo')
  })
  it('nome de arquivo seguro', () => {
    expect(safeFileName('../../Ordem 123 (final).pdf')).toBe('Ordem_123_final_.pdf')
    expect(safeFileName(null)).toBe('ordem')
  })
})

function storageStub(ok = true) {
  return {
    from: () => ({
      upload: vi.fn(async () => (ok ? { error: null } : { error: { message: 'x' } })),
      getPublicUrl: (p: string) => ({ data: { publicUrl: `https://cdn/${p}` } }),
    }),
  }
}

function setup(seed: Record<string, Record<string, unknown>[]> = {}, storageOk = true) {
  const fake = createFakeSupabase({ appointments: [], customers: [], ...seed })
  Object.assign(fake.supabase, { storage: storageStub(storageOk) })
  return fake
}

const input = (extra = {}) => ({
  unit: { id: UNIT, org_id: 'org1' },
  emailId: 'em1',
  from: 'Fulano <ordens@acme.com>',
  subject: 'PO 123',
  receivedAt: '2026-10-24T14:00:00.000Z',
  attachments: [] as never[],
  ...extra,
})

const fetchOk = vi.fn(async (url: string | URL | Request) => {
  const u = String(url)
  if (u.includes('/attachments/')) return new Response(JSON.stringify({ download_url: 'https://dl/x' }), { status: 200 })
  return new Response(new Uint8Array([1, 2, 3]), { status: 200 })
}) as unknown as typeof fetch

describe('ingestOrderEmail', () => {
  it('cria a ordem aguardando aceite, sem técnico, no cadastro "Ordens por e-mail"', async () => {
    const f = setup()
    const r = await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input())
    expect(r).toMatchObject({ ok: true, attached: false })
    const appt = f.db.appointments![0]!
    expect(appt).toMatchObject({ unit_id: UNIT, source: 'email_intake', intake_status: 'awaiting_accept', intake_email_id: 'em1', intake_from: 'ordens@acme.com', status: 'scheduled' })
    expect(appt.employee_id).toBeUndefined()
    expect(f.db.customers![0]).toMatchObject({ name: 'Ordens por e-mail', source: 'email_intake' })
  })

  it('liga ao cliente cadastrado com o e-mail do remetente', async () => {
    const f = setup({ customers: [{ id: 'c1', unit_id: UNIT, name: 'Loja', email: 'ordens@acme.com', client_company: 'ACME' }] })
    await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input())
    expect(f.db.appointments![0]!.customer_id).toBe('c1')
    expect(f.db.customers).toHaveLength(1)
  })

  it('é idempotente: mesmo e-mail não cria duas ordens', async () => {
    const f = setup()
    await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input())
    const again = await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input())
    expect(again).toMatchObject({ ok: false, skipped: 'duplicate' })
    expect(f.db.appointments).toHaveLength(1)
  })

  it('freia quando há ordens demais esperando aceite', async () => {
    const f = setup({ appointments: Array.from({ length: MAX_AWAITING_PER_UNIT }, (_, i) => ({ id: `a${i}`, unit_id: UNIT, intake_status: 'awaiting_accept' })) })
    const r = await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input())
    expect(r).toMatchObject({ ok: false, skipped: 'too_many_pending' })
  })

  it('anexa o PDF quando o download funciona e segue sem anexo quando falha', async () => {
    const att = [{ id: 'at1', filename: 'PO 123.pdf', content_type: 'application/pdf', content_disposition: 'attachment', size: 3 }]
    const f = setup()
    const r = await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k', fetchImpl: fetchOk }, input({ attachments: att }))
    expect(r).toMatchObject({ ok: true, attached: true })
    expect(String(f.db.appointments![0]!.service_order_file_url)).toContain(`${UNIT}/`)

    const g = setup({}, false)
    const r2 = await ingestOrderEmail({ supabase: g.supabase, apiKey: 'k', fetchImpl: fetchOk }, input({ attachments: att }))
    expect(r2).toMatchObject({ ok: true, attached: false })
    expect(g.db.appointments).toHaveLength(1)
  })

  it('recusa unidade sem empresa', async () => {
    const f = setup()
    expect(await ingestOrderEmail({ supabase: f.supabase, apiKey: 'k' }, input({ unit: { id: UNIT, org_id: null } }))).toMatchObject({ ok: false })
  })
})
