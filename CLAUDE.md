# AI Workforce OS — Regras de Desenvolvimento

## ⚠️ PROJETO ATIVO: AI Workforce OS

**Raiz do projeto:** `/Users/viniciusmiranda/Desktop/ai-workforce-os/`

---

## 🚫 ISOLAMENTO ABSOLUTO — LEIA ANTES DE QUALQUER AÇÃO

Este repositório é 100% isolado do **Sistema Smarter**.

- **NUNCA** acesse, leia, modifique ou importe nada de `/Users/viniciusmiranda/Desktop/Sistema smarter/`
- **NUNCA** use tabelas, banco de dados, schemas, variáveis de ambiente ou lógica do Smarter aqui
- **NUNCA** copie código do Smarter para cá
- Se o usuário pedir algo que envolva o Smarter, pare e pergunte — pode ser uma solicitação para o projeto errado

Qualquer dúvida sobre qual projeto trabalhar: **pergunte ao usuário antes de agir**.

---

## Estrutura do monorepo

```
ai-workforce-os/
├── apps/
│   └── web/          ← Next.js 14 (app router)
├── packages/
│   ├── ui/           ← Componentes compartilhados
│   ├── utils/        ← Utilitários
│   └── types/        ← Tipos TypeScript compartilhados
├── docs/
├── infra/
└── tools/
```

## Stack

- **Framework:** Next.js 14 (App Router)
- **Monorepo:** Turborepo + pnpm workspaces
- **Linguagem:** TypeScript 5.x
- **Lint:** ESLint v9 (flat config — `eslint.config.mjs` na raiz, `eslint .` nos scripts)
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) — lint + typecheck + build

## Regras de desenvolvimento

- Projeto em desenvolvimento ativo (pós-RC0), em produção no Vercel. Funcionalidades de
  produto (auth, units, agent config, WhatsApp/Evolution API, prospecção Google Maps,
  motor de conversação IA, leads, conversas, dashboards) já foram implementadas —
  consulte `supabase/migrations/` e o histórico de commits antes de assumir que algo
  "ainda não existe"
- Alterações de schema devem ser feitas via novas migrations em `supabase/migrations/`
  (nunca editar migrations já aplicadas)
- NÃO exponha tokens, senhas, API keys ou secrets no repositório
- NÃO misture com o banco da Smarter
- Integrações externas (OpenAI, Evolution API, Google Maps, Resend) devem falhar de
  forma graciosa quando a env var correspondente não estiver configurada

## CI/CD

Pipeline GitHub Actions (`.github/workflows/ci.yml`):
1. `pnpm install --frozen-lockfile`
2. `pnpm run lint` → usa ESLint v9 via `eslint .` (NÃO `next lint`)
3. `pnpm run typecheck`
4. `pnpm run build`

**Status atual:** ✅ CI verde (commit `0afa908`, run #6)
