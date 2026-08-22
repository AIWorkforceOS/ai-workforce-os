import { describe, expect, it } from 'vitest'
import { AUTONOMY_SUMMARY } from '../autonomy-summary'
import { INTERVIEW_PLAYBOOKS } from '../engine'

describe('AUTONOMY_SUMMARY — Fase 9, parte 1 (só leitura)', () => {
  it('cobre exatamente os mesmos 6 cargos que têm entrevista (INTERVIEW_PLAYBOOKS) — nenhum cargo fica sem descrição de autonomia', () => {
    expect(Object.keys(AUTONOMY_SUMMARY).sort()).toEqual(Object.keys(INTERVIEW_PLAYBOOKS).sort())
  })

  it('todo texto é nao-vazio e escrito para leigo (sem JSON, sem nome de campo técnico)', () => {
    for (const text of Object.values(AUTONOMY_SUMMARY)) {
      expect(text.length).toBeGreaterThan(20)
      expect(text).not.toContain('{')
      expect(text).not.toContain('_')
    }
  })
})
