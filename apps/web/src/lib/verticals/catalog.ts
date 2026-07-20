import type { InterviewAgentType } from '@/lib/interview/engine'

export type VerticalKey = 'cleaning_services' | 'therapy_clinic' | 'other'

export function isVerticalKey(value: unknown): value is VerticalKey {
  return value === 'cleaning_services' || value === 'therapy_clinic' || value === 'other'
}

export type DynamicField = {
  key: string
  label: string
  type: 'text' | 'number' | 'boolean' | 'select' | 'textarea'
  options?: string[]
  required?: boolean
}

export type TestScenario = {
  title: string
  openingMessage: string
}

export type VerticalTemplate = {
  key: VerticalKey
  labelPt: string
  labelEn: string
  terminology: Record<string, { pt: string; en: string }>
  interviewExtra?: Partial<Record<InterviewAgentType, { extraTopics: string[]; profileSchemaFragment: string }>>
  customerFieldSchema: DynamicField[]
  dashboardKpis: { key: string; labelPt: string; labelEn: string }[]
  /** Cenários prontos pra tela "Testar Funcionário" (sub-etapa 5/7) — abrem a simulação com uma mensagem inicial de cliente já pronta. Vazio em "other" (fallback pra mensagem livre). */
  testScenarios?: TestScenario[]
}

