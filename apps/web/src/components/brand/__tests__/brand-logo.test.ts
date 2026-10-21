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
  it('com logo da empresa: ela SUBSTITUI a do Alizo (nenhum vestígio do Alizo) e fica sobre fundo claro', () => {
    const url = 'https://p.supabase.co/storage/v1/object/public/org-branding/o/logo-1.png'
    const header = renderToStaticMarkup(createElement(HeaderBrand, { logoUrl: url }))
    expect(header).toContain(url)
    expect(header).not.toMatch(/alizo/i)
    expect(header).toContain('rgba(255,255,255,0.96)')
    const side = renderToStaticMarkup(createElement(SidebarBrand, { logoUrl: url }))
    expect(side).toContain(url)
    expect(side).not.toMatch(/alizo/i)
  })
})
