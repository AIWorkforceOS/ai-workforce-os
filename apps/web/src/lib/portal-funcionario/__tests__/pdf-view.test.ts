import { describe, expect, it } from 'vitest'
import { clampZoom, MAX_CANVAS_PIXELS, MAX_ZOOM, MIN_ZOOM, pinchZoom, planPage, stepZoom, touchDistance } from '../pdf-view'

describe('zoom do visualizador', () => {
  it('abre na largura da tela (1) e os botões andam de 25% em 25% dentro dos limites', () => {
    expect(stepZoom(1, 1)).toBe(1.25)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
    expect(clampZoom(NaN)).toBe(1)
    expect(clampZoom(99)).toBe(MAX_ZOOM)
    expect(clampZoom(0.01)).toBe(MIN_ZOOM)
  })
  it('pinça: afastar os dedos aumenta, aproximar diminui, sempre dentro dos limites', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 200, 100)).toBe(1)
    expect(pinchZoom(1, 100, 10000)).toBe(MAX_ZOOM)
    expect(pinchZoom(1, 100, 1)).toBe(MIN_ZOOM)
    expect(pinchZoom(1.5, 0, 50)).toBe(1.5)
    expect(touchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5)
  })
})

describe('planPage', () => {
  // Carta (612×792 pt) num iPhone: 375 de largura útil, densidade 3
  it('ajustar à tela: a página inteira cabe na largura; canvas nítido (densidade até 2×)', () => {
    const p = planPage({ containerWidth: 375, zoom: 1, pageWidth: 612, pageHeight: 792, devicePixelRatio: 3 })
    expect(p.cssWidth).toBe(375)
    expect(p.cssHeight).toBe(485)
    expect(p.canvasWidth).toBe(750)
    expect(p.scale).toBeCloseTo(750 / 612, 5)
  })
  it('zoom aumenta a largura em CSS (a rolagem horizontal leva ao resto)', () => {
    expect(planPage({ containerWidth: 375, zoom: 2, pageWidth: 612, pageHeight: 792, devicePixelRatio: 2 }).cssWidth).toBe(750)
  })
  it('nunca passa do limite de pixels do canvas (Safari do iPhone)', () => {
    const p = planPage({ containerWidth: 375, zoom: 4, pageWidth: 612, pageHeight: 792, devicePixelRatio: 3 })
    expect(p.canvasWidth * p.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS)
    expect(p.canvasWidth).toBeGreaterThanOrEqual(p.cssWidth) // nunca abaixo da resolução da tela
  })
  it('tolera densidade ausente', () => {
    expect(planPage({ containerWidth: 300, zoom: 1, pageWidth: 600, pageHeight: 800, devicePixelRatio: 0 }).canvasWidth).toBe(300)
  })
})
