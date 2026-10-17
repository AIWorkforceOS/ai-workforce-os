/** Valores atuais do formulário que entram no rascunho (texto; arquivos e assinatura vão à parte). */
export type DraftFields = {
  status: string
  signedBy: string
  partPurchaseLink: string
  materialDescription: string
  materialValue: string
  hoursNeeded: string
}

/**
 * Só vale guardar rascunho se o técnico fez alguma coisa: tem foto/assinatura
 * novas ou mudou algum campo em relação ao que o servidor já tem. Sem isso
 * cada abertura da tela gravaria um rascunho vazio igual ao original.
 */
export function isDraftWorthSaving(params: {
  current: DraftFields
  serverValues: DraftFields
  fileCount: number
  hasSignature: boolean
}): boolean {
  if (params.fileCount > 0 || params.hasSignature) return true
  return (Object.keys(params.current) as (keyof DraftFields)[]).some((key) => params.current[key] !== params.serverValues[key])
}
