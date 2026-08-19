import type { InterviewAgentType } from '@/lib/interview/engine'

export type VerticalKey =
  | 'cleaning_services'
  | 'therapy_clinic'
  | 'general_maintenance'
  | 'dental_clinic'
  | 'medical_clinic'
  | 'vocational_education'
  | 'hr_company'
  | 'internship_agency'
  | 'restaurant_food_service'
  | 'other'

const VERTICAL_KEYS: VerticalKey[] = [
  'cleaning_services',
  'therapy_clinic',
  'general_maintenance',
  'dental_clinic',
  'medical_clinic',
  'vocational_education',
  'hr_company',
  'internship_agency',
  'restaurant_food_service',
  'other',
]

export function isVerticalKey(value: unknown): value is VerticalKey {
  return typeof value === 'string' && (VERTICAL_KEYS as string[]).includes(value)
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

  general_maintenance: {
    key: 'general_maintenance',
    labelPt: 'Manutenção Geral',
    labelEn: 'General Maintenance',
    terminology: {
      customer: { pt: 'Cliente', en: 'Customer' },
      appointment: { pt: 'Chamado de serviço', en: 'Service call' },
      staff: { pt: 'Técnico', en: 'Technician' },
      deal: { pt: 'Serviço fechado', en: 'Job booked' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Tipos de serviço oferecidos (elétrica, hidráulica, HVAC, reparos gerais, outros)',
          'Área geográfica atendida',
          'Como funciona a taxa de visita/orçamento (cobrada sempre, isenta se fechar o serviço, etc.)',
          'Garantia oferecida sobre o serviço realizado (prazo e o que cobre)',
          'Disponibilidade de atendimento de emergência 24h e o que caracteriza uma emergência',
          'Informações de acesso ao imóvel (código de portão, chave, contato do síndico, presença de pets)',
          'Janela de agendamento/chegada do técnico combinada com o cliente',
        ],
        profileSchemaFragment:
          'service_types (string[]), service_area (string), dispatch_fee_model (string), warranty_policy (string), emergency_service_available (boolean)',
      },
      sdr: {
        extraTopics: [
          'Área de cobertura geográfica dos serviços',
          'Ticket médio por tipo de serviço (elétrica, hidráulica, HVAC, reparo geral)',
          'Diferencial competitivo da empresa (técnicos certificados, garantia, tempo de resposta, atendimento 24h)',
        ],
        profileSchemaFragment:
          'coverage_area (string), avg_ticket_by_service_type (record), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      {
        key: 'property_type',
        label: 'Tipo de imóvel',
        type: 'select',
        options: ['residencial', 'comercial'],
      },
      {
        key: 'service_type',
        label: 'Tipo de serviço',
        type: 'select',
        options: ['elétrica', 'hidráulica', 'hvac', 'reparos gerais', 'outro'],
      },
      {
        key: 'urgency',
        label: 'Urgência',
        type: 'select',
        options: ['rotina', 'urgente', 'emergência'],
      },
      { key: 'equipment_notes', label: 'Histórico de equipamento/sistema', type: 'textarea' },
      { key: 'access_instructions', label: 'Instruções de acesso', type: 'textarea' },
      { key: 'gate_code', label: 'Código do portão', type: 'text' },
      { key: 'preferred_technician', label: 'Técnico preferido', type: 'text' },
      { key: 'has_active_warranty', label: 'Garantia ativa', type: 'boolean' },
      { key: 'warranty_details', label: 'Detalhes da garantia', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_service_contracts', labelPt: 'Contratos de manutenção ativos', labelEn: 'Active service contracts' },
      { key: 'jobs_completed_this_month', labelPt: 'Chamados concluídos no mês', labelEn: 'Jobs completed this month' },
      { key: 'avg_response_time', labelPt: 'Tempo médio de resposta', labelEn: 'Average response time' },
    ],
    testScenarios: [
      {
        title: 'Reparo emergencial',
        openingMessage: 'Socorro, tá vazando água embaixo da pia da cozinha e não para, vocês têm alguém pra vir agora?',
      },
      {
        title: 'Manutenção de rotina agendada',
        openingMessage: 'Oi, queria agendar a manutenção anual do ar-condicionado, pode ser semana que vem?',
      },
      {
        title: 'Pedido de orçamento',
        openingMessage: 'Queria um orçamento pra trocar um disjuntor que caiu direto lá em casa, quanto fica mais ou menos?',
      },
      {
        title: 'Reclamação de garantia',
        openingMessage: 'O reparo hidráulico que vocês fizeram mês passado voltou a vazar no mesmo lugar, isso não devia estar na garantia?',
      },
      {
        title: 'Conflito de agenda do técnico',
        openingMessage: 'O técnico que ia vir hoje às 14h ainda não chegou e eu preciso sair em 1 hora, o que eu faço?',
      },
    ],
  },

  dental_clinic: {
    key: 'dental_clinic',
    labelPt: 'Clínica Odontológica',
    labelEn: 'Dental Clinic',
    terminology: {
      customer: { pt: 'Paciente', en: 'Patient' },
      appointment: { pt: 'Consulta odontológica', en: 'Dental appointment' },
      staff: { pt: 'Dentista', en: 'Dentist' },
      deal: { pt: 'Consulta agendada', en: 'Appointment booked' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Especialidades odontológicas oferecidas (clínico geral, ortodontia, implante, endodontia, etc.)',
          'Procedimentos e preços que a IA PODE informar diretamente, e quais exigem avaliação presencial antes de qualquer valor',
          'Unidades/consultórios e dentistas de cada uma',
          'Horários de atendimento por dentista/especialidade',
          'Política de cancelamento e falta (no-show)',
          'Como tratar uma emergência odontológica (dor aguda, trauma) — encaixe no mesmo dia ou encaminhamento',
          'Convênios/planos odontológicos aceitos',
          'Idiomas de atendimento',
          'Quando SEMPRE transferir para um humano (nunca dar orientação clínica, diagnóstico ou prescrição)',
        ],
        profileSchemaFragment:
          'specialties (string[]), procedures_with_disclosable_price (record), locations (string[]), dentists_by_location (record), cancellation_policy (string), emergency_policy (string), accepted_insurance (string[]), languages (string[])',
      },
      sdr: {
        extraTopics: [
          'Área de cobertura/unidades da clínica',
          'Ticket médio por tipo de procedimento',
          'Diferencial competitivo (tecnologia, conforto, tempo de espera, convênios aceitos)',
        ],
        profileSchemaFragment: 'coverage_area (string), avg_ticket_by_procedure (record), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'guardian_name', label: 'Responsável (se menor de idade)', type: 'text' },
      { key: 'clinic_location', label: 'Unidade', type: 'text' },
      { key: 'assigned_dentist', label: 'Dentista responsável', type: 'text' },
      { key: 'specialty', label: 'Especialidade', type: 'text' },
      { key: 'procedure', label: 'Procedimento', type: 'text' },
      { key: 'visit_type', label: 'Tipo de consulta', type: 'select', options: ['primeira consulta', 'retorno', 'emergência'] },
      { key: 'preferred_schedule', label: 'Horário preferido', type: 'text' },
      { key: 'dental_insurance', label: 'Convênio odontológico', type: 'text' },
      { key: 'referral_source', label: 'Origem do paciente', type: 'text' },
      { key: 'admin_documents_notes', label: 'Documentos administrativos', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_patients', labelPt: 'Pacientes ativos', labelEn: 'Active patients' },
      { key: 'appointments_this_month', labelPt: 'Consultas no mês', labelEn: 'Appointments this month' },
      { key: 'emergency_visits_this_month', labelPt: 'Emergências no mês', labelEn: 'Emergency visits this month' },
    ],
    testScenarios: [
      { title: 'Nova consulta', openingMessage: 'Oi, queria marcar uma avaliação, nunca fui paciente de vocês.' },
      { title: 'Emergência', openingMessage: 'Tô com uma dor de dente insuportável desde ontem, vocês conseguem me encaixar hoje?' },
      { title: 'Dúvida de preço de procedimento', openingMessage: 'Quanto custa clareamento dental aí?' },
      { title: 'Pergunta clínica que exige humano', openingMessage: 'Meu implante está doendo, isso é normal ou é grave?' },
      { title: 'Convênio', openingMessage: 'Vocês atendem pelo meu plano odontológico da Amil?' },
      { title: 'Cancelamento', openingMessage: 'Preciso cancelar minha consulta de amanhã às 15h.' },
    ],
  },

  medical_clinic: {
    key: 'medical_clinic',
    labelPt: 'Clínica Médica',
    labelEn: 'Medical Clinic',
    terminology: {
      customer: { pt: 'Paciente', en: 'Patient' },
      appointment: { pt: 'Consulta', en: 'Appointment' },
      staff: { pt: 'Médico', en: 'Provider' },
      deal: { pt: 'Consulta agendada', en: 'Appointment booked' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Especialidades médicas atendidas',
          'Unidades e médicos/profissionais de cada especialidade',
          'Atendimento presencial e/ou remoto (telemedicina)',
          'Primeira consulta vs. retorno — regras diferentes de agendamento',
          'Convênios/seguros de saúde aceitos e se exige carta de referência (referral)',
          'Documentos administrativos pedidos no primeiro atendimento (nunca prontuário clínico)',
          'Política de lista de espera quando não há vaga com o profissional desejado',
          'Como tratar uma situação de urgência/emergência médica relatada no chat — SEMPRE orientar a procurar pronto-socorro ou emergência, nunca dar orientação clínica',
          'Idiomas de atendimento',
        ],
        profileSchemaFragment:
          'specialties (string[]), locations (string[]), providers_by_specialty (record), telehealth_available (boolean), accepted_insurance (string[]), referral_required (boolean), waitlist_enabled (boolean), languages (string[])',
      },
      sdr: {
        extraTopics: [
          'Área de cobertura/unidades da clínica',
          'Especialidades com maior demanda',
          'Diferencial competitivo (tempo de espera, tecnologia, convênios, telemedicina)',
        ],
        profileSchemaFragment: 'coverage_area (string), high_demand_specialties (string[]), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'guardian_name', label: 'Responsável (se menor de idade)', type: 'text' },
      { key: 'clinic_location', label: 'Unidade', type: 'text' },
      { key: 'specialty', label: 'Especialidade', type: 'text' },
      { key: 'assigned_provider', label: 'Médico/profissional responsável', type: 'text' },
      { key: 'visit_type', label: 'Tipo de atendimento', type: 'select', options: ['presencial', 'telemedicina'] },
      { key: 'appointment_kind', label: 'Primeira consulta ou retorno', type: 'select', options: ['primeira consulta', 'retorno'] },
      { key: 'health_insurance', label: 'Convênio/seguro', type: 'text' },
      { key: 'referral_notes', label: 'Carta de referência', type: 'textarea' },
      { key: 'on_waitlist', label: 'Na lista de espera', type: 'boolean' },
      { key: 'preferred_language', label: 'Idioma preferido', type: 'text' },
    ],
    dashboardKpis: [
      { key: 'active_patients', labelPt: 'Pacientes ativos', labelEn: 'Active patients' },
      { key: 'appointments_this_month', labelPt: 'Consultas no mês', labelEn: 'Appointments this month' },
      { key: 'waitlist_size', labelPt: 'Tamanho da lista de espera', labelEn: 'Waitlist size' },
    ],
    testScenarios: [
      { title: 'Nova consulta', openingMessage: 'Boa tarde, preciso marcar uma consulta com clínico geral, sou paciente novo.' },
      { title: 'Retorno', openingMessage: 'Preciso marcar meu retorno com a Dra. Ana, já sou paciente dela.' },
      { title: 'Telemedicina', openingMessage: 'Dá pra fazer a consulta por vídeo mesmo, sem precisar ir até aí?' },
      { title: 'Convênio e referral', openingMessage: 'Atendem pelo meu plano de saúde? Preciso de encaminhamento do meu médico de família?' },
      { title: 'Situação de urgência que exige humano', openingMessage: 'Estou com dor forte no peito agora, o que eu faço?' },
      { title: 'Lista de espera', openingMessage: 'Não tem vaga com o cardiologista essa semana? Posso entrar na lista de espera?' },
    ],
  },

  vocational_education: {
    key: 'vocational_education',
    labelPt: 'Escola de Cursos Profissionalizantes',
    labelEn: 'Vocational Education',
    terminology: {
      customer: { pt: 'Aluno', en: 'Student' },
      appointment: { pt: 'Matrícula/Aula', en: 'Class/Enrollment appointment' },
      staff: { pt: 'Instrutor', en: 'Instructor' },
      deal: { pt: 'Matrícula fechada', en: 'Enrollment closed' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Cursos oferecidos, com duração, modalidade (presencial/EAD/híbrido) e pré-requisitos de cada um',
          'Unidades onde cada curso é oferecido e turnos disponíveis',
          'Valor da mensalidade e da matrícula de cada curso, e formas de pagamento aceitas',
          'Promoções/descontos que a IA pode oferecer sem aprovação humana',
          'Documentos exigidos pra matrícula',
          'Certificação oferecida ao concluir',
          'Política de cancelamento/trancamento de matrícula',
          'Se a escola oferece encaminhamento pra estágio ao final do curso',
          'Quando transferir pra um consultor humano (ex.: negociação fora do padrão, reclamação)',
        ],
        profileSchemaFragment:
          'courses (record: duration, modality, prerequisites, price, locations, shifts), certification (string), internship_placement (boolean), cancellation_policy (string)',
      },
      sdr: {
        extraTopics: [
          'Cursos com maior procura/prioridade de venda',
          'Ticket médio por curso e sazonalidade de matrículas (início de semestre, etc.)',
          'Diferencial competitivo (certificação reconhecida, corpo docente, parcerias com empresas)',
        ],
        profileSchemaFragment: 'priority_courses (string[]), avg_ticket_by_course (record), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'guardian_name', label: 'Responsável (se menor de idade)', type: 'text' },
      { key: 'course', label: 'Curso', type: 'text' },
      { key: 'modality', label: 'Modalidade', type: 'select', options: ['presencial', 'ead', 'híbrido'] },
      { key: 'shift', label: 'Turno', type: 'select', options: ['manhã', 'tarde', 'noite'] },
      { key: 'location', label: 'Unidade', type: 'text' },
      { key: 'class_group', label: 'Turma', type: 'text' },
      { key: 'start_date', label: 'Início', type: 'text' },
      { key: 'tuition_amount', label: 'Mensalidade', type: 'number' },
      { key: 'enrollment_status', label: 'Status da matrícula', type: 'select', options: ['interessado', 'matriculado', 'trancado', 'concluído'] },
      { key: 'lead_source', label: 'Origem do interesse', type: 'text' },
      { key: 'internship_placement_notes', label: 'Encaminhamento de estágio', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_students', labelPt: 'Alunos ativos', labelEn: 'Active students' },
      { key: 'enrollments_this_month', labelPt: 'Matrículas no mês', labelEn: 'Enrollments this month' },
      { key: 'avg_ticket', labelPt: 'Ticket médio', labelEn: 'Average ticket' },
    ],
    testScenarios: [
      { title: 'Interesse em curso', openingMessage: 'Oi, vi o anúncio de vocês, queria saber mais sobre o curso de auxiliar administrativo.' },
      { title: 'Dúvida de horário', openingMessage: 'Esse curso tem turma à noite? Eu trabalho de dia.' },
      { title: 'Negociação de preço', openingMessage: 'A mensalidade tá um pouco cara pra mim, tem algum desconto pra pagamento à vista?' },
      { title: 'Documentação', openingMessage: 'Quais documentos eu preciso levar pra fazer a matrícula?' },
      { title: 'Trancamento', openingMessage: 'Preciso trancar minha matrícula esse semestre, como funciona?' },
      { title: 'Certificação', openingMessage: 'O certificado desse curso é reconhecido pelo MEC?' },
    ],
  },

  hr_company: {
    key: 'hr_company',
    labelPt: 'Empresa de Recursos Humanos',
    labelEn: 'HR Company',
    terminology: {
      customer: { pt: 'Empresa cliente', en: 'Client company' },
      appointment: { pt: 'Reunião de alinhamento', en: 'Client meeting' },
      staff: { pt: 'Recrutador', en: 'Recruiter' },
      deal: { pt: 'Vaga fechada', en: 'Position filled' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Tipos de serviço de RH oferecidos (recrutamento e seleção, terceirização, consultoria, folha de pagamento, etc.)',
          'Como funciona o processo comercial com uma empresa cliente nova (proposta, SLA, contrato)',
          'Informações que a IA pode passar sobre prazo/SLA de entrega de candidatos',
          'Quando transferir pra um consultor humano (negociação de contrato, reclamação de cliente)',
        ],
        profileSchemaFragment: 'services (string[]), sla_days (number), contract_process (string)',
      },
      sdr: {
        extraTopics: [
          'Segmentos de empresa que são o público-alvo (porte, setor)',
          'Ticket médio por tipo de serviço/contrato',
          'Diferencial competitivo (tempo médio de preenchimento de vaga, garantia de substituição, especialização setorial)',
        ],
        profileSchemaFragment: 'target_company_segments (string[]), avg_ticket_by_service (record), differentiators (string[])',
      },
      recruiter: {
        extraTopics: [
          'Tipos de vaga mais comuns que a empresa recruta (cargo, senioridade, regime CLT/PJ)',
          'Critérios padrão de triagem de candidato por tipo de vaga',
          'Como funciona o processo seletivo (etapas, quem entrevista, prazo médio)',
          'Informações que NUNCA devem ser pedidas/discutidas no chat com candidato (dados sensíveis fora do escopo, ex.: saúde, religião, estado civil sem motivo legal)',
          'Quando escalar pra um recrutador humano',
        ],
        profileSchemaFragment:
          'common_job_types (string[]), screening_criteria (record), selection_process_steps (string[]), avg_process_days (number)',
      },
    },
    customerFieldSchema: [
      { key: 'hr_contact_name', label: 'Contato de RH', type: 'text' },
      { key: 'company_segment', label: 'Segmento da empresa', type: 'text' },
      { key: 'service_type', label: 'Tipo de serviço contratado', type: 'select', options: ['recrutamento e seleção', 'terceirização', 'consultoria', 'folha de pagamento'] },
      { key: 'open_positions_count', label: 'Vagas abertas', type: 'number' },
      { key: 'contract_sla_days', label: 'SLA contratado (dias)', type: 'number' },
      { key: 'account_status', label: 'Status da conta', type: 'select', options: ['prospecção', 'proposta enviada', 'ativo', 'inativo'] },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_client_companies', labelPt: 'Empresas clientes ativas', labelEn: 'Active client companies' },
      { key: 'open_positions_total', labelPt: 'Vagas abertas no total', labelEn: 'Total open positions' },
      { key: 'positions_filled_this_month', labelPt: 'Vagas fechadas no mês', labelEn: 'Positions filled this month' },
    ],
    testScenarios: [
      { title: 'Nova empresa interessada', openingMessage: 'Oi, temos 3 vagas abertas e queríamos terceirizar o recrutamento, vocês atendem esse tipo de demanda?' },
      { title: 'Cobrança de prazo', openingMessage: 'Já faz 2 semanas que abrimos a vaga de analista financeiro, tem candidato pra gente ver?' },
      { title: 'Dúvida de escopo', openingMessage: 'Vocês fazem só recrutamento ou também cuidam da folha de pagamento?' },
      { title: 'Candidato perguntando sobre vaga', openingMessage: 'Vi a vaga de vocês no LinkedIn, ainda está aberta?' },
      { title: 'Reclamação que exige humano', openingMessage: 'Estamos insatisfeitos com os candidatos enviados, precisamos conversar com alguém.' },
    ],
  },

  internship_agency: {
    key: 'internship_agency',
    labelPt: 'Agente de Integração de Estágio',
    labelEn: 'Internship Integration Agency',
    terminology: {
      customer: { pt: 'Empresa', en: 'Company' },
      appointment: { pt: 'Acompanhamento de estágio', en: 'Internship check-in' },
      staff: { pt: 'Responsável pela vaga', en: 'Program coordinator' },
      deal: { pt: 'Estágio fechado', en: 'Internship placed' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Como funciona o serviço de agente de integração (intermediação entre empresa, estudante e instituição de ensino)',
          'Documentos exigidos pra abertura de vaga de estágio por uma empresa',
          'Documentos exigidos do estudante pra formalizar o estágio (Termo de Compromisso de Estágio)',
          'Instituições de ensino parceiras',
          'Quando transferir pra um humano — QUALQUER pergunta sobre interpretação da Lei do Estágio (11.788/08) ou situação jurídica deve ser escalada, nunca respondida com opinião própria da IA',
        ],
        profileSchemaFragment: 'partner_institutions (string[]), required_company_documents (string[]), required_student_documents (string[])',
      },
      sdr: {
        extraTopics: [
          'Perfil de empresa que costuma contratar estagiários através da agência (porte, setor)',
          'Valor cobrado da empresa pelo serviço de intermediação',
          'Diferencial competitivo (rede de instituições parceiras, agilidade, suporte jurídico)',
        ],
        profileSchemaFragment: 'target_company_profile (string), service_fee_model (string), differentiators (string[])',
      },
      recruiter: {
        extraTopics: [
          'Critérios de elegibilidade do estudante pra estágio (curso, período, instituição parceira ou não)',
          'Processo de candidatura do estudante até o fechamento do estágio (etapas)',
          'Regras de estágio DEFINIDAS PELA EMPRESA cliente (carga horária, bolsa, benefícios) — sempre coletar da empresa, nunca inventar',
          'Documentação necessária pra formalizar (Termo de Compromisso de Estágio, seguro)',
          'Quando escalar pra um humano — qualquer dúvida jurídica sobre a legislação de estágio',
        ],
        profileSchemaFragment:
          'eligibility_criteria (string), application_process_steps (string[]), required_documents (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'company_contact_name', label: 'Responsável pela vaga na empresa', type: 'text' },
      { key: 'partner_institution', label: 'Instituição de ensino parceira', type: 'text' },
      { key: 'open_internship_positions', label: 'Vagas de estágio abertas', type: 'number' },
      { key: 'internship_course_requirements', label: 'Cursos aceitos', type: 'textarea' },
      { key: 'stipend_amount', label: 'Bolsa/auxílio', type: 'number' },
      { key: 'benefits_notes', label: 'Benefícios oferecidos', type: 'textarea' },
      { key: 'contract_status', label: 'Status do contrato de estágio', type: 'select', options: ['em análise', 'ativo', 'concluído', 'encerrado'] },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_companies', labelPt: 'Empresas ativas', labelEn: 'Active companies' },
      { key: 'active_internships', labelPt: 'Estágios ativos', labelEn: 'Active internships' },
      { key: 'placements_this_month', labelPt: 'Estágios fechados no mês', labelEn: 'Internships placed this month' },
    ],
    testScenarios: [
      { title: 'Nova empresa', openingMessage: 'Oi, temos uma vaga de estágio em aberto e queríamos formalizar através de vocês.' },
      { title: 'Estudante interessado', openingMessage: 'Vi a vaga de estágio de vocês, sou estudante de administração, posso me candidatar?' },
      { title: 'Documentação', openingMessage: 'Que documentos eu preciso pra assinar o Termo de Compromisso de Estágio?' },
      { title: 'Dúvida jurídica que exige humano', openingMessage: 'A empresa quer que eu trabalhe 8h por dia, isso é permitido pela lei do estágio?' },
      { title: 'Encerramento de estágio', openingMessage: 'Preciso encerrar o estágio de um dos nossos estudantes antes do prazo, como funciona?' },
    ],
  },

  restaurant_food_service: {
    key: 'restaurant_food_service',
    labelPt: 'Restaurante e Lanchonete',
    labelEn: 'Restaurant & Food Service',
    terminology: {
      customer: { pt: 'Cliente', en: 'Customer' },
      appointment: { pt: 'Reserva', en: 'Reservation' },
      staff: { pt: 'Equipe', en: 'Staff' },
      deal: { pt: 'Pedido/reserva confirmado', en: 'Order/reservation confirmed' },
    },
    interviewExtra: {
      receptionist: {
        extraTopics: [
          'Cardápio: categorias, itens principais e preços que a IA pode informar diretamente',
          'Adicionais/opcionais disponíveis por item',
          'Unidades/lojas e horário de funcionamento de cada uma (inclusive horários especiais)',
          'Delivery: área de entrega, taxa, tempo médio, plataformas usadas (próprio WhatsApp, iFood, etc.)',
          'Retirada no balcão: como funciona',
          'Reservas: capacidade da casa, se aceita reserva e com quanto tempo de antecedência',
          'Restrições alimentares/alergias — SEMPRE registrar o que o cliente informar e nunca garantir ausência total de contaminação cruzada sem confirmação da cozinha',
          'Promoções ativas que a IA pode oferecer',
          'Política de cancelamento de pedido/reserva',
          'Quando transferir pra um humano (reclamação, pedido incomum, problema no pedido)',
        ],
        profileSchemaFragment:
          'menu_categories (record: items, prices, addons), locations (record: hours, delivery_area, capacity), delivery_platforms (string[]), reservation_policy (string), cancellation_policy (string)',
      },
      sdr: {
        extraTopics: [
          'Unidades e área de cobertura de delivery',
          'Ticket médio por pedido',
          'Diferencial competitivo (cardápio, tempo de entrega, ambiente para eventos)',
        ],
        profileSchemaFragment: 'coverage_area (string), avg_order_ticket (number), differentiators (string[])',
      },
    },
    customerFieldSchema: [
      { key: 'preferred_location', label: 'Unidade preferida', type: 'text' },
      { key: 'delivery_address', label: 'Endereço de entrega', type: 'textarea' },
      { key: 'phone', label: 'Telefone de contato', type: 'text' },
      { key: 'dietary_restrictions', label: 'Restrições alimentares/alergias', type: 'textarea' },
      { key: 'order_type', label: 'Tipo de pedido', type: 'select', options: ['delivery', 'retirada', 'reserva na casa'] },
      { key: 'reservation_party_size', label: 'Número de pessoas (reserva)', type: 'number' },
      { key: 'favorite_items', label: 'Itens favoritos', type: 'textarea' },
      { key: 'notes', label: 'Observações', type: 'textarea' },
    ],
    dashboardKpis: [
      { key: 'active_customers', labelPt: 'Clientes ativos', labelEn: 'Active customers' },
      { key: 'orders_this_month', labelPt: 'Pedidos/reservas no mês', labelEn: 'Orders/reservations this month' },
      { key: 'avg_ticket', labelPt: 'Ticket médio', labelEn: 'Average ticket' },
    ],
    testScenarios: [
      { title: 'Pedido delivery', openingMessage: 'Oi, vocês entregam no meu bairro? Queria fazer um pedido.' },
      { title: 'Reserva', openingMessage: 'Queria reservar uma mesa pra 6 pessoas nesse sábado à noite.' },
      { title: 'Restrição alimentar', openingMessage: 'Tenho alergia a amendoim, algum prato do cardápio de vocês é seguro?' },
      { title: 'Dúvida de cardápio/preço', openingMessage: 'Quanto custa o combo família de vocês e o que vem nele?' },
      { title: 'Problema no pedido que exige humano', openingMessage: 'Meu pedido chegou errado e faltando item, o que eu faço agora?' },
      { title: 'Horário especial', openingMessage: 'Vocês abrem no feriado essa segunda?' },
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
