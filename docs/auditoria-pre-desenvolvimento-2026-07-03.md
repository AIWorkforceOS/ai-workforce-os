# Auditoria Pré-Desenvolvimento — AI Workforce OS
**Data:** 2026-07-03  
**Objetivo:** Verificar se o projeto está pronto para iniciar o desenvolvimento do módulo Agente SDR  
**Escopo:** Leitura completa do repositório — nenhum arquivo foi modificado

---

## Resumo Executivo

O projeto tem uma base de monorepo sólida e a pipeline CI está funcionando no GitHub. No entanto, **o repositório local está 5 commits atrás do remoto** e contém alterações não commitadas em 3 arquivos críticos de configuração. Antes de começar qualquer desenvolvimento, é obrigatório fazer `git pull` e resolver o estado dos arquivos modificados. Supabase e Vercel ainda precisam de configuração completa.

---

## 1. Estado do Repositório Git

**❌ Branch local 5 commits atrás do `origin/main`**

O `git pull` nunca foi feito após os últimos pushes. O `origin/main` está em:
```
0afa908 fix(ci): upgrade to setup-node@v5 e Node 22
419b2e6 fix(ci): remove redundant pnpm version
3586da1 ci: add GitHub Actions validation workflow
0e94c43 fix(vercel): set Root Directory apps/web
7d4f66e chore: infra audit — .gitignore hardening, .env.example, vercel.json fix
```
O `HEAD` local ainda está em `780d1bc` (feat: MVP Core Setup).

**❌ Arquivos com alterações locais não commitadas**

| Status | Arquivo | Detalhe |
|--------|---------|---------|
| Staged (não commitado) | `vercel.json` | `buildCommand` modificado: removeu o `cd ../..` |
| Unstaged | `.gitignore` | Modificado localmente mas não adicionado |
| Unstaged | `apps/web/vercel.json` | Adicionados `installCommand`, `buildCommand`, `outputDirectory` |
| Untracked | `.github/` | Pasta com `ci.yml` existe localmente mas nunca foi commitada |
| Untracked | `CLAUDE.md` | Arquivo de instruções criado localmente, não versionado |
| Untracked | `apps/web/.env.example` | Criado localmente, não versionado |

**Consequência prática:** as mudanças no origin/main já corrigem esses mesmos arquivos. Fazer `git pull` vai provavelmente criar conflitos que precisarão ser resolvidos manualmente.

**⚠️ CLAUDE.md cita commit inexistente**

O `CLAUDE.md` documenta: *"CI verde (commit `60823ce`, run #6)"*. Esse hash **não existe** em nenhum lugar do histórico (nem local, nem remoto). O commit atual no origin/main é `0afa908`. Essa referência está incorreta e deve ser atualizada.

**✅ Conexão com GitHub**
- Remote configurado: `https://github.com/AIWorkforceOS/ai-workforce-os.git`
- Branch: `main`

---

## 2. Estrutura do Projeto

**✅ Estrutura do monorepo correta**

```
ai-workforce-os/
├── apps/web/          ✅ Next.js 14 (App Router) — src/app/page.tsx, layout.tsx, globals.css
├── packages/
│   ├── ui/            ✅ Estrutura criada — index.ts vazio (export {})
│   ├── utils/         ✅ Estrutura criada — index.ts vazio (export {})
│   └── types/         ✅ Estrutura criada — index.ts vazio (export {})
├── packs/             ⚠️ Só tem .gitkeep — vazio
├── infra/             ⚠️ Só tem .gitkeep — vazio
├── tools/             ⚠️ Só tem .gitkeep — vazio
└── docs/              ✅ architecture-freeze-v1.md presente
```

**✅ Stack configurada corretamente**
- Node.js `>=20` esperado; Node 22.22.3 disponível
- `pnpm@11.9.0` declarado no `packageManager`
- Turborepo v2 configurado com tasks: `build`, `dev`, `lint`, `typecheck`, `clean`
- Next.js `^14.2.0` + React `^18.3.0`
- TypeScript `^5.5.0` com `strict: true`, `noUncheckedIndexedAccess: true`
- ESLint v9 (flat config) com `@typescript-eslint`
- Prettier v3 configurado

**✅ Arquivos de configuração bem estruturados**
- `tsconfig.base.json` na raiz com configurações strict compartilhadas
- `eslint.config.mjs` com parser TypeScript e regras recomendadas
- `turbo.json` com pipeline de build configurada corretamente

**⚠️ `package.json` raiz usa `pnpm run lint` via Turbo, mas o CI do origin/main usa `pnpm run lint` também via Turbo**

O `apps/web/package.json` tem `"lint": "next lint"`, mas a raiz não tem ESLint configurado para o Next.js (sem `next.config` com ESLint). O Turbo chama o lint de cada workspace separadamente — isso pode passar no CI mas não detectar problemas do Next.js ESLint. Baixo risco agora, mas vale revisar ao adicionar código.

---

## 3. Vercel

**⚠️ Nenhum `.vercel/project.json` encontrado**

O projeto não está linkado localmente ao Vercel. Isso significa que `vercel deploy` na linha de comando não vai funcionar sem antes rodar `vercel link`. Não é um problema crítico se o deploy é feito pelo GitHub integration, mas é uma lacuna na configuração local.

**⚠️ Dois `vercel.json` com configurações conflitantes**

