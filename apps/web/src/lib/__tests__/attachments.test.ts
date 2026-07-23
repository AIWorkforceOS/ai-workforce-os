import { describe, expect, it } from 'vitest'
import { buildAttachmentsContext } from '@/lib/attachments'
import type { EmployeeAttachment } from '@/lib/types'

function makeAttachment(overrides: Partial<EmployeeAttachment> = {}): EmployeeAttachment {
  return {
    id: 'attachment-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    agent_type: 'sdr',
    kind: 'pdf',
    title: 'Tabela de preços',
    usage_instructions: 'Envie quando o cliente perguntar sobre preços.',
    file_url: 'https://example.com/tabela.pdf',
    file_name: 'tabela.pdf',
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildAttachmentsContext', () => {
  it('devolve string vazia sem anexos ativos', () => {
    expect(buildAttachmentsContext([])).toBe('')
  })

  it('inclui id, título e instrução de uso de cada anexo', () => {
    const context = buildAttachmentsContext([makeAttachment()])
    expect(context).toContain('attachment-1')
    expect(context).toContain('Tabela de preços')
    expect(context).toContain('Envie quando o cliente perguntar sobre preços.')
    expect(context).toContain('attachment_id')
  })

  it('diferencia PDF de link no rótulo do material', () => {
    const context = buildAttachmentsContext([
      makeAttachment({ id: 'a', kind: 'pdf', title: 'PDF X' }),
      makeAttachment({ id: 'b', kind: 'link', title: 'Link Y', file_url: 'https://example.com' }),
    ])
    expect(context).toContain('"PDF X" (PDF)')
    expect(context).toContain('"Link Y" (link)')
  })
})
