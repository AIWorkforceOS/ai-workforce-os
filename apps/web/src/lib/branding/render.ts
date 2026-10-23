import type { CSSProperties } from 'react'

/** Logo escura sobre transparente (o upload marca o nome com -dk): ganha um brilho claro fino em volta do desenho para aparecer no painel escuro. Sem caixa. */
export function logoIsDarkOnTransparent(url: string | null | undefined): boolean {
  return Boolean(url && /-dk\.png(\?|$)/.test(url))
}

export function logoEdgeStyle(url: string | null | undefined): CSSProperties | undefined {
  return logoIsDarkOnTransparent(url) ? { filter: 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 0 5px rgba(255,255,255,0.35))' } : undefined
}
