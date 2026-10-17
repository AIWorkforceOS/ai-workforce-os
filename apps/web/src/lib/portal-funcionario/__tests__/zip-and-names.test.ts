import { describe, expect, it } from 'vitest'
import { buildZip, crc32, uniqueNames } from '../zip'
import { mediaDownloadNames } from '../media-files'

describe('zip', () => {
  it('crc32 bate com o valor conhecido', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
  it('estrutura válida: assinaturas, contagem, tamanhos e dados intactos', () => {
    const a = new TextEncoder().encode('hello')
    const b = Uint8Array.from([1, 2, 3, 4, 5, 6])
    const zip = buildZip([{ name: 'a.txt', data: a }, { name: 'b.bin', data: b }])
    const view = new DataView(zip.buffer)
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    const end = zip.length - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const centralOffset = view.getUint32(end + 16, true)
    expect(view.getUint32(centralOffset, true)).toBe(0x02014b50)
    // dados do 1º arquivo logo após o cabeçalho local + nome
    expect(Array.from(zip.slice(30 + 5, 30 + 5 + 5))).toEqual(Array.from(a))
  })
  it('nomes repetidos ganham sufixo', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'b.jpg', 'a.jpg'])).toEqual(['a.jpg', 'a (2).jpg', 'b.jpg', 'a (3).jpg'])
  })
})

describe('mediaDownloadNames', () => {
  it('numera por tipo e mantém a extensão', () => {
    const names = mediaDownloadNames(
      [
        { url: 'https://x/a/antes-1.jpg', kind: 'before', uploaded_at: '' },
        { url: 'https://x/a/antes-2.png', kind: 'before', uploaded_at: '' },
        { url: 'https://x/a/v.mp4', kind: 'video', uploaded_at: '' },
        { url: 'https://x/a/semext', kind: 'after', uploaded_at: '' },
      ],
      '161120-01',
    )
    expect(names).toEqual(['161120-01-antes-1.jpg', '161120-01-antes-2.png', '161120-01-video-1.mp4', '161120-01-depois-1.jpg'])
  })
})
