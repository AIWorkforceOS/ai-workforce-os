import { afterEach, describe, expect, it } from 'vitest'
import { isReportToken, reportDownloadUrl } from '../report-link'

const T = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b'
const saved = process.env.NEXT_PUBLIC_APP_URL
afterEach(() => {
  if (saved === undefined) delete process.env.NEXT_PUBLIC_APP_URL
  else process.env.NEXT_PUBLIC_APP_URL = saved
})

describe('reportDownloadUrl', () => {
  it('usa o domínio real do produto mesmo se a requisição veio de um endereço interno', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(reportDownloadUrl('https://ai-workforce-xyz-smarter1.vercel.app', T)).toBe(`https://www.alizoai.com/relatorio/${T}`)
    expect(reportDownloadUrl('http://localhost:3000', T)).toBe(`https://www.alizoai.com/relatorio/${T}`)
  })
  it('usa a origem quando já é o domínio real; NEXT_PUBLIC_APP_URL manda se existir', () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    expect(reportDownloadUrl('https://www.alizoai.com', T)).toBe(`https://www.alizoai.com/relatorio/${T}`)
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.exemplo.com/'
    expect(reportDownloadUrl('https://www.alizoai.com', T)).toBe(`https://app.exemplo.com/relatorio/${T}`)
  })
})

describe('isReportToken', () => {
  it('só aceita UUID', () => {
    expect(isReportToken(T)).toBe(true)
    expect(isReportToken('abc')).toBe(false)
    expect(isReportToken("' or 1=1 --")).toBe(false)
  })
})
