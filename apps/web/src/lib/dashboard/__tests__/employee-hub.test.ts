import { describe, expect, it } from 'vitest'
import { pickPrimaryAgentConfig } from '../employee-hub'

// pickPrimaryAgentConfig (2026-09-18, redesign do menu por funcionário):
// escolhe qual agent_configs mostrar nas abas (Treinar/Testar/Configurar/
// Materiais) do painel do funcionário, quando a org tem mais de uma
// unidade com esse funcionário contratado.

describe('pickPrimaryAgentConfig', () => {
  it('sem nenhuma config, devolve null', () => {
    expect(pickPrimaryAgentConfig([])).toBeNull()
  })

  it('só uma config (pausada), devolve ela mesmo sem estar ativa', () => {
    const config = { id: 'c1', unit_id: 'u1', is_active: false }
    expect(pickPrimaryAgentConfig([config])).toBe(config)
  })

  it('mais de uma unidade contratou — prioriza a que está ativa, mesmo que não seja a primeira da lista', () => {
    const paused = { id: 'c1', unit_id: 'u1', is_active: false }
    const active = { id: 'c2', unit_id: 'u2', is_active: true }
    expect(pickPrimaryAgentConfig([paused, active])).toBe(active)
  })

  it('nenhuma ativa — cai pra primeira da lista (pausada)', () => {
    const first = { id: 'c1', unit_id: 'u1', is_active: false }
    const second = { id: 'c2', unit_id: 'u2', is_active: false }
    expect(pickPrimaryAgentConfig([first, second])).toBe(first)
  })

  it('mais de uma ativa (não deveria acontecer na prática, mas não quebra) — pega a primeira ativa', () => {
    const activeA = { id: 'c1', unit_id: 'u1', is_active: true }
    const activeB = { id: 'c2', unit_id: 'u2', is_active: true }
    expect(pickPrimaryAgentConfig([activeA, activeB])).toBe(activeA)
  })
})
