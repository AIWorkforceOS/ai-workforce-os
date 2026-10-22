import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regra de negócio: o TÉCNICO nunca vê nada do cliente (nome, cadastro, logo, arquivo original da ordem com o cabeçalho dele, contato de quem emitiu).
 * Só a Mawi e a loja do atendimento. Este teste vigia o código do Portal do Funcionário para ninguém reintroduzir isso sem querer.
 */
const ROOTS = ['src/lib/portal-funcionario', 'src/components/portal-funcionario', 'src/app/portal-funcionario']
const FORBIDDEN = [/customers\s*\(/, /client_company/i, /clientCompany/, /service_order_file_url/, /service_order_file_name/, /service_order_issuer/, /service_order_client_po/, /client_company_profiles/, /customers\?\./, /\.customers\b/]

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : files(full)
    return /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}

describe('Portal do Funcionário não expõe dados do cliente', () => {
  const all = ROOTS.flatMap(files)
  it('encontra os arquivos do portal', () => expect(all.length).toBeGreaterThan(10))
  for (const re of FORBIDDEN) {
    it(`nenhum arquivo do portal usa ${re}`, () => {
      const hits = all.filter((f) => re.test(readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')))
      expect(hits).toEqual([])
    })
  }
})
