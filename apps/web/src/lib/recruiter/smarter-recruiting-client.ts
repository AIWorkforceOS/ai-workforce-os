import type { PartnerRecruitingClient, PartnerVacancy, PartnerVacancyInput } from './partner-recruiting-client'

// Cliente do sistema de vagas de parceiros da Smarter (escopo
// "recruitment": POST /api/partners/vacancies + POST /api/partners/applications
// no Sistema Smarter).
//
// FRONTEIRA EXPLÍCITA: mesma regra de isolamento de lib/recruiter/smarter-api.ts
// e lib/sales/smarter-crm.ts — a Smarter é tratada como fornecedora/consumidora
// externa via API HTTP autorizada por token de parceiro DA UNIDADE
// (units.smarter_recruiting_partner_token), nunca acesso direto a
// banco/código do Sistema Smarter (regra do CLAUDE.md).
//
// Contrato confirmado pelo dono do produto (que revisou o build das
// rotas do lado Smarter):
//   POST /api/partners/vacancies   → body: { titulo*, funcao?, area?, descricao?,
//     requisitos?, beneficios?, modalidade?, bolsa* (number), auxTransporte?,
//     cargaHoraria?, chDiaria?, horario?, diasSemana?, cidade?, uf?,
//     discDesejado?, nivel?, cursoRequerido?, companyId* } → { vacancy: {...} }
//   POST /api/partners/applications → body: { studentId*, vacancyId* } → { application: {...} }
//   (* = obrigatório) — 401 sem token, 403 sem escopo "recruitment", 400
//   validação, 404 recurso não pertence à franquia, 409 duplicata
//   (studentId+vacancyId já existe).
//
// Só os campos com correspondência direta e confiável no perfil da vaga
// do Alizo (job_openings.profile) são mapeados 1:1. Sinais estruturados
// que a Smarter espera em formato específico (discDesejado, nivel,
// cargaHoraria, chDiaria, diasSemana, auxTransporte, funcao, area,
// beneficios) NÃO têm fonte confiável hoje no perfil coletado pelo
// intake do Recruiter — ficam de fora em vez de adivinhar um valor
// errado. O que sobra de contexto útil (hard skills, ferramentas,
// idiomas, experiência, faixa de semestre) vai para o campo livre
// "requisitos", que aceita texto.

class SmarterRecruitingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const SMARTER_RECRUITING_API_BASE =
  process.env.SMARTER_RECRUITING_API_URL ?? 'https://sistema.smarterestagios.com.br/api/partners'

async function smarterRecruitingRequest(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`${SMARTER_RECRUITING_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  })

  const data = await response.json().catch(() => null)

  if (!response.ok) {
    const message = data?.error ?? data?.message ?? `API de recrutamento da Smarter retornou status ${response.status}`
    throw new SmarterRecruitingApiError(Array.isArray(message) ? message.join(', ') : String(message), response.status)
  }
  return data as Record<string, unknown> | null
}

/** "R$ 1.500,00" / "1500" / "1.500" → 1500. null quando não dá para extrair um número (bolsa é obrigatória na Smarter). */
function parseScholarshipToNumber(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/[^\d.,]/g, '')
  if (!cleaned) return null
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

function buildRequisitos(input: PartnerVacancyInput): string | undefined {
  const parts: string[] = []
  if (input.semesterMin || input.semesterMax) {
    parts.push(`Semestre: ${input.semesterMin ?? '?'}º a ${input.semesterMax ?? '?'}º`)
  }
  if (input.experience) parts.push(`Experiência: ${input.experience}`)
  if (input.hardSkills?.length) parts.push(`Habilidades: ${input.hardSkills.join(', ')}`)
  if (input.tools?.length) parts.push(`Ferramentas: ${input.tools.join(', ')}`)
  if (input.languages?.length) parts.push(`Idiomas: ${input.languages.join(', ')}`)
  return parts.length > 0 ? parts.join('; ') : undefined
}

function toVacancyRequestBody(input: PartnerVacancyInput, companyId: string): Record<string, unknown> {
  const bolsa = parseScholarshipToNumber(input.scholarship)
  if (bolsa === null) {
    throw new Error(
      `bolsa da vaga "${input.title}" não é um valor numérico válido ("${input.scholarship ?? 'vazio'}") — campo obrigatório para publicar no parceiro Smarter.`,
    )
  }
  return {
    titulo: input.title,
    descricao: input.description ?? undefined,
    requisitos: buildRequisitos(input),
    modalidade: input.modality ?? undefined,
    bolsa,
    horario: input.schedule ?? undefined,
    cidade: input.city ?? undefined,
    uf: input.state ?? undefined,
    cursoRequerido: input.course ?? undefined,
    companyId,
  }
}

async function createVacancy(token: string, companyId: string, input: PartnerVacancyInput): Promise<PartnerVacancy> {
  const data = await smarterRecruitingRequest('/vacancies', token, toVacancyRequestBody(input, companyId))
  const vacancy = data?.vacancy as PartnerVacancy | undefined
  if (!vacancy?.id) throw new Error('API de vagas da Smarter não retornou o id da vaga criada (data.vacancy.id).')
  return vacancy
}

async function addCandidateToVacancy(token: string, vacancyId: string, candidateExternalId: string): Promise<void> {
  try {
    await smarterRecruitingRequest('/applications', token, {
      studentId: candidateExternalId,
      vacancyId,
    })
  } catch (error) {
    // 409 = candidatura já existe (studentId+vacancyId) — idempotente, não é falha.
    if (error instanceof SmarterRecruitingApiError && error.status === 409) return
    throw error
  }
}

/** Implementação concreta do contrato genérico (partner-recruiting-client.ts) para a Smarter. */
export function createSmarterRecruitingClient(token: string, companyId: string): PartnerRecruitingClient {
  return {
    partnerName: 'Smarter',
    createVacancy: (input) => createVacancy(token, companyId, input),
    addCandidateToVacancy: (vacancyId, candidateExternalId) =>
      addCandidateToVacancy(token, vacancyId, candidateExternalId),
  }
}
