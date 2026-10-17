import { afterEach, describe, expect, it, vi } from 'vitest'
import { saveCopiesToDevice } from '../save-to-device'

const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' })

afterEach(() => vi.unstubAllGlobals())

describe('saveCopiesToDevice', () => {
  it('sem arquivos não faz nada', async () => {
    expect(await saveCopiesToDevice([])).toBe('unsupported')
  })
  it('usa a folha de compartilhar quando o aparelho aceita arquivos', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(await saveCopiesToDevice([file])).toBe('shared')
    expect(share).toHaveBeenCalledWith({ files: [file] })
  })
  it('usuário fecha a folha = cancelled (sem baixar nada)', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'AbortError' }))
    vi.stubGlobal('navigator', { share, canShare: () => true })
    expect(await saveCopiesToDevice([file])).toBe('cancelled')
  })
  it('sem suporte a compartilhar arquivos cai pro download', async () => {
    const click = vi.fn()
    const link = { click, remove: vi.fn(), href: '', download: '' }
    vi.stubGlobal('navigator', {})
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() })
    expect(await saveCopiesToDevice([file, file])).toBe('downloaded')
    expect(click).toHaveBeenCalledTimes(2)
    expect(link.download).toBe('a.jpg')
  })
})
