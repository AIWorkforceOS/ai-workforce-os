// Detecção de idioma do post (pedido do Vinicius, 2026-08-23, achado ao
// testar a Mawi Cleaning): a legenda saiu em português porque o prompt de
// geração é todo escrito em português e nunca diz em qual idioma escrever
// — mesmo a ficha da empresa dizendo "English should be the primary
// social-media language". A correção pedida não é declarar um idioma fixo
// num campo de configuração (pode estar errado/ausente); é LER o texto de
// verdade da ficha (todos os campos descritivos, org + agente) e detectar
// o idioma dominante por volume de sinais — não por presença de 1 palavra
// isolada, já que a ficha real da Mawi mistura os dois idiomas (poucas
// frases em português, muito texto em inglês) e o idioma que deve vencer é
// o que domina o conteúdo, não o que apareceu primeiro.

export type DetectedLanguage = 'pt' | 'en'

/**
 * Extrai todo texto "de prosa" (strings longas o bastante para carregar
 * sinal de idioma) de um ou mais objetos de ficha de negócio — recursivo e
 * agnóstico ao nome dos campos, pra funcionar em qualquer vertical sem
 * precisar listar campo por campo.
 */
export function extractProseText(profiles: (Record<string, unknown> | null | undefined)[]): string {
  const strings: string[] = []
  function walk(value: unknown) {
    if (typeof value === 'string') {
      // >=15 chars E com espaço — descarta enums/IDs/URLs tipo "cleaning_services" (sem espaço não é prosa).
      if (value.trim().length >= 15 && value.includes(' ')) strings.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item)
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) walk(v)
    }
  }
  for (const profile of profiles) {
    if (profile) walk(profile)
  }
  return strings.join(' ')
}

const PT_SIGNAL_WORDS = [
  ' de ', ' da ', ' do ', ' das ', ' dos ', ' para ', ' com ', ' não ', ' uma ', ' um ',
  ' que ', ' você ', ' são ', ' está ', ' também ', ' pelo ', ' pela ', ' ção ', ' mente ',
]
const EN_SIGNAL_WORDS = [
  ' the ', ' and ', ' with ', ' you ', ' our ', ' are ', ' is ', ' we ', ' for ', ' your ',
  ' this ', ' that ', ' will ', ' should ', ' customer ', ' customers ',
]
const PT_ACCENT_CHARS = /[ãõçáéíóúâêô]/gi

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  return haystack.split(needle).length - 1
}

/**
 * Detecta se um texto está predominantemente em português ou inglês,
 * contando VOLUME de sinal (não só presença) — texto longo num idioma
 * pesa mais que uma frase curta no outro. Sem sinal nenhum (texto vazio ou
 * curto demais), cai no padrão do produto (português, BR).
 */
export function detectLanguageFromText(text: string): DetectedLanguage {
  const normalized = ` ${text.toLowerCase()} `

  let ptScore = PT_SIGNAL_WORDS.reduce((sum, word) => sum + countOccurrences(normalized, word), 0)
  const accentMatches = text.match(PT_ACCENT_CHARS)
  if (accentMatches) ptScore += accentMatches.length

  const enScore = EN_SIGNAL_WORDS.reduce((sum, word) => sum + countOccurrences(normalized, word), 0)

  if (ptScore === 0 && enScore === 0) return 'pt'
  return enScore > ptScore ? 'en' : 'pt'
}

/** Atalho: detecta o idioma direto a partir das fichas de negócio (org + agente). */
export function detectBusinessLanguage(profiles: (Record<string, unknown> | null | undefined)[]): DetectedLanguage {
  return detectLanguageFromText(extractProseText(profiles))
}
