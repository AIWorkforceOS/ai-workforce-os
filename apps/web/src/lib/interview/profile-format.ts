// Formatação pura (sem JSX) do business_profile pra tela "Manual de
// Trabalho" (Fase 6) — deixa a ficha aprendida na entrevista legível pro
// dono da empresa, sem expor nomes de campo técnicos ou JSON cru.
//
// Fica em .ts (não .tsx) de propósito: vitest deste repo não consegue
// importar componente (tsconfig usa jsx:"preserve", quebra o parser do
// Vite) — ver docs/ux-audit-fase1-2026-08-19.md / memória da Fase 2.

/** "politica_desconto" → "Politica desconto" — só formata, não traduz (as chaves já são termos em português). */
export function humanizeFieldLabel(key: string): string {
  const spaced = key.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Converte qualquer valor do perfil (string, número, boolean, array, objeto) num texto legível.
 *
 * Achado ao vivo em produção (não só leitura de código, Fase 6): um array de objetos (ex.: lista de
 * produtos com nome/preço/detalhes) virava um parágrafo corrido só com vírgulas/ponto-e-vírgula
 * separando tudo — sem nenhuma pista visual de onde um item termina e o outro começa. Numerar os
 * itens do array ("1) ... 2) ...") resolve isso sem precisar reestruturar profileEntries pra
 * suportar valor não-string (o <dl> que consome isso hoje espera string simples).
 */
export function humanizeProfileValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não'
  if (Array.isArray(value)) {
    if (value.length === 0) return '—'
    const hasObjectItems = value.some(isPlainObject)
    if (hasObjectItems && value.length > 1) {
      return value.map((item, i) => `${i + 1}) ${isPlainObject(item) ? humanizeProfileValue(item) : String(item)}`).join('  ')
    }
    return value.map((item) => (isPlainObject(item) ? humanizeProfileValue(item) : String(item))).join(', ')
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) return '—'
    return entries.map(([key, v]) => `${humanizeFieldLabel(key)}: ${humanizeProfileValue(v)}`).join(', ')
  }
  return String(value)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Campos internos de encanamento (Ficha da Empresa compartilhada, migration 025) — nunca aparecem na ficha do FUNCIONÁRIO. */
function isInternalOrgField(key: string): boolean {
  return key.startsWith('org_')
}

export type ProfileEntry = { label: string; value: string }

/**
 * business_profile → lista ordenada de {label, value} prontos pra exibir.
 * Omite campos vazios e os campos internos org_* (pertencem à Ficha da
 * Empresa compartilhada, não ao que ESTE funcionário aprendeu).
 */
export function profileEntries(profile: Record<string, unknown> | null | undefined): ProfileEntry[] {
  if (!profile) return []
  return Object.entries(profile)
    .filter(([key, value]) => !isInternalOrgField(key) && hasVisibleValue(value))
    .map(([key, value]) => ({ label: humanizeFieldLabel(key), value: humanizeProfileValue(value) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

function hasVisibleValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (isPlainObject(value)) return Object.keys(value).length > 0
  return true
}
