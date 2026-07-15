import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Espelha o alias "@/*" do tsconfig para os testes poderem importar
// módulos que usam '@/lib/...'.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
})