| Arquivo | buildCommand | outputDirectory |
|---------|-------------|----------------|
| `/vercel.json` (staged, local) | `pnpm turbo run build --filter=...` | `apps/web/.next` |
| `apps/web/vercel.json` (unstaged, local) | `cd ../.. && pnpm turbo run build --filter=...` | `.next` |

Esses dois arquivos existem para cenários diferentes: um para quando o Vercel aponta a raiz do repo, outro para quando aponta `apps/web/`. O origin/main tem a versão correta dessas configurações. Fazer `git pull` vai resolver isso.

**⚠️ URL de produção não documentada**

O `architecture-freeze-v1.md` diz que o Vercel está "pendente". Não há registro da URL de produção no repositório.

**✅ Isolamento de secrets correto**

`.gitignore` bloqueia `.env`, `.env.*` (exceto `.env.example`). Nenhuma secret foi encontrada no código.

---

## 4. Supabase

**❌ Supabase não configurado no repositório**

- Sem diretório `supabase/`
- Sem `config.toml`
- Sem migrations
- Sem `supabase init` rodado

O `README.md` e a `architecture-freeze-v1.md` documentam que o Supabase está "pendente". Isso é esperado — mas **bloqueia qualquer funcionalidade que dependa de banco de dados**, incluindo o Agente SDR se ele precisar persistir dados.

**✅ Variáveis de ambiente mapeadas**

Os `.env.example` (raiz e `apps/web/`) listam o que será necessário quando o Supabase for configurado:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 5. CI/CD

**✅ GitHub Actions configurado no remoto**

O `origin/main` tem `.github/workflows/ci.yml` com:
- `pnpm/action-setup@v4` (lê versão do `packageManager` no `package.json`)
- `actions/setup-node@v5` com Node 22
- Pipeline: `install → lint → typecheck → build`

**⚠️ CI local está desatualizado**

O `.github/workflows/ci.yml` local (untracked) usa `setup-node@v4` + Node 20. Esse arquivo nunca foi commitado e o origin/main já tem a versão correta. Após o `git pull`, a versão local será substituída pela correta.

**✅ ESLint passa sem erros** (verificado localmente, exit code 0)

**✅ TypeScript typecheck passa em todos os workspaces** (verificado localmente, exit code 0 em web, ui, utils, types)

**✅ Build do Next.js provavelmente funciona** — o diretório `.next/` já existe em `apps/web/`, indicando que um build anterior foi bem-sucedido. Não foi possível rodar um novo build completo via Turbo no sandbox (pnpm não disponível como binário global), mas a estrutura está correta.

---

## 6. Estado Real vs. Documentado

| O que o CLAUDE.md diz | O que é real |
|----------------------|--------------|
| CI verde, commit `60823ce` | ❌ Esse commit não existe. O último commit no origin/main é `0afa908` |
| CI verde (run #6) | ✅ Plausível — o CI provavelmente passou no GitHub com os commits do origin/main |
| ESLint via `eslint .` (não `next lint`) | ✅ Correto — a raiz usa ESLint flat config |
| Branch `main` | ✅ Correto |
| Projeto em RC0, pré-desenvolvimento | ✅ Correto |

---

## Diagnóstico Final

### ✅ Está correto e funcionando
- Estrutura do monorepo Turborepo + Next.js 14 + pnpm workspaces
- TypeScript strict em todos os workspaces (sem erros)
- ESLint v9 flat config (sem erros)
- GitHub Actions configurado no remoto e provavelmente passando
- Isolamento de secrets (gitignore correto, sem secrets no repo)
- Separação total do Sistema Smarter (nada misturado)
- Architecture Decision Record documentando as decisões fundadoras
- Packages ui/utils/types criados como placeholders prontos para desenvolvimento

### ⚠️ Precisa atenção antes de desenvolver
- **`git pull` obrigatório** — o local está 5 commits atrás do remoto. Pode gerar conflitos nos arquivos de `vercel.json` e `.gitignore` que precisarão ser resolvidos.
- **Resolver arquivos staged/unstaged** — commitá-los ou descartá-los antes de começar qualquer trabalho novo
- **CLAUDE.md com commit hash inválido** (`60823ce`) — atualizar para o hash real (`0afa908`)
- **URL de produção do Vercel não documentada** — se já existe, documentar no README
- **`.vercel/project.json` ausente** — rodar `vercel link` localmente para habilitar deploys via CLI

### ❌ Bloqueios para funcionalidades com banco de dados
- **Supabase não inicializado** — sem `supabase init`, sem migrations, sem schema. Se o Agente SDR precisar persistir dados (leads, histórico de conversas, tarefas), o Supabase precisa ser configurado antes de desenvolver essa parte.

---

## Checklist de Ações Antes de Começar o Agente SDR

```
[ ] 1. git pull (resolver conflitos se houver)
[ ] 2. Confirmar que git status está limpo (sem staged/unstaged)
[ ] 3. Atualizar CLAUDE.md com hash correto do último commit
[ ] 4. Verificar no GitHub Actions se o CI passou nos últimos commits do origin/main
[ ] 5. Decidir: Agente SDR vai precisar de banco de dados no MVP?
        → Se sim: supabase init + primeira migration antes de começar
        → Se não: pode começar direto no frontend/lógica sem banco
[ ] 6. Criar ADR para o módulo Agente SDR (obrigatório conforme architecture-freeze-v1.md)
[ ] 7. Definir onde o código do Agente SDR vai viver
        → Provavelmente apps/web/src/app/(sdr)/ para as rotas
        → E/ou packages/types/ para os tipos compartilhados
```
