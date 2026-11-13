import { describe, expect, it } from 'vitest'
import { evaluateEmployeeCertification } from '../certification'

describe('evaluateEmployeeCertification', () => {
  it('bloqueia Recepcionista sem catálogo operacional completo', () => {
    const result = evaluateEmployeeCertification({
      config: { agent_type: 'receptionist', interview_status: 'completed', business_profile: {} },
      services: [],
      scenarioReviewCompleted: true,
    })
    expect(result.status).toBe('missing_information')
    expect(result.issues.join(' ')).toContain('serviço ativo')
  })

  it('exige revisão de cenários mesmo com dados completos', () => {
    const result = evaluateEmployeeCertification({
      config: {
        agent_type: 'sdr',
        interview_status: 'completed',
        business_profile: {
          sobre_a_empresa: 'Empresa', produtos: [{ nome: 'Plano', preco: '100', detalhes: 'Mensal' }],
          politica_desconto: 'Não oferece', tipo_cliente: 'b2b', prospeccao: { tipos_empresa: ['clínica'], regioes: ['SP'] },
          fechamento: 'qualifica_e_passa_para_humano', fechamento_campos: [], fechamento_acao: 'Avisar comercial',
          fechamento_cria_vaga_recrutamento: false, observacoes: ['Nenhuma'],
        },
      },
      scenarioReviewCompleted: false,
    })
    expect(result).toEqual({ status: 'requires_review', issues: ['Executar e aprovar os cenários de teste antes da ativação.'] })
  })
})
