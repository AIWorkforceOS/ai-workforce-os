import { describe, expect, it } from 'vitest'
import { analyzeHtml, computeSeoScore } from '../audit'
import type { SeoCheck } from '../types'

const GOOD_PAGE_HTML = `
<!doctype html>
<html lang="pt-BR">
<head>
  <title>Limpeza Residencial em Campinas — Casa Impecável</title>
  <meta name="description" content="A Casa Impecável faz limpeza residencial completa em Campinas e região, com equipe própria treinada e produtos ecológicos. Agende online.">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="canonical" href="https://www.casaimpecavel.com.br/">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"LocalBusiness","name":"Casa Impecável"}</script>
</head>
<body>
  <h1>Limpeza residencial em Campinas</h1>
  <p>Texto de introdução sobre os serviços.</p>
  <h2>Nossos serviços</h2>
  <img src="/fachada.jpg" alt="Fachada da Casa Impecável">
  <img src="/equipe.jpg" alt="Equipe de limpeza uniformizada">
</body>
</html>
`

const BAD_PAGE_HTML = `
<!doctype html>
<html>
<head></head>
<body>
  <img src="/foto1.jpg">
  <img src="/foto2.jpg" alt="">
  <p>Site sem estrutura nenhuma de SEO.</p>
</body>
</html>
`

describe('analyzeHtml — página bem otimizada', () => {
  const checks = analyzeHtml(GOOD_PAGE_HTML, 'https://www.casaimpecavel.com.br/')
  const byId = new Map(checks.map((c) => [c.id, c]))

  it('aprova title com bom tamanho', () => {
    expect(byId.get('title')?.status).toBe('pass')
  })

  it('aprova meta description com bom tamanho', () => {
    expect(byId.get('meta_description')?.status).toBe('pass')
  })

  it('aprova exatamente um H1', () => {
    expect(byId.get('h1')?.status).toBe('pass')
  })

  it('aprova presença de H2', () => {
    expect(byId.get('h2')?.status).toBe('pass')
  })

  it('aprova todas as imagens com alt preenchido', () => {
    expect(byId.get('image_alt')?.status).toBe('pass')
  })

  it('aprova meta viewport mobile-friendly', () => {
    expect(byId.get('viewport')?.status).toBe('pass')
  })

  it('aprova tag canonical presente', () => {
    expect(byId.get('canonical')?.status).toBe('pass')
  })

  it('aprova JSON-LD presente', () => {
    expect(byId.get('structured_data')?.status).toBe('pass')
  })

  it('aprova HTTPS', () => {
    expect(byId.get('https')?.status).toBe('pass')
  })

  it('computa score 100 quando tudo passa', () => {
    expect(computeSeoScore(checks)).toBe(100)
  })
})

describe('analyzeHtml — página mal otimizada', () => {
  const checks = analyzeHtml(BAD_PAGE_HTML, 'http://casaruim.com.br/')
  const byId = new Map(checks.map((c) => [c.id, c]))

  it('reprova ausência de title', () => {
    expect(byId.get('title')?.status).toBe('fail')
    expect(byId.get('title')?.recommendation).toContain('title')
  })

  it('reprova ausência de meta description', () => {
    expect(byId.get('meta_description')?.status).toBe('fail')
  })

  it('reprova ausência de H1', () => {
    expect(byId.get('h1')?.status).toBe('fail')
  })

  it('avisa ausência de H2 (warning, não fail)', () => {
    expect(byId.get('h2')?.status).toBe('warning')
  })

  it('reprova imagens sem alt (conta as duas)', () => {
    const imageCheck = byId.get('image_alt')!
    expect(imageCheck.status).toBe('fail')
    expect(imageCheck.message).toContain('2 de 2')
  })

  it('reprova ausência de viewport', () => {
    expect(byId.get('viewport')?.status).toBe('fail')
  })

  it('avisa ausência de canonical (warning, não fail)', () => {
    expect(byId.get('canonical')?.status).toBe('warning')
  })

  it('avisa ausência de dados estruturados (warning, não fail)', () => {
    expect(byId.get('structured_data')?.status).toBe('warning')
  })

  it('reprova HTTP (não HTTPS)', () => {
    expect(byId.get('https')?.status).toBe('fail')
  })

  it('computa score baixo (não zero, por causa dos warnings)', () => {
    const score = computeSeoScore(checks)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(40)
  })
})

describe('computeSeoScore', () => {
  it('devolve 0 para lista vazia', () => {
    expect(computeSeoScore([])).toBe(0)
  })

  it('devolve 50 quando metade passa e metade falha', () => {
    const checks: SeoCheck[] = [
      { id: 'a', label: 'A', status: 'pass', message: '', recommendation: '' },
      { id: 'b', label: 'B', status: 'fail', message: '', recommendation: '' },
    ]
    expect(computeSeoScore(checks)).toBe(50)
  })

  it('conta warning como meio ponto', () => {
    const checks: SeoCheck[] = [{ id: 'a', label: 'A', status: 'warning', message: '', recommendation: '' }]
    expect(computeSeoScore(checks)).toBe(50)
  })
})
