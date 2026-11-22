import { describe, expect, it } from 'vitest'
import { videoMonthlyLimitFrom } from '../media-policy'

describe('videoMonthlyLimitFrom', () => {
  it('aceita somente os planos administráveis', () => {
    expect(videoMonthlyLimitFrom({ video_monthly_limit: 4 })).toBe(4)
    expect(videoMonthlyLimitFrom({ video_monthly_limit: 8 })).toBe(8)
  })

  it('usa 2 como limite seguro para configuração ausente ou inválida', () => {
    expect(videoMonthlyLimitFrom({})).toBe(2)
    expect(videoMonthlyLimitFrom({ video_monthly_limit: 99 })).toBe(2)
  })
})
