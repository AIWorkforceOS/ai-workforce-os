import { describe, expect, it } from 'vitest'
import { createStageTimer, readSaveTimings, recordSaveTiming, type SaveTiming } from '../save-timing'

const memory = () => {
  const data = new Map<string, string>()
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const entry = (n: number): SaveTiming => ({ at: `t${n}`, files: n, megabytes: 1, stages: { total: n }, outcome: 'synced' })

describe('medições do salvamento', () => {
  it('guarda só as últimas 20 e sobrevive a armazenamento corrompido', () => {
    const s = memory()
    for (let i = 0; i < 25; i++) recordSaveTiming(entry(i), s)
    const all = readSaveTimings(s)
    expect(all).toHaveLength(20)
    expect(all[0]!.files).toBe(5)
    s.setItem('alizo_save_timings', '{lixo')
    expect(readSaveTimings(s)).toEqual([])
  })
  it('a medição não carrega nenhum dado da ordem (só contagens, MB, ms e resultado)', () => {
    expect(Object.keys(entry(1)).sort()).toEqual(['at', 'files', 'megabytes', 'outcome', 'stages'])
  })
  it('cronômetro soma etapas e mede o total', async () => {
    let t = 1000
    const timer = createStageTimer(() => t)
    await timer.measure('gps', async () => { t += 300 })
    timer.add('upload', 450)
    timer.add('upload', 50)
    t += 100
    expect(timer.finish()).toEqual({ gps: 300, upload: 500, total: 400 })
  })
})
