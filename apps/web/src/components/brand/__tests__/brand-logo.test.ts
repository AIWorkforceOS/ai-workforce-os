import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HeaderBrand, SidebarBrand } from '../brand-logo'

describe('logo no cabeçalho e no menu', () => {
  it('sem logo própria: a marca do Alizo exatamente como era (ícone + nome)', () => {
    const html = renderToStaticMarkup(createElement(HeaderBrand, { logoUrl: null }))
    expect(html).toContain('/branding/alizo-icon.png')
    expect(html).toContain('alizo')
    expect(renderToStaticMarkup(createElement(SidebarBrand, { logoUrl: null }))).toContain('/branding/alizo-logo.png')
  })
  it('com logo da empresa: ela SUBSTITUI a do Alizo (nenhum vestígio do Alizo), aparece SÓ a imagem — sem faixa nem fundo branco em volta', () => {
    const url = 'https://p.supabase.co/storage/v1/object/public/org-branding/o/logo-1.png'
    const header = renderToStaticMarkup(createElement(HeaderBrand, { logoUrl: url }))
    expect(header).toContain(url)
    expect(header).not.toMatch(/alizo/i)
    expect(header).not.toContain('rgba(255,255,255')
    expect(header).not.toMatch(/<span/)
    expect(header).not.toContain('drop-shadow') // logo com fundo próprio/normal: sem brilho
    const side = renderToStaticMarkup(createElement(SidebarBrand, { logoUrl: url }))
    expect(side).toContain(url)
    expect(side).not.toMatch(/alizo/i)
    expect(side).not.toContain('rgba(255,255,255')
  })
  it('logo escura sobre transparente (arquivo -dk): só um brilho claro fino no desenho, ainda sem caixa', () => {
    const dark = 'https://p.supabase.co/storage/v1/object/public/org-branding/o/logo-1-dk.png'
    const header = renderToStaticMarkup(createElement(HeaderBrand, { logoUrl: dark }))
    expect(header).toContain('drop-shadow')
    expect(header).not.toMatch(/<span/)
    expect(header).not.toMatch(/background/)
  })
})
