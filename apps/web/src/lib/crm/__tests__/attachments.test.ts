import { describe, expect, it } from 'vitest'
import { formatBytes, leadAttachmentPath, safeAttachmentName, validateAttachmentFile } from '../attachments'

describe('attachments', () => {
  it('caminho começa pela unidade e nome é sanitizado', () => {
    expect(leadAttachmentPath('U', 'L', 'ID', '../Proposta final (v2).pdf')).toBe('U/L/ID-Proposta_final_v2_.pdf')
    expect(safeAttachmentName('???')).toBe('arquivo')
    expect(safeAttachmentName('a/b\\c.pdf')).toBe('a_b_c.pdf')
  })
  it('valida tamanho e tipo', () => {
    expect(validateAttachmentFile({ name: 'a.pdf', size: 1000, type: 'application/pdf' })).toBeNull()
    expect(validateAttachmentFile({ name: 'a.pdf', size: 0, type: 'application/pdf' })).toMatch(/vazio/)
    expect(validateAttachmentFile({ name: 'a.pdf', size: 16 * 1024 * 1024, type: 'application/pdf' })).toMatch(/15MB/)
    expect(validateAttachmentFile({ name: 'a.exe', size: 10, type: 'application/x-msdownload' })).toMatch(/tipo/)
  })
  it('formata tamanho', () => {
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
    expect(formatBytes(null)).toBe('')
  })
})
