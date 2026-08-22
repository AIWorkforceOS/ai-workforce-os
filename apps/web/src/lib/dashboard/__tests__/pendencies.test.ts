import { describe, expect, it } from 'vitest'
import { buildTodayPendencies, groupLatestInterventions, relativeTimeFromNow } from '../pendencies'

describe('groupLatestInterventions', () => {
  it('inclui só contatos cujo evento mais recente foi a trava (aguardando humano agora)', () => {
    const result = groupLatestInterventions([
      { contactId: 'lead-1', eventType: 'human_operator_message', createdAt: '2026-08-21T10:00:00.000Z' },
      { contactId: 'lead-2', eventType: 'human_intervention_released', createdAt: '2026-08-21T09:50:00.000Z' },
    ])
    expect(result).toEqual([{ contactId: 'lead-1', since: '2026-08-21T10:00:00.000Z' }])
  })

  it('quando o mesmo contato tem trava seguida de devolução, NÃO aparece (já foi resolvido)', () => {
    // input já vem ordenado do mais recente pro mais antigo — devolução é o evento mais novo
    const result = groupLatestInterventions([
      { contactId: 'lead-1', eventType: 'human_intervention_released', createdAt: '2026-08-21T10:05:00.000Z' },
      { contactId: 'lead-1', eventType: 'human_operator_message', createdAt: '2026-08-21T10:00:00.000Z' },
    ])
    expect(result).toEqual([])
  })

  it('sem eventos, devolve lista vazia', () => {
    expect(groupLatestInterventions([])).toEqual([])
  })
})

describe('buildTodayPendencies', () => {
  const empty = { waitingHuman: [], shortlistedCandidates: [], pendingContent: [], integrationErrors: [] }

  it('lista vazia quando não há nenhuma pendência', () => {
    expect(buildTodayPendencies(empty)).toEqual([])
  })

  it('falha de integração vem como urgente, na frente de pendências de decisão', () => {
    const result = buildTodayPendencies({
      ...empty,
      waitingHuman: [{ contactId: 'lead-1', contactName: 'Maria', since: '2026-08-21T08:00:00.000Z' }],
      integrationErrors: [{ source: 'whatsapp', count: 3, since: '2026-08-21T09:00:00.000Z' }],
    })
    expect(result.map((p) => p.priority)).toEqual(['urgente', 'decisao'])
    expect(result[0]!.title).toContain('whatsapp')
  })

  it('dentro da mesma prioridade, a mais antiga (esperando há mais tempo) vem primeiro', () => {
    const result = buildTodayPendencies({
      ...empty,
      waitingHuman: [
        { contactId: 'lead-recent', contactName: 'Recente', since: '2026-08-21T10:00:00.000Z' },
        { contactId: 'lead-old', contactName: 'Antigo', since: '2026-08-21T08:00:00.000Z' },
      ],
    })
    expect(result.map((p) => p.id)).toEqual(['waiting-human-lead-old', 'waiting-human-lead-recent'])
  })

  it('cada pendência carrega href e ctaLabel — nunca só um número decorativo', () => {
    const result = buildTodayPendencies({
      ...empty,
      shortlistedCandidates: [{ id: 'cand-1', candidateName: 'João', jobTitle: 'Vendedor', since: '2026-08-21T08:00:00.000Z' }],
    })
    expect(result[0]!.href).toBe('/dashboard/recruiter')
    expect(result[0]!.ctaLabel.length).toBeGreaterThan(0)
    expect(result[0]!.title).toContain('João')
    expect(result[0]!.title).toContain('Vendedor')
  })

  it('trunca legenda de post muito longa na descrição, sem quebrar em legendas curtas', () => {
    const longCaption = 'x'.repeat(120)
    const result = buildTodayPendencies({ ...empty, pendingContent: [{ id: 'post-1', caption: longCaption, since: '2026-08-21T08:00:00.000Z' }] })
    expect(result[0]!.description.length).toBeLessThan(longCaption.length)
    expect(result[0]!.description.endsWith('…')).toBe(true)

    const shortResult = buildTodayPendencies({ ...empty, pendingContent: [{ id: 'post-2', caption: 'Post curto', since: '2026-08-21T08:00:00.000Z' }] })
    expect(shortResult[0]!.description).toBe('Post curto')
  })
})

describe('relativeTimeFromNow', () => {
  const now = new Date('2026-08-21T12:00:00.000Z')

  it('menos de 1 minuto: "agora mesmo"', () => {
    expect(relativeTimeFromNow('2026-08-21T11:59:40.000Z', now)).toBe('agora mesmo')
  })

  it('minutos: "há Xmin"', () => {
    expect(relativeTimeFromNow('2026-08-21T11:55:00.000Z', now)).toBe('há 5min')
  })

  it('horas: "há Xh"', () => {
    expect(relativeTimeFromNow('2026-08-21T09:00:00.000Z', now)).toBe('há 3h')
  })

  it('dias: "há X dia(s)", com plural correto', () => {
    expect(relativeTimeFromNow('2026-08-20T12:00:00.000Z', now)).toBe('há 1 dia')
    expect(relativeTimeFromNow('2026-08-18T12:00:00.000Z', now)).toBe('há 3 dias')
  })
})
