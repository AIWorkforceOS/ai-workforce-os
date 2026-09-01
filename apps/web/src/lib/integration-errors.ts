// Traduz erros técnicos crus da Meta Graph API e da Google Ads API (endpoint,
// código em inglês, jargão) para mensagens curtas e inteiramente em
// português, seguras de mostrar pro cliente final (dono de negócio sem
// conhecimento técnico). A mensagem original completa deve continuar sendo
// logada à parte (ver lib/system-events.ts) — esta função só decide o que
// o CLIENTE vê na tela.

export type IntegrationPlatform = 'meta' | 'google'

// Achado real (2026-08-28): códigos 10/200 aparecem tanto quando o
// cliente esqueceu de marcar "Gerenciar campanhas" quanto quando o
// compartilhamento nem chegou a ser concluído (conta errada, Business
// Manager errado, ou só falta propagar) — a chamada que valida a conexão
// é uma leitura básica (nome/moeda), então QUALQUER acesso insuficiente
// gera o mesmo erro. Mensagem ampliada pra cobrir as causas reais mais
// prováveis em vez de apontar só uma.
const META_PERMISSION_ERROR =
  'Ainda não conseguimos acessar essa conta. As causas mais comuns: (1) o compartilhamento não foi concluído — confira se colou o ID certo da Alizo e selecionou a conta de anúncio certa; (2) esqueceu de marcar "Gerenciar campanhas"; (3) só falta propagar — pode levar alguns minutos, espere um pouco e clique em "Testar e conectar" de novo.'

const META_ERROR_CODES: Record<number, string> = {
  100: META_PERMISSION_ERROR,
  10: META_PERMISSION_ERROR,
  200: META_PERMISSION_ERROR,
  190: 'O token de acesso informado é inválido ou expirou. Gere um novo token, ou deixe o campo em branco para usar o compartilhamento como Parceiro.',
  102: 'A sessão de acesso expirou. Tente novamente.',
  4: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  17: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  80004: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
}

const GOOGLE_ERROR_PATTERNS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /PERMISSION_DENIED/i,
    message: 'Falta permissão nessa conta. Confirme se o convite de vínculo com a Alizo já foi aceito.',
  },
  {
    pattern: /UNAUTHENTICATED|AUTHENTICATION_ERROR/i,
    message: 'Não foi possível confirmar suas credenciais. Confirme se o convite de vínculo com a Alizo já foi aceito.',
  },
  {
    pattern: /NOT_FOUND|CUSTOMER_NOT_FOUND/i,
    message: 'Não encontramos essa conta. Confira o Customer ID digitado (formato 123-456-7890).',
  },
  {
    pattern: /INVALID_ARGUMENT|INVALID_CUSTOMER_ID/i,
    message: 'O Customer ID informado parece inválido. Confira o número digitado.',
  },
  {
    pattern: /RESOURCE_EXHAUSTED|RATE_LIMIT|QUOTA/i,
    message: 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.',
  },
]

const GENERIC_FALLBACK: Record<IntegrationPlatform, string> = {
  meta: 'Não conseguimos confirmar essa conexão. Confira se o compartilhamento como Parceiro do Business Manager da Alizo foi concluído, ou fale com o suporte.',
  google: 'Não conseguimos confirmar essa conexão. Confira se o convite de vínculo com a Alizo já foi aceito, ou fale com o suporte.',
}

/**
 * `rawMessage` é o `error.message` cru vindo do cliente da API (ex.:
 * `Meta API act_123/campaigns falhou: Unsupported get request... (code 100)`).
 * Retorna sempre uma frase em português sem nome de endpoint/campo técnico.
 */
export function translateIntegrationError(platform: IntegrationPlatform, rawMessage: string): string {
  if (platform === 'meta') {
    const match = rawMessage.match(/\(code (\d+)\)/)
    const code = match?.[1] ? Number(match[1]) : null
    if (code !== null && META_ERROR_CODES[code]) return META_ERROR_CODES[code]
    return GENERIC_FALLBACK.meta
  }

  for (const { pattern, message } of GOOGLE_ERROR_PATTERNS) {
    if (pattern.test(rawMessage)) return message
  }
  return GENERIC_FALLBACK.google
}
