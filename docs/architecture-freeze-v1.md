# Architecture Freeze v1.0
## AI Workforce OS — Decision Record

**Data:** 2026-06-29  
**Autores:** CTO / Principal Architect  
**Status:** APROVADO E CONGELADO

---

## 1. Documentos Fundadores Aprovados

Os seguintes documentos fundadores foram aprovados e constituem a base oficial do AI Workforce OS:

1. **AI Workforce OS — Arquitetura Fundadora v1.0**
2. **PRD — CGO IA 001 + Smarter Pack v1.0**
3. **AI Workforce OS — Intelligence Layer v1.0**
4. **AI Workforce OS — AI Organization Framework v1.0**
5. **AI Workforce OS — AI Memory Architecture v1.0**
6. **AI Workforce OS — Prompt Engineering Standard v1.0**
7. **AI Workforce OS — Execution Engine v1.0**
8. **AI Workforce OS — UI/UX Bible v1.0**
9. **AI Workforce OS — Data Model & Event Catalog v1.0**
10. **AI Workforce OS — AI Workforce Constitution v1.0**
11. **AI Workforce OS — Developer Bible v1.0**

Todos esses documentos são referências imutáveis. Mudanças requerem ADR e aprovação do Engineering Governance Committee.

---

## 2. Decisão de Projeto Separado da Smarter

**Decisão:** O AI Workforce OS é uma plataforma independente, construída como produto próprio.

**Justificativa:** A Smarter é o primeiro cliente e caso de validação, mas o Core não pode ser acoplado a ela.

**Consequências:**
- GitHub Organization, Vercel Team e Supabase Project próprios
- Nenhum código do Core depende de código ou schema da Smarter
- A Smarter acessa o AI Workforce OS via API e Workforce Pack

---

## 3. Infraestrutura Registrada

### GitHub
- **Organization:** AIWorkforceOS (https://github.com/AIWorkforceOS)
- **Repositório:** ai-workforce-os (privado)
- **Nota:** Nomes "AI-Workforce-OS" e "AI-Workforce" estavam indisponíveis

### Vercel
- **Team:** AI Workforce OS (pendente)
- **Projeto:** ai-workforce-os

### Supabase
- **Projeto Dev:** AI Workforce OS Dev (pendente)
- **Região:** US East
- **Ambientes futuros:** Dev / Staging / Production

---

## 4. Regra Fundamental: Smarter é um Workforce Pack

A Smarter é o primeiro Workforce Pack — não parte do Core.

- Código Smarter vive em `packs/smarter/`
- O Core não importa nada de `packs/smarter/`
- A Smarter acessa o Core via interfaces públicas
- Futuros packs (Sales, HR, Finance) seguem a mesma regra

---

## 5. Proibição de Acoplamento com a Smarter

Fica proibido criar qualquer funcionalidade no Core que assuma estrutura de franquias, dependa de terminologia da Smarter, ou referencie tabelas/APIs da Smarter.

---

## 6. ADR Obrigatório para Mudanças Arquiteturais

Toda mudança arquitetural requer ADR aprovado. Template na Developer Bible v1.0, Seção 16.1.

Mudanças que exigem ADR:
- Novo módulo no Core
- Nova dependência de package
- Mudança de banco de dados ou event bus
- Breaking change em API ou evento público

---

## 7. Estrutura do Monorepo

```
ai-workforce-os/
├── apps/         # Aplicações deployáveis
├── packages/     # Pacotes compartilhados
├── packs/        # Workforce Packs
├── infra/        # Infraestrutura como código
├── tools/        # Ferramentas de desenvolvimento
└── docs/         # Documentação
```

---

*Documento imutável após aprovação. Mudanças requerem novo ADR.*
