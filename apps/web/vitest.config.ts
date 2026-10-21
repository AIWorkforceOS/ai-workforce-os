import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Espelha o alias "@/*" do tsconfig para os testes poderem importar
// módulos que usam '@/lib/...'.
export default defineConfig({
  // Permite que os testes importem componentes .tsx (o tsconfig usa jsx: preserve, que o Vite não consegue processar).
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
