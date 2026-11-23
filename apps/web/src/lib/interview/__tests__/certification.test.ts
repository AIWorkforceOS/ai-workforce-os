import { describe, expect, it } from 'vitest'
import { evaluateEmployeeCertification } from '../certification'

describe('evaluateEmployeeCertification', () => {
  it('bloqueia Recepcionista sem catálogo operacional completo', () => {
    const result = evaluateEmployeeCertification({
      config: {
        agent_type: 'receptionist',
        interview_status: 'completed',
        business_profile: {
          tipo_negocio: 'Clínica', como_atende_hoje: 'WhatsApp', tarefas_automaticas: ['Agendar e reagendar consultas'],
          quando_avisar_humano: 'Urgência', quem_avisar: 'Gestor', horario_funcionamento: '8h às 18h',
          informacoes_proibidas_inventar: ['Preço', 'disponibilidade'],
        },
      },
      services: [],
      scenarioReviewCompleted: true,
    })
    expect(result.status).toBe('missing_information')
    expect(result.issues.join(' ')).toContain('serviço ativo')
  })

  it('não exige agenda de Recepcionista treinada somente para suporte e triagem', () => {
    const result = evaluateEmployeeCertification({
      config: {
        agent_type: 'receptionist',
        interview_status: 'completed',
        business_profile: {
          tipo_negocio: 'Rede de estágios', como_atende_hoje: 'WhatsApp',
          tarefas_automaticas: ['Atendimento e orientação geral', 'Suporte básico ao sistema'],
          quando_avisar_humano: 'Casos sensíveis', quem_avisar: 'Equipe responsável',
          horario_funcionamento: '8h às 18h', informacoes_proibidas_inventar: ['Status de contrato', 'prazos'],
        },
      },
      services: [],
      scenarioReviewCompleted: true,
    })
    expect(result).toEqual({ status: 'ready', issues: [] })
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