export const VERTICAL_TEMPLATES: Record<VerticalKey, VerticalTemplate> = {
  cleaning_services: {
    key: 'cleaning_services',
    labelPt: 'Serviços de Limpeza',
    labelEn: 'Cleaning Services',
    terminology: {
      customer: { pt: 'Cliente', en: 'Customer' },
      appointment: { pt: 'Serviço agendado', en: 'Scheduled service' },
      staff: { pt: 'Equipe', en: 'Team' },
      deal: { pt: 'Orçamento fechado', en: 'Booked job' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Tipos de limpeza oferecidos (residencial, comercial, profunda, recorrente)',
          'Como funciona o cálculo de preço (por metragem, quartos/banheiros, ou tabela fixa)',
          'Informações de acesso ao imóvel (código de portão, chave, contato do síndico)',
          'Política de estacionamento da equipe no local',
          'Frequência de recorrência disponível (semanal, quinzenal, mensal, avulsa)',
          'Política em relação a pets no imóvel durante o serviço',
        ],
        profileSchemaFragment:
          'cleaning_types (string[]), pricing_model (per_sqft | per_room | flat), recurring_frequencies (string[]), pet_policy (string)',
      },
      sdr: {
        extraTopics: [
          'Área de cobertura geográfica dos serviços de limpeza',
          'Ticket médio por tipo de limpeza (residencial vs. comercial)',
          'Diferencial competitivo da empresa (equipe própria vs. terceirizada, produtos ecológicos, seguro)',
        ],
        profileSchemaFragment: 'coverage_area (string), avg_ticket_by_type (record), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'bedrooms', label: 'Quartos', type: 'number' },
      { key: 'bathrooms', label: 'Banheiros', type: 'number' },
      { key: 'square_footage', label: 'Metragem (m²)', type: 'number' },
      { key: 'has_pets', label: 'Tem pets', type: 'boolean' },
      { key: 'access_instructions', label: 'Instruções de acesso', type: 'textarea' },
      { key: 'gate_code', label: 'Código do portão', type: 'text' },
      { key: 'parking_notes', label: 'Observações de estacionamento', type: 'textarea' },
      { key: 'assigned_team', label: 'Equipe responsável', type: 'text' },
      {
        key: 'cleaning_frequency',
        label: 'Frequência',
        type: 'select',
        options: ['avulsa', 'semanal', 'quinzenal', 'mensal'],
      },
    ],
    dashboardKpis: [
      { key: 'active_recurring_customers', labelPt: 'Clientes recorrentes ativos', labelEn: 'Active recurring customers' },
      { key: 'jobs_this_month', labelPt: 'Serviços no mês', labelEn: 'Jobs this month' },
      { key: 'avg_ticket', labelPt: 'Ticket médio', labelEn: 'Average ticket' },
    ],
    testScenarios: [
      {
        title: 'Novo orçamento',
        openingMessage: 'Oi, tudo bem? Queria um orçamento pra limpeza da minha casa, é apartamento de 2 quartos.',
      },
      {
        title: 'Reagendamento',
        openingMessage: 'Preciso remarcar a limpeza que estava agendada pra quinta-feira, pode ser pra semana que vem?',
      },
      {
        title: 'Animal na casa',
        openingMessage: 'Antes de fechar, só confirmando: eu tenho um cachorro grande em casa, isso é um problema pra equipe de vocês?',
      },
      {
        title: 'Endereço fora da área',
        openingMessage: 'Vocês atendem em Cotia? É um pouco fora do centro da cidade.',
      },
      {
        title: 'Pedido de desconto',
        openingMessage: 'O valor ficou um pouco acima do que eu esperava, vocês fazem algum desconto se eu fechar recorrente?',
      },
    ],
  },

  therapy_clinic: {
    key: 'therapy_clinic',
    labelPt: 'Clínica de Terapia',
    labelEn: 'Therapy Clinic',
    terminology: {
      customer: { pt: 'Paciente', en: 'Patient' },
      appointment: { pt: 'Sessão', en: 'Session' },
      staff: { pt: 'Terapeuta', en: 'Therapist' },
      deal: { pt: 'Avaliação inicial marcada', en: 'Intake evaluation booked' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Tipos de terapia oferecidos (individual, casal, familiar, infantil, etc.)',
          'Como funciona o agendamento de sessões recorrentes',
          'Processo de avaliação inicial e criação de plano de tratamento (só o fluxo administrativo, não o conteúdo clínico)',
          'Política de cancelamento e reagendamento de sessões',
          'Como funciona a lista de espera quando não há vaga com o terapeuta desejado',
          'Documentos administrativos solicitados no primeiro atendimento (não incluir prontuário clínico)',
          'Idioma preferido de atendimento do paciente/responsável',
        ],
        profileSchemaFragment:
          'therapy_types (string[]), locations (string[]), cancellation_policy (string), waitlist_enabled (boolean), intake_documents (string[])',
      },
      sdr: {
        extraTopics: [
          'Origem mais comum dos encaminhamentos (médico, plano de saúde, indicação, busca online)',
          'Convênios/planos de saúde aceitos',
          'Especialidades com maior demanda de novos pacientes',
        ],
        profileSchemaFragment: 'referral_sources (string[]), accepted_insurance (string[]), high_demand_specialties (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'guardian_name', label: 'Responsável', type: 'text' },
      { key: 'assigned_therapist', label: 'Terapeuta responsável', type: 'text' },
      {
        key: 'therapy_type',
        label: 'Tipo de terapia',
        type: 'select',
        options: ['individual', 'casal', 'familiar', 'infantil'],
      },
      { key: 'clinic_location', label: 'Unidade/consultório', type: 'text' },
      { key: 'preferred_room', label: 'Sala preferida', type: 'text' },
      { key: 'recurring_appointment_day', label: 'Dia recorrente da sessão', type: 'text' },
      { key: 'authorized_sessions', label: 'Sessões autorizadas (convênio)', type: 'number' },
      { key: 'attendance_notes', label: 'Observações de comparecimento', type: 'textarea' },
      { key: 'on_waitlist', label: 'Na lista de espera', type: 'boolean' },
      { key: 'referral_source', label: 'Origem do encaminhamento', type: 'text' },
      { key: 'preferred_language', label: 'Idioma preferido', type: 'text' },
    ],
    dashboardKpis: [
      { key: 'active_patients', labelPt: 'Pacientes ativos', labelEn: 'Active patients' },
      { key: 'sessions_this_month', labelPt: 'Sessões no mês', labelEn: 'Sessions this month' },
      { key: 'waitlist_size', labelPt: 'Tamanho da lista de espera', labelEn: 'Waitlist size' },
    ],
    testScenarios: [
      {
        title: 'Novo paciente',
        openingMessage: 'Oi, gostaria de marcar uma avaliação inicial. É a primeira vez que eu procuro terapia.',
      },
      {
        title: 'Responsável por menor',
        openingMessage: 'Quero marcar uma sessão pro meu filho de 8 anos, sou o responsável por ele. Como funciona?',
      },
      {
        title: 'Cancelamento',
        openingMessage: 'Preciso cancelar minha sessão de amanhã, vai dar algum problema?',
      },
      {
        title: 'Lista de espera',
        openingMessage: 'Vocês têm vaga com a terapeuta Fulana? Se não tiver, eu entro na lista de espera?',
      },
      {
        title: 'Dúvida de preço',
        openingMessage: 'Quanto custa a sessão e vocês aceitam algum convênio?',
      },
      {
        title: 'Pergunta médica que exige humano',
        openingMessage: 'Eu tomo um remédio controlado, isso pode ser um problema pra fazer terapia? O que vocês recomendam?',
      },
    ],
  },

  other: {
    key: 'other',
    labelPt: 'Outro',
    labelEn: 'Other',
    terminology: {
      customer: { pt: 'Cliente', en: 'Customer' },
      appointment: { pt: 'Compromisso', en: 'Appointment' },
      staff: { pt: 'Equipe', en: 'Staff' },
      deal: { pt: 'Negócio fechado', en: 'Closed deal' },
    },
    customerFieldSchema: [],
    dashboardKpis: [],
  },
}
