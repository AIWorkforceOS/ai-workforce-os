/**
 * Visualizador do Sign Off no celular: contas puras (sem DOM) do zoom e do tamanho das páginas.
 * O zoom é RELATIVO à largura da tela: 1 = a página inteira cabe na largura ("Ajustar à tela").
 */
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
export const ZOOM_STEP = 0.25

export const clampZoom = (z: number): number => (Number.isFinite(z) ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z * 100) / 100)) : 1)

export const stepZoom = (z: number, direction: 1 | -1): number => clampZoom(z + direction * ZOOM_STEP)

/** Pinça com dois dedos: o zoom acompanha a razão entre a distância atual e a inicial dos dedos. */
export function pinchZoom(startZoom: number, startDistance: number, distance: number): number {
  if (!(startDistance > 0) || !(distance > 0)) return clampZoom(startZoom)
  return clampZoom(startZoom * (distance / startDistance))
}

export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/** Limite de pixels de um canvas: o Safari do iPhone derruba o app acima de ~16,7 milhões. */
export const MAX_CANVAS_PIXELS = 12_000_000

export type PagePlan = { scale: number; cssWidth: number; cssHeight: number; canvasWidth: number; canvasHeight: number }

/**
 * Como desenhar uma página: `scale` é a escala do pdf.js para a página ocupar `cssWidth` na tela; o canvas tem resolução maior (densidade da tela, no
 * máximo 2×) para o texto ficar nítido, reduzida se passar do limite de pixels.
 */
export function planPage(input: { containerWidth: number; zoom: number; pageWidth: number; pageHeight: number; devicePixelRatio: number }): PagePlan {
  const cssWidth = Math.max(1, Math.floor(input.containerWidth * clampZoom(input.zoom)))
  const ratio = input.pageHeight / input.pageWidth
  const cssHeight = Math.max(1, Math.floor(cssWidth * ratio))
  let density = Math.min(2, Math.max(1, input.devicePixelRatio || 1))
  while (density > 1 && cssWidth * density * cssHeight * density > MAX_CANVAS_PIXELS) density = Math.max(1, density - 0.25)
  return { scale: (cssWidth * density) / input.pageWidth, cssWidth, cssHeight, canvasWidth: Math.floor(cssWidth * density), canvasHeight: Math.floor(cssHeight * density) }
}
