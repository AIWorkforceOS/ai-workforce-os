import { describe, expect, it } from 'vitest'
import { buildAttachmentsContext, truncateAttachmentText } from '@/lib/attachments'
import type { EmployeeAttachment } from '@/lib/types'

function makeAttachment(overrides: Partial<EmployeeAttachment> = {}): EmployeeAttachment {
  return {
    id: 'attachment-1',
    org_id: 'org-1',
    unit_id: 'unit-1',
    applicable_employees: ['sdr'],
    kind: 'pdf',
    title: 'Tabela de preços',
    usage_instructions: 'Envie quando o cliente perguntar sobre preços.',
    file_url: 'https://example.com/tabela.pdf',
    file_name: 'tabela.pdf',
    extracted_text: null,
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

  it('diferencia PDF, imagem e link no rótulo do material', () => {
    const context = buildAttachmentsContext([
      makeAttachment({ id: 'a', kind: 'pdf', title: 'PDF X' }),
      makeAttachment({ id: 'b', kind: 'link', title: 'Link Y', file_url: 'https://example.com' }),
      makeAttachment({ id: 'c', kind: 'image', title: 'Imagem Z' }),
    ])
    expect(context).toContain('"PDF X" (PDF)')
    expect(context).toContain('"Link Y" (link)')
    expect(context).toContain('"Imagem Z" (imagem)')
  })

  it('inclui o texto extraído do PDF no contexto quando presente (item 5, migration 063)', () => {
    const context = buildAttachmentsContext([
      makeAttachment({ extracted_text: 'Cláusula 1: o contrato vale por 12 meses.' }),
    ])
    expect(context).toContain('Cláusula 1: o contrato vale por 12 meses.')
  })

  it('não menciona conteúdo do documento quando extracted_text é null (link, imagem, ou extração nunca rodou/falhou)', () => {
    const context = buildAttachmentsContext([makeAttachment({ extracted_text: null })])
    expect(context).not.toContain('conteúdo do documento')
  })

  it('trunca o texto extraído antes de injetar, pra não estourar o orçamento de tokens do prompt', () => {
    const longText = 'a'.repeat(10_000)
    const context = buildAttachmentsContext([makeAttachment({ extracted_text: longText })])
    expect(context).toContain('[conteúdo truncado]')
    expect(context.length).toBeLessThan(longText.length)
  })
})

describe('truncateAttachmentText', () => {
  it('devolve o texto original quando já está dentro do limite', () => {
    expect(truncateAttachmentText('texto curto', 100)).toBe('texto curto')
  })

  it('corta no limite e sinaliza truncamento', () => {
    const result = truncateAttachmentText('a'.repeat(50), 10)
    expect(result).toBe(`${'a'.repeat(10)}\n[conteúdo truncado]`)
  })
})
