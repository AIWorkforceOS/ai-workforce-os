# Recruiter Employee — Especificação Oficial de Produto

**Plataforma:** Alizo AI Workforce OS
**Tipo:** Digital Employee (`agent_type = 'recruiter'`)
**Status:** Especificação aprovada para desenvolvimento — nenhum código implementado ainda
**Versão do documento:** 1.1 (revisada 2026-07-08)
**Autor:** Arquitetura Alizo

> **Nota de revisão (2026-07-08):** todas as referências técnicas deste documento foram
> conferidas contra o código real do repositório — helpers de RLS (`is_super_admin`,
> `is_org_admin`, `is_org_member`, `can_access_unit`, `current_org_id` na migration
> `20260707000005`), módulos de integração (`lib/evolution.ts`, `lib/openai.ts`,
> `lib/email.ts`, `lib/system-events.ts`), funções do motor SDR
> (`processInboundMessage`, `countSentToday`, `findEscalationReason`, `isWithinActiveHours`
> em `conversation-engine.ts`), colunas de `agent_configs`, o cron `/api/cron/follow-up`
> protegido por `CRON_SECRET` e o teste `supabase/tests/rls_smoke_test.sql`. A spec se
> apoia nessas convenções reais, não em suposições genéricas.

---

## Índice

1. [Visão geral e posicionamento](#1-visão-geral-e-posicionamento)
2. [Princípios de design](#2-princípios-de-design)
3. [Arquitetura funcional](#3-arquitetura-funcional)
4. [Máquina de estados](#4-máquina-de-estados)
5. [Eventos](#5-eventos)
6. [Banco de dados](#6-banco-de-dados)
7. [Fluxos detalhados](#7-fluxos-detalhados)
8. [Motor de IA](#8-motor-de-ia)
9. [Prompts internos](#9-prompts-internos)
10. [Memória](#10-memória)
11. [Ferramentas do agente](#11-ferramentas-do-agente)
12. [Integrações e APIs](#12-integrações-e-apis)
13. [Dashboard](#13-dashboard)
14. [KPIs](#14-kpis)
15. [Regras de negócio e limites](#15-regras-de-negócio-e-limites)
16. [Casos de exceção](#16-casos-de-exceção)
17. [Escalonamento para humanos](#17-escalonamento-para-humanos)
18. [LGPD e conformidade](#18-lgpd-e-conformidade)
19. [Roadmap V1 / V2 / V3](#19-roadmap-v1--v2--v3)

---

## 1. Visão geral e posicionamento

O **Recruiter Employee** é o segundo funcionário digital da plataforma Alizo. Ele assume o
processo no exato ponto em que o primeiro — o **Sales Employee** (agente SDR já em produção:
`agent_type = 'sdr'`, motor em `apps/web/src/lib/conversation-engine.ts`) — termina o dele:

```
Sales Employee                          Recruiter Employee                     Humano
──────────────────                      ─────────────────────                  ──────────────
prospecta empresas (Google Maps)        recebe a vaga                          recebe o processo
qualifica via WhatsApp                  levanta o perfil com a empresa         formaliza contrato
lead vira 'won' + vaga aberta   ──────► busca, ranqueia e tria candidatos ───► assina documentos
                                        entrega shortlist de 5
                                        acompanha até a escolha
```

Ele **não é um chatbot** nem um fluxo linear. É um processo autônomo de longa duração
(dias/semanas por vaga), com estado persistente, memória, decisões registradas, KPIs e
autonomia delimitada — operando sobre a mesma infraestrutura multi-tenant do OS
(RLS por `org_id`/`unit_id`, migrations 4 e 5).

**O que ele entrega:** para cada vaga, uma shortlist de 5 candidatos triados, com relatório
individual e apresentação profissional, mais o acompanhamento até a empresa escolher.
**O que ele nunca faz:** contratar, assinar, alterar salário, prometer contratação, mentir.

---

## 2. Princípios de design

1. **Mesma espinha dorsal do SDR.** Persona, tom, horário ativo, limite diário e regras de
   escalação vivem em `agent_configs` (novo `agent_type = 'recruiter'`). WhatsApp via
   Evolution API com config por unidade (`getEvolutionConfig`), e-mail via Resend, LLM via
   OpenAI — exatamente os módulos `lib/evolution.ts`, `lib/email.ts`, `lib/openai.ts` que o
   SDR já usa. Nada de stack paralela.

2. **Falha nunca é silenciosa.** Toda falha de integração, config ausente ou exceção vai para
   `system_events` (fonte: `lib/system-events.ts`), com alerta por e-mail anti-spam de 6h —
   o mesmo mecanismo endurecido no SDR. Novos valores de `source`: `'recruiter'`,
   `'job_board'` (portais externos).

3. **Toda decisão é auditável.** O requisito "sempre registrar todas as decisões" vira uma
   tabela dedicada (`recruiter_decisions`): cada decisão autônoma (contatar, pular, buscar
   fora, parar, escalar) grava o *quê*, o *porquê* (raciocínio da IA) e o *contexto*.

4. **Isolamento do Sistema Smarter é inegociável.** O "banco interno da Smarter" citado no
   cenário **não** será acessado tocando o banco/código do Sistema Smarter. A Smarter é
   tratada como *fornecedora externa de dados*: expõe uma API autorizada (ou export
   periódico autorizado) e o Recruiter consome essa API e **materializa os candidatos na
   tabela `candidates` deste banco**, com consentimento LGPD rastreado. Este repositório
   nunca lê tabelas do Smarter diretamente (regra de isolamento do CLAUDE.md).

5. **Event-driven com loop de reconciliação.** Transições reagem a eventos (webhook de
   mensagem, vaga criada), mas um cron diário (`/api/cron/recruiter`, mesmo padrão de
   `/api/cron/follow-up` com `CRON_SECRET`) varre processos parados e destrava o que os
   eventos não cobriram — é isso que dá a sensação de "funcionário que trabalha todo dia".

6. **Multi-tenant desde a primeira linha.** Todas as tabelas novas têm `org_id`/`unit_id` e
   políticas RLS usando os helpers existentes (`is_org_member()`, `can_access_unit()`,
   `is_super_admin()` — migration `20260707000005`).

---

## 3. Arquitetura funcional

```
                                   ┌────────────────────────────────────────────┐
                                   │              AI Workforce OS               │
                                   │                                            │
  Sales Employee (SDR)             │  ┌──────────────────────────────────────┐  │
  lead.status = 'won' ───────────────►│         RECRUITER EMPLOYEE           │  │
  + ação "Abrir vaga" no CRM       │  │                                      │  │
                                   │  │  ┌────────────┐   ┌───────────────┐  │  │
  Empresa (WhatsApp/Email) ◄──────────►│ Intake &    │   │ Sourcing      │  │  │
                                   │  │  │ Profiling  │   │ Engine        │  │  │
  Candidatos (WhatsApp/Email) ◄───────►│ Engine      │   │ (interno +    │  │  │
                                   │  │  └────────────┘   │  portais)     │  │  │
                                   │  │  ┌────────────┐   └───────────────┘  │  │
                                   │  │  │ Screening & │   ┌───────────────┐ │  │
                                   │  │  │ Scoring     │   │ Reporting &   │ │  │
                                   │  │  │ Engine      │   │ Presentation  │ │  │
                                   │  │  └────────────┘   └───────────────┘  │  │
                                   │  │  ┌────────────────────────────────┐  │  │
                                   │  │  │ Decision Log + Memory + KPIs   │  │  │
                                   │  │  └────────────────────────────────┘  │  │
                                   │  └──────────────────────────────────────┘  │
                                   │        │              │            │       │
                                   │   Evolution API    OpenAI      Resend      │
                                   │   (WhatsApp)    (chat+embed)   (e-mail)    │
                                   └────────┼──────────────┼────────────┼───────┘
                                            │              │            │
                                   API Smarter (candidatos autorizados) │
                                   APIs Indeed / InfoJobs (V2, oficiais)┘
```

**Módulos (todos em `apps/web/src/lib/recruiter/`):**

| Módulo | Responsabilidade | Análogo existente |
|---|---|---|
| `intake-engine.ts` | Conduz o levantamento de perfil com a empresa via WhatsApp/e-mail; extrai campos estruturados de respostas livres | `conversation-engine.ts` (SDR) |
| `sourcing-engine.ts` | Busca candidatos (interno → externo), deduplica, materializa em `candidates` | `google-places.ts` (prospecção) |
| `scoring-engine.ts` | Ranking em 3 estágios (filtros → embeddings → rubrica LLM) | novo |
| `screening-engine.ts` | Conversa de triagem com candidatos, nota por candidato | `conversation-engine.ts` |
| `reporting.ts` | Relatório por candidato + apresentação da shortlist | novo |
| `orchestrator.ts` | Máquina de estados, decisões autônomas, decision log | novo |

**Pontos de entrada (rotas):**

- `POST /api/webhooks/whatsapp` — já existe; passa a rotear mensagens de candidatos e de
  empresas-com-vaga para o Recruiter (ver §7.0, roteamento por telefone).
- `POST /api/jobs` — criação de vaga (pelo CRM, botão "Abrir vaga" em lead `won`, ou pelo
  Sales Employee automaticamente).
- `GET /api/cron/recruiter` — loop diário de reconciliação (Vercel Cron, `CRON_SECRET`).
- `GET/PATCH /api/jobs/[id]` — leitura/ação humana sobre o processo (pausar, cancelar,
  marcar escolhido).

---

## 4. Máquina de estados

### 4.1 Estados da vaga (`job_openings.status`)

```
                         ┌──────────────────────────────────────────────────┐
                         ▼                                                  │
 draft ──► profiling ──► profile_ready ──► sourcing ──► outreach ──► screening
                │                             │                          │
                │ (empresa some no intake)    │ (sem candidatos)         ▼
                ▼                             ▼                    shortlist_ready
            stalled ◄─────────────────── sourcing_expanded              │
                                                                        ▼
   closed ◄── handed_off ◄── candidate_selected ◄── company_review ◄── presented
     ▲                                                   │
     │                                                   │ (empresa não responde 3x)
     └────────── cancelled / expired ◄───────────────────┘ → escalated_human
```

| Estado | Significado | Quem move |
|---|---|---|
| `draft` | Vaga registrada (pelo Sales Employee ou humano), aguardando início | Sistema |
| `profiling` | Recruiter está entrevistando a empresa para levantar o perfil | Recruiter |
| `profile_ready` | Perfil ideal do candidato gerado e confirmado com a empresa | Recruiter |
| `sourcing` | Busca no banco interno (candidatos materializados da API Smarter + base própria) | Recruiter |
| `sourcing_expanded` | Busca estendida a portais externos (V2) por insuficiência interna | Recruiter (decisão autônoma) |
| `outreach` | Contato ativo com candidatos ranqueados | Recruiter |
| `screening` | Triagem conversacional em andamento | Recruiter |
| `shortlist_ready` | ≥ 5 candidatos triados com nota (ou máximo alcançável, ver exceções) | Recruiter |
| `presented` | Shortlist + relatórios enviados à empresa | Recruiter |
| `company_review` | Aguardando decisão da empresa (com follow-ups, máx. 3) | Recruiter |
| `candidate_selected` | Empresa escolheu; candidatos avisados; CRM atualizado | Recruiter |
| `handed_off` | Processo transferido para humano (documentação/contrato) | Sistema |
| `closed` | Encerrado com sucesso | Humano |
| `stalled` | Sem progresso além do SLA (destravado pelo cron ou escalado) | Cron |
| `escalated_human` | Escalado antes da conclusão (exceções §16) | Recruiter |
| `cancelled` / `expired` | Cancelada pela empresa / prazo de contratação vencido | Humano/Cron |

### 4.2 Estados do candidato no processo (`job_candidates.stage`)

```
sourced ──► ranked ──► contacted ──► in_screening ──► screened ──► shortlisted ──► presented
                          │               │               │                            │
                          ▼               ▼               ▼                            ├─► approved
                      unreachable     withdrew        disqualified                     └─► not_selected
```

Regras de transição relevantes:

- `contacted → unreachable`: 2 tentativas (WhatsApp + fallback e-mail) sem resposta em 72h.
- `in_screening → withdrew`: candidato declara desinteresse (a IA registra o motivo — vira memória).
- `screened → disqualified`: nota abaixo do corte OU incompatibilidade objetiva descoberta
  na triagem (ex.: semestre incompatível com estágio). Motivo sempre em `stage_reason`.
- `presented → approved`: **somente** por ação humana ou confirmação explícita da empresa
  registrada na conversa — a IA nunca infere aprovação.

---

## 5. Eventos

Eventos de domínio são gravados em `recruiter_events` (auditoria de processo, distinta de
`system_events`, que continua sendo só para falhas técnicas/config). Formato espelha
`system_events`: `event_type`, `metadata jsonb`, FKs de contexto.

| Evento | Emitido quando | Efeito |
|---|---|---|
| `job.created` | Lead `won` + ação "Abrir vaga" ou `POST /api/jobs` | Vaga em `draft`; agenda intake |
| `job.profiling_started` | Primeira mensagem de intake enviada à empresa | — |
| `job.profile_completed` | Todos os campos obrigatórios do perfil preenchidos | Dispara sourcing |
| `sourcing.completed` | Busca interna concluída | Se `qualified < 8`, decide expandir |
| `sourcing.expanded` | Busca externa iniciada (V2) | Decision log obrigatório |
| `candidate.contacted` | Outreach enviado (WhatsApp/e-mail) | Inicia janela de 72h |
| `candidate.screened` | Triagem concluída + nota gerada | Recalcula shortlist |
| `shortlist.ready` | 5 triados (ou teto alcançável) | Gera relatórios |
| `shortlist.presented` | Apresentação enviada à empresa | Inicia `company_review` |
| `company.followup_sent` | Follow-up N de 3 enviado | N=3 sem resposta → escala |
| `candidate.selected` | Empresa confirmou escolha | Atualiza CRM, avisa candidatos |
| `job.handed_off` | Transferência para humano | E-mail com dossiê completo |
| `job.escalated` | Qualquer escalação (§17) | E-mail + evento |

Consumo: V1 processa eventos de forma síncrona (mesma request) + cron de reconciliação.
V2 pode migrar para fila (Supabase Realtime/Queues ou QStash) sem mudar o contrato.

---

## 6. Banco de dados

Novas migrations seguindo o padrão do repo (`supabase/migrations/2026MMDDNNNNNN_*.sql`,
`if not exists`, trigger `update_updated_at`, índices, RLS na própria migration).
Requer `create extension if not exists vector;` (pgvector, disponível no Supabase).

### 6.1 `job_openings` — vagas

```sql
create table if not exists job_openings (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,   -- empresa de origem (Sales Employee)
  title text not null,                                    -- ex: "Estágio em Marketing"
  status text not null default 'draft',                   -- máquina de estados §4.1
  profile jsonb not null default '{}',                    -- perfil ideal (ver §6.1.1)
  profile_missing_fields text[] not null default '{}',    -- o que falta perguntar
  target_shortlist_size int not null default 5,
  urgency text not null default 'normal',                 -- low | normal | high
  hiring_deadline date,
  source text not null default 'sales_employee',          -- sales_employee | manual | api
  stalled_since timestamptz,
  follow_up_count int not null default 0,                 -- follow-ups à empresa (máx 3)
  selected_candidate_id uuid,                             -- fk lógica p/ job_candidates
  handed_off_to text,                                     -- e-mail do humano responsável
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

**6.1.1 Estrutura do `profile` (jsonb):** campos exatamente como o levantamento exige —
`course`, `semester_min/max`, `city`, `modality` (presencial/híbrido/remoto), `scholarship`
(bolsa R$), `schedule`, `soft_skills[]`, `hard_skills[]`, `experience`, `tools[]`,
`languages[]`, `competencies[]`, `behavioral_profile`, `start_date`, `urgency_notes`.
Jsonb (e não colunas) porque o conjunto varia por tipo de vaga e o consumidor primário é a
IA de ranking; os filtros duros (curso, cidade, semestre) são extraídos para o estágio 1 do
ranking via expressões jsonb indexáveis.

### 6.2 `candidates` — banco de talentos (por organização)

```sql
create table if not exists candidates (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  source text not null default 'manual',        -- smarter_api | indeed | infojobs | manual | referral
  external_ref text,                            -- id no sistema de origem (dedupe)
  name text not null,
  email text,
  phone text,
  city text,
  state text,
  course text,
  semester int,
  institution text,
  skills jsonb not null default '[]',
  languages jsonb not null default '[]',
  experience_summary text,
  resume_url text,
  profile_embedding vector(1536),               -- OpenAI text-embedding-3-small
  consent_status text not null default 'unknown',  -- granted | revoked | unknown (LGPD §18)
  consent_at timestamptz,
  opted_out boolean not null default false,     -- nunca recontatar
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists candidates_dedupe_idx
  on candidates(org_id, source, external_ref) where external_ref is not null;
```

Candidatos pertencem à **org** (não à unidade): a mesma pessoa pode servir a vagas de
várias unidades da mesma empresa, mas nunca vaza entre orgs (RLS).

### 6.3 `job_candidates` — pipeline candidato×vaga

```sql
create table if not exists job_candidates (
  id uuid primary key default uuid_generate_v4(),
  job_id uuid not null references job_openings(id) on delete cascade,
  candidate_id uuid not null references candidates(id) on delete cascade,
  unit_id uuid not null references units(id) on delete cascade,  -- denormalizado p/ RLS
  stage text not null default 'sourced',        -- máquina de estados §4.2
  stage_reason text,                            -- motivo da última transição (memória!)
  ai_score numeric(5,2),                        -- 0–100, pós-triagem
  match_score numeric(5,2),                     -- 0–100, pré-triagem (ranking)
  rank int,
  score_breakdown jsonb not null default '{}',  -- rubrica detalhada (§8.2)
  report jsonb,                                 -- relatório final (§7.6)
  contacted_at timestamptz,
  screened_at timestamptz,
  presented_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, candidate_id)
);
```

### 6.4 `candidate_messages` — conversas com candidatos

Espelha `conversations` (canal, direção, `template_key`, `external_message_id`, status
`sent|delivered|read|failed`) mas com FK para `candidate_id` + `job_id`. **Não** reutilizamos
`conversations` porque ela é acoplada a `leads` (empresas) e o webhook do WhatsApp precisa
distinguir os dois públicos no roteamento (§7.0). As conversas de *intake com a empresa*
continuam em `conversations` (a empresa É um lead), com `template_key` prefixado
`recruiter_intake_*`.

### 6.5 `recruiter_decisions` — decision log (obrigatório)

```sql
create table if not exists recruiter_decisions (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid references organizations(id) on delete cascade,
  unit_id uuid references units(id) on delete cascade,
  job_id uuid references job_openings(id) on delete cascade,
  candidate_id uuid references candidates(id) on delete set null,
  decision_type text not null,   -- contact_candidate | skip_candidate | expand_sourcing |
                                 -- pause | follow_up | escalate | disqualify | shortlist
  reasoning text not null,       -- justificativa gerada pela IA, legível por humano
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
```

### 6.6 `recruiter_events` — auditoria de processo (§5)

Mesma forma de `system_events` com FKs `job_id`/`candidate_id`.

### 6.7 `company_recruiting_profiles` — memória por empresa (§10)

```sql
create table if not exists company_recruiting_profiles (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references organizations(id) on delete cascade,
  lead_id uuid references leads(id) on delete cascade,   -- a empresa cliente da unidade
  preferences jsonb not null default '{}',   -- aprendizados: perfis que aprova/reprova, tom, SLAs
  rejection_patterns jsonb not null default '[]',
  avg_decision_days numeric(6,1),
  nps_score int,
  updated_at timestamptz not null default now(),
  unique (org_id, lead_id)
);
```

### 6.8 `agent_configs` — extensão

Sem mudança de schema: criar registros com `agent_type = 'recruiter'` (a coluna é `text`).
`escalation_rules` ganha chaves novas por convenção: `{"company_followup_max": 3,
"candidate_attempts_max": 2, "screening_score_cutoff": 60}`.

### 6.9 RLS

Mesma receita da migration `20260707000005`, na própria migration das tabelas novas:

- `job_openings`, `job_candidates`, `candidate_messages`, `recruiter_events`,
  `recruiter_decisions`: `select` com `can_access_unit(unit_id)`; escrita com
  `can_access_unit(unit_id) and is_org_admin()`.
- `candidates`, `company_recruiting_profiles`: `is_org_member(org_id)` / escrita
  `org_id = current_org_id() and is_org_admin()` ou `is_super_admin()`.
- Service role (webhooks, cron, sourcing) ignora RLS, como hoje.

---

## 7. Fluxos detalhados

### 7.0 Roteamento de mensagens inbound (pré-requisito)

`POST /api/webhooks/whatsapp` hoje resolve `unit` pela instância e `lead` pelo telefone.
Passa a rotear em cascata:

1. Telefone bate com `candidates.phone` **e** existe `job_candidates` ativo (`contacted` ou
   `in_screening`) na unidade → **screening-engine** (Recruiter).
2. Telefone bate com `leads.phone` **e** existe `job_openings` em `profiling` ou
   `company_review` para esse lead → **intake-engine / follow-up de empresa** (Recruiter).
3. Caso contrário → fluxo SDR atual (`processInboundMessage`), intocado.

Ambiguidade (mesmo telefone em dois contextos ativos): prioriza o processo com atividade
mais recente e grava `recruiter_decisions(decision_type='route_ambiguous')`.

### 7.1 Recebimento da vaga (handoff Sales → Recruiter)

**Gatilhos (V1 tem os dois):**
- **Manual assistido:** no CRM Pipeline, card de lead em `won` ganha ação **"Abrir vaga"** →
  `POST /api/jobs` com `lead_id`. É o caminho de menor risco.
- **Automático:** quando o SDR detecta na conversa intenção explícita de abrir vaga
  (classificador no `processInboundMessage`), cria `job_openings` em `draft` e notifica o
  responsável ("vaga criada automaticamente — revise").

Ao criar: herda `org_id`/`unit_id`/contato da empresa do lead; evento `job.created`;
o intake começa imediatamente se dentro do horário ativo do `agent_config`, senão fica
agendado para o próximo slot (mesma lógica `isWithinActiveHours` do SDR).

### 7.2 Levantamento de perfil (intake com a empresa)

Conversa via WhatsApp (fallback e-mail) com o contato da empresa. Não é formulário: é uma
entrevista conduzida, 2–3 perguntas por mensagem, na persona do `agent_config`.

- Checklist de campos obrigatórios: curso, semestre, cidade, modalidade, bolsa, horário,
  soft skills, hard skills, experiência, ferramentas, idioma, competências, perfil
  comportamental, data de contratação, urgência.
- Cada resposta passa pelo **extractor** (prompt §9.2) que preenche `profile` e remove
  itens de `profile_missing_fields`. Respostas parciais/ambíguas geram pergunta de
  esclarecimento (máx. 1 re-pergunta por campo; depois marca `"confidence": "low"`).
- Empresa some no meio: 2 lembretes (24h e 72h); depois vaga → `stalled` + evento.
- Ao completar: gera o **perfil ideal** (síntese §9.3), envia resumo à empresa para
  confirmação ("É isso? Algo a ajustar?"). Confirmado → `profile_ready` +
  `job.profile_completed`.

### 7.3 Sourcing interno

1. Se a base local está defasada, sincroniza candidatos da **API autorizada da Smarter**
   (§12.2) para `candidates` (upsert por `external_ref`, respeitando `consent_status`).
2. **Estágio 1 — filtros duros (SQL):** curso compatível, cidade/modalidade, semestre no
   range, `opted_out = false`, `consent_status <> 'revoked'`.
3. **Estágio 2 — similaridade semântica:** embedding do perfil ideal × `profile_embedding`
   dos candidatos (pgvector, top 50).
4. **Estágio 3 — rubrica LLM (§8.2):** os top 50 são pontuados individualmente → `match_score`
   + `score_breakdown`. Cria `job_candidates` em `sourced`, ordenados (`rank`).

Meta interna: **≥ 8 candidatos qualificados** (`match_score ≥ 65`) para mirar 5 na shortlist
com margem para perdas (não respondem, desistem, reprovam na triagem).

### 7.4 Sourcing externo (decisão autônoma — V2)

Se `qualified < 8` após o interno, o Recruiter decide expandir (decision log com o motivo)
e consulta **apenas APIs oficiais/parcerias** (Indeed, InfoJobs — §12.3). Nunca scraping,
nunca coleta não autorizada; primeira mensagem a candidato externo sempre inclui a base
LGPD e opção de opt-out (§18). Resultados entram no mesmo funil de ranking.
Se mesmo assim `qualified < 5`: segue com o que tem e **avisa a empresa com transparência**
(nunca inflar a shortlist com candidato ruim — regra de negócio).

### 7.5 Outreach + triagem

**Outreach (por rank, em lotes de ~8):**
- Preferência WhatsApp; sem telefone → e-mail. Mensagem **gerada por candidato** (prompt
  §9.4) usando nome, curso, vaga, empresa e histórico — nunca template genérico.
- Respeita `daily_limit` e `active_hours` do `agent_config` (mesma mecânica do SDR:
  `countSentToday`).
- Sem resposta em 72h → 1 reforço; depois `unreachable` e o próximo do ranking é chamado
  (decision log automático).

**Triagem (conversacional):** confirma interesse e disponibilidade real; valida os pontos
de menor confiança do ranking; verifica documentação básica declarada (matrícula ativa,
disponibilidade de horário — **declarativo**, sem coletar documentos em V1); responde
dúvidas sobre a vaga usando somente o `profile` (não inventa; o que não sabe, anota e
pergunta à empresa); detecta expectativas (bolsa, início). Ao final, o **avaliador**
(prompt §9.5) gera `ai_score` (0–100) + rubrica. Candidato com pergunta que exige humano
(ex.: negociação de bolsa) → escala (§17).

### 7.6 Relatório e shortlist

Para cada `shortlisted`, o `report` (jsonb) contém: **resumo** (3–4 linhas), **pontos
fortes**, **pontos fracos** (honestos — regra "nunca mentir"), **nota**, **compatibilidade
%**, **risco** (baixo/médio/alto + justificativa: ex. "recebeu outra proposta"),
**disponibilidade**, **expectativa** (bolsa/início).

A **apresentação** é um documento único (página web autenticada `/dashboard/jobs/[id]/shortlist`
+ PDF anexável): capa com vaga e perfil ideal, 1 página por candidato, tabela comparativa,
próximos passos. Enviada à empresa por WhatsApp (link) e e-mail. Estado → `presented`,
depois `company_review`.

### 7.7 Acompanhamento da decisão

- Checagem diária pelo cron. Sem resposta: follow-ups inteligentes nos dias +2, +5, +9 —
  cada um com ângulo diferente (prompt §9.6: reforço de destaque, senso de urgência real
  do candidato, oferta de ajustar a busca). Nunca "só passando para lembrar".
- `follow_up_count = 3` sem resposta → `escalated_human` + e-mail ao responsável.
- Empresa pede mudanças ("quero mais parecido com o candidato 2") → atualiza `profile` +
  `company_recruiting_profiles.preferences`, volta a `sourcing` (novo ciclo encurtado).

### 7.8 Escolha e handoff

Quando a empresa escolhe (na conversa ou no dashboard):
1. `job_candidates.stage = 'approved'` no escolhido; demais → `not_selected`.
2. **Todos** os candidatos triados recebem devolutiva individual e respeitosa (gerada, não
   template) — inclusive os não selecionados. Motivos → memória.
3. CRM: lead/vaga atualizados; `financial_records` **não** é tocado pelo agente (fatura é ação humana).
4. E-mail de handoff ao humano responsável com dossiê completo (perfil, shortlist,
   relatórios, histórico, contatos) — reutiliza o padrão `sendEscalationEmail`.
5. `handed_off` + evento. O Recruiter não participa de contrato/documentos.

---

## 8. Motor de IA

### 8.1 Modelos

| Uso | Modelo | Justificativa |
|---|---|---|
| Conversação (intake, outreach, triagem, follow-up) | `gpt-4o-mini` (mesmo do SDR, via `generateChatReply`) | Já validado no produto; latência/custo |
| Extração estruturada (respostas → `profile`) | `gpt-4o-mini` com JSON mode | Barato, chamado a cada mensagem |
| Ranking (rubrica) e relatórios | modelo mais forte (ex. `gpt-4o`) | Poucos calls/vaga, decisão de alto impacto |
| Embeddings | `text-embedding-3-small` (1536 dims) | Par com `vector(1536)` |

Chaves via env (`OPENAI_API_KEY`), falha → `system_events` + alerta, como hoje.

### 8.2 Como o ranking decide (3 estágios)

1. **Filtros duros (SQL, sem IA):** eliminam o objetivamente incompatível. Barato, explicável,
   nunca deixa a IA "compensar" um requisito eliminatório.
2. **Embeddings (recall):** perfil ideal × candidatos, top 50. Captura compatibilidade
   semântica que palavra-chave não pega (ex.: "Canva e CapCut" ≈ "edição para redes sociais").
3. **Rubrica LLM (precisão):** cada candidato é avaliado contra rubrica fixa com pesos:

   | Dimensão | Peso |
   |---|---|
   | Hard skills / ferramentas | 25 |
   | Curso + semestre + formação | 20 |
   | Experiência relevante | 15 |
   | Localização / modalidade / horário | 15 |
   | Soft skills / perfil comportamental | 10 |
   | Histórico na plataforma (triagens passadas, no-shows) | 10 |
   | Ajuste de expectativa (bolsa, início) | 5 |

   Saída JSON: nota por dimensão + justificativa de 1 linha → `score_breakdown`. A soma
   ponderada é o `match_score`. Justificativas aparecem no dashboard — o ranking é
   **sempre explicável**.

**Vieses e conformidade:** a rubrica proíbe expressamente usar gênero, raça, idade, religião,
aparência ou qualquer atributo protegido; esses dados nem são incluídos no contexto de
avaliação. Pedido discriminatório da empresa → recusa educada + escalação (§16).

### 8.3 Como aprende e melhora

Loop de feedback usando dados que o processo já gera:

- **Feedback da empresa** (aprovou/reprovou + motivo) → `company_recruiting_profiles.preferences`
  e `rejection_patterns`. Nas próximas vagas da mesma empresa, o prompt de ranking recebe:
  *"Esta empresa historicamente valoriza X e reprova por Y."*
- **Outcome dos candidatos** (contratado, desistiu, no-show) → penalidades/bônus no fator
  "histórico" da rubrica.
- **Calibração global (V2):** correlação `match_score` × aprovação real por org; ajuste dos
  pesos da rubrica por segmento. Sem fine-tuning em V1/V2 — aprendizado é via memória
  estruturada injetada em prompt, que é auditável e reversível.

### 8.4 Como conversa

Mesma fundação do SDR: persona/tom do `agent_config`, PT-BR, mensagens curtas (máx. 3
frases no WhatsApp), sem markdown, uma pergunta principal por vez, sempre com contexto da
conversa anterior (histórico de `candidate_messages`/`conversations`). Diferenças por
público: com **empresa**, postura consultiva de recrutador sênior; com **candidato**,
acolhedora e transparente (deixa claro que é assistente digital da unidade **na primeira
mensagem** — nunca finge ser humano).

### 8.5 Como prioriza (agenda diária do cron)

Ordem de prioridade do loop diário, por item de trabalho pendente:

1. Mensagens inbound não respondidas (SLA interno: nunca > 4h úteis).
2. Vagas `high` urgency ou `hiring_deadline` < 7 dias.
3. Triagens em andamento (não deixar candidato esfriar).
4. Follow-ups vencidos (empresa e candidato).
5. Sourcing de vagas recém-`profile_ready`.
6. Manutenção de memória (consolidar aprendizados da semana).

Empates: vaga mais antiga primeiro. Tudo dentro de `active_hours` e `daily_limit`.

---

## 9. Prompts internos

Persona-base compartilhada (análoga ao `buildSystemPrompt` do SDR), parametrizada por
`agent_config` + unidade. Rascunhos funcionais (a lapidar em dev):

**9.1 Sistema-base (todas as conversas)**
> Você é {persona_name}, recrutador(a) digital da unidade {unit.name} ({unit.region_city}).
> Tom {persona_tone}. Responda sempre em português do Brasil, mensagens curtas (máx. 3
> frases), sem markdown. Você nunca promete contratação, nunca negocia salário/bolsa,
> nunca inventa informação sobre a vaga ou sobre candidatos. O que não souber, diga que
> vai confirmar e retome depois. Você se apresenta como assistente digital na primeira
> interação com qualquer pessoa.

**9.2 Extractor de perfil (JSON mode, a cada resposta da empresa)**
> Dada a conversa abaixo e o JSON parcial do perfil da vaga, extraia apenas os campos
> respondidos nesta última mensagem. Schema: {schema do §6.1.1}. Não invente valores;
> use null para o que não foi dito. Marque "confidence": "low" quando a resposta for
> ambígua. Responda somente JSON.

**9.3 Sintetizador do perfil ideal**
> Com base no perfil coletado, escreva o "perfil ideal do candidato" em: (1) resumo de 3
> linhas para a empresa confirmar; (2) lista de requisitos eliminatórios; (3) lista de
> diferenciais com pesos sugeridos. Seja específico e fiel ao que a empresa disse.

**9.4 Outreach personalizado (por candidato)**
> Escreva a primeira mensagem de WhatsApp para {candidate.name}, estudante de
> {candidate.course} ({candidate.institution}, {semester}º semestre), sobre a vaga
> {job.title} na empresa {company} em {city}. Conecte a vaga com o perfil dele
> ({skills/experiência relevantes}). Apresente-se como assistente digital. Termine com
> uma pergunta de interesse simples. Proibido: parecer mala direta, usar jargão de RH,
> mencionar outros candidatos, prometer vaga.

**9.5 Avaliador de triagem (JSON mode, ao fim da conversa)**
> Dada a rubrica {rubrica §8.2 com pesos}, o perfil ideal da vaga e a transcrição da
> triagem, pontue o candidato por dimensão (0–100) com justificativa de 1 linha cada.
> Aponte: pontos fortes (3), pontos fracos (2, honestos), risco (baixo/médio/alto +
> motivo), disponibilidade declarada, expectativas declaradas. Proibido considerar ou
> mencionar atributos protegidos (gênero, raça, idade, religião, aparência). Responda
> somente JSON no schema {report §7.6}.

**9.6 Follow-up à empresa (variação por tentativa)**
> Tentativa {n}/3. Escreva um follow-up curto e natural para {contact} sobre a shortlist
> da vaga {job.title}, enviada em {date}. Ângulo desta tentativa: {n=1: destacar o
> candidato mais forte com um fato concreto; n=2: mencionar disponibilidade real dos
> candidatos que pode mudar; n=3: oferecer ajustar a busca se o perfil não agradou}.
> Nunca soe como cobrança automática nem repita follow-ups anteriores: {histórico}.

**9.7 Devolutiva a candidato não selecionado**
> Escreva uma devolutiva breve, humana e respeitosa para {candidate.name} sobre a vaga
> {job.title}: agradeça o tempo, informe que a empresa seguiu com outro perfil nesta vaga,
> reforce 1 ponto forte real dele e diga que ele continua no banco para próximas
> oportunidades (se consent permitir). Não invente motivo da não-seleção.

---

## 10. Memória

Três camadas, todas em Postgres (consultáveis, auditáveis, escopadas por RLS):

| Camada | Onde vive | O que lembra | Como é usada |
|---|---|---|---|
| **Processual** (curto prazo) | `job_openings.profile`, `job_candidates`, `candidate_messages`, `conversations` | Estado exato de cada vaga e conversa | Contexto direto de cada chamada LLM (janela: últimas 20 mensagens, como o SDR) |
| **Relacional** (médio prazo) | `company_recruiting_profiles`, `candidates` (histórico, `stage_reason`) | Preferências da empresa, motivos de reprovação, feedbacks, comportamento do candidato (respondeu rápido? sumiu?) | Injetada nos prompts de ranking/outreach ("esta empresa reprova por X"; "este candidato foi shortlist 2x") |
| **Analítica** (longo prazo) | `recruiter_events` + `recruiter_decisions` agregados (views/materialized views de KPI) | Tempo médio por etapa, taxa de conversão do funil, calibração score×outcome | Alimenta dashboard, SLAs do cron e recalibração da rubrica (V2) |

Retenção: mensagens e decisões seguem a política LGPD (§18). Nada de memória em arquivos
soltos ou contexto implícito do modelo — se não está no banco, o Recruiter não "lembra".

---

## 11. Ferramentas do agente

Contrato interno de tools do orquestrador (V1 as executa como funções TypeScript; o desenho
já fica pronto para migrar a um loop de tool-use):

| Tool | Assinatura | Efeito colateral |
|---|---|---|
| `send_whatsapp(candidate_or_lead, text)` | via `sendWhatsAppMessage` | grava mensagem; falha → `status='failed'` + `system_events` |
| `send_email(to, template, data)` | via `lib/email.ts` | idem |
| `search_internal_candidates(profile)` | filtros + pgvector | — |
| `sync_smarter_candidates(filters)` | API Smarter → upsert `candidates` | decision log |
| `search_external(portal, profile)` | APIs oficiais (V2) | decision log |
| `score_candidates(job_id, candidate_ids[])` | rubrica LLM | `score_breakdown` |
| `update_stage(job_candidate_id, stage, reason)` | transição validada pela máquina de estados | evento + decision log |
| `generate_report(job_candidate_id)` | relatório §7.6 | `report` |
| `escalate(job_id, reason, context)` | e-mail + estado | `escalated_human` |
| `log_decision(type, reasoning, meta)` | insert `recruiter_decisions` | — |

Regra dura: **toda tool com efeito externo (mensagem, e-mail) passa pelos guard-rails**
(`active_hours`, `daily_limit`, `opted_out`, limites de tentativa) **antes** de executar —
no código, não no prompt.

---

## 12. Integrações e APIs

### 12.1 Já existentes (reuso direto)
- **Evolution API** (WhatsApp) — config por unidade, webhook único com roteamento §7.0.
- **OpenAI** — chat + embeddings.
- **Resend** — outreach por e-mail, handoff, alertas técnicos.
- **Vercel Cron** — `/api/cron/recruiter` diário (além do `/api/cron/follow-up` do SDR).

### 12.2 Banco de candidatos da Smarter (nova — com fronteira explícita)
- **Nunca** acesso direto ao banco/código do Sistema Smarter a partir deste repo.
- O Sistema Smarter (time deles) expõe endpoint autorizado, ex.
  `GET /api/partners/candidates?course=&city=&updated_since=`, autenticado por token de
  parceiro (`SMARTER_CANDIDATES_API_URL` + `SMARTER_CANDIDATES_API_TOKEN` — envs novas,
  graciosamente degradáveis: ausentes → sourcing usa só a base própria + `system_events`
  warning).
- Sincronização: sob demanda no sourcing + refresh noturno incremental no cron. Upsert em
  `candidates` com `source='smarter_api'`, `external_ref`, e `consent_status` **vindo da
  origem** (a Smarter só expõe candidatos com consentimento de compartilhamento).

### 12.3 Portais externos (V2)
- **Indeed / InfoJobs apenas via APIs oficiais ou parceria formal** (o acesso a bancos de
  currículos desses portais é restrito a parceiros — a viabilidade comercial é pré-requisito
  do V2, não um detalhe). Sem scraping, sem automação de contas, sem burlar termos de uso.
- Abstração `JobBoardProvider` (interface única: `searchCandidates(profile)`) para plugar
  novos portais sem tocar no funil.

### 12.4 Rotas internas novas

| Rota | Método | Auth | Função |
|---|---|---|---|
| `/api/jobs` | POST | sessão (RLS) | criar vaga |
| `/api/jobs/[id]` | GET/PATCH | sessão (RLS) | detalhe / ações humanas (pausar, cancelar, marcar escolhido) |
| `/api/jobs/[id]/shortlist` | GET | sessão (RLS) | apresentação da shortlist |
| `/api/cron/recruiter` | GET | `CRON_SECRET` | loop diário |
| `/api/webhooks/whatsapp` | POST | service role | (existente) + roteamento §7.0 |

---

## 13. Dashboard

Nova área `/dashboard/recruiter` (+ item "Recrutador IA" no grupo *Operações* da sidebar,
respeitando roles como hoje: cliente vê só a própria org via RLS).

### 13.1 Cards KPI (linha superior, padrão visual dos cards do dashboard atual)
1. **Vagas abertas** (por status, com deadline mais próximo)
2. **Candidatos em triagem** agora
3. **Shortlists aguardando empresa** (com dias de espera — amarelo > 3d, vermelho > 7d)
4. **Tempo médio até shortlist** (últimos 30d vs. 30d anteriores, com seta de tendência)
5. **Taxa de aprovação da shortlist** (vagas em que a empresa escolheu alguém dos 5)
6. **Contratações no mês** (handoffs concluídos)

### 13.2 Gráficos
- **Funil da vaga** (barras horizontais): sourced → contacted → screened → shortlisted →
  presented → approved, com % de conversão entre etapas.
- **Tempo por etapa** (barras empilhadas por vaga): onde o processo emperra.
- **Linha temporal**: vagas abertas × preenchidas por semana.
- **Distribuição de `match_score`** dos shortlisted (qualidade do sourcing ao longo do tempo).

### 13.3 Alertas (mesma linguagem do card "Saúde das integrações")
- Vaga `stalled` (sem progresso > SLA da etapa)
- Empresa sem responder shortlist há N dias (follow-up X/3)
- Sourcing insuficiente (< 8 qualificados) — sugere ação humana
- Candidato escolhido aguardando handoff humano
- Falhas técnicas do Recruiter (via `system_events`, `source='recruiter'`)
- Deadline de contratação < 7 dias com vaga não preenchida

### 13.4 Tabela de vagas + drill-down
Colunas: vaga, empresa, unidade, status (badge), candidatos por etapa (mini-funil), dias
em aberto, urgência, deadline, responsável humano. Clique → página da vaga: perfil ideal,
pipeline kanban de candidatos (mesmo padrão do CRM Pipeline atual), transcrições, relatórios,
**decision log completo** ("por que a IA fez X") e botões de ação humana (pausar, escalar,
marcar escolhido, editar perfil).

### 13.5 Filtros
Unidade, status da vaga, urgência, período, curso, cidade, "somente com alertas".

---

## 14. KPIs

| KPI | Definição operacional | Fonte |
|---|---|---|
| Tempo médio de contratação | `job.created` → `candidate_selected` | `recruiter_events` |
| Tempo até shortlist | `job.created` → `shortlist.presented` | idem |
| Tempo de resposta do agente | inbound → outbound correspondente (mediana) | `candidate_messages`/`conversations` |
| Candidatos encontrados/vaga | count `job_candidates` por `job_id` | `job_candidates` |
| Triagens concluídas | stage ≥ `screened` | idem |
| Taxa de aprovação da shortlist | vagas com `approved` ÷ vagas `presented` | idem |
| Qualidade dos candidatos | média `ai_score` dos shortlisted; correlação score×aprovação | idem |
| Taxa de resposta de candidatos | responded ÷ contacted | `candidate_messages` |
| NPS empresas / NPS candidatos | pesquisa 1 pergunta pós-handoff / pós-devolutiva (V2) | `company_recruiting_profiles` + tabela NPS |

Metas iniciais V1 (a calibrar com dados reais): shortlist em ≤ 7 dias corridos; resposta
do agente ≤ 4h úteis; ≥ 60% das shortlists com candidato aprovado.

---

## 15. Regras de negócio e limites

**Proibições absolutas (enforçadas em código, não só em prompt):**
1. Nunca contratar, assinar ou gerar documento contratual.
2. Nunca alterar/negociar salário ou bolsa — pergunta sobre isso → escala.
3. Nunca prometer contratação a candidato (o avaliador de saída bloqueia frases de promessa
   antes do envio — filtro determinístico por regex + verificação LLM).
4. Nunca mentir: pontos fracos aparecem no relatório; shortlist curta é comunicada como curta.
5. Nunca contatar candidato com `opted_out = true` ou `consent_status = 'revoked'`.
6. Nunca usar atributos protegidos em ranking/triagem (§8.2).
7. Toda decisão autônoma → `recruiter_decisions` (sem exceção).

**Limites operacionais (config por unidade em `agent_configs`):**
- Máx. 3 follow-ups à empresa; máx. 2 tentativas por candidato.
- `daily_limit` de mensagens compartilhado com o guard-rail do SDR por unidade.
- Só conversa dentro de `active_hours`.
- Shortlist alvo 5; nunca apresenta candidato com `ai_score` abaixo do corte para "completar número".

---

## 16. Casos de exceção

| # | Situação | Comportamento |
|---|---|---|
| 1 | Empresa some durante o intake | 2 lembretes (24h/72h) → `stalled` → alerta no dashboard; cron re-tenta 1x após 7d; depois `expired` |
| 2 | Sourcing < 5 qualificados (interno+externo) | Apresenta N < 5 com transparência + oferece ajustar perfil; decision log |
| 3 | Todos os contatados recusam | Volta a `sourcing` com aprendizado (motivos de recusa → ajuste de expectativa, ex. bolsa baixa) e alerta a empresa sobre o padrão detectado |
| 4 | Candidato pede negociação (bolsa, horário) | Não negocia; registra a expectativa no relatório; se bloqueante, informa a empresa |
| 5 | Empresa faz exigência discriminatória | Recusa educada e firme na conversa + `escalate(reason='discriminatory_request')` imediato; nunca aplica o critério |
| 6 | WhatsApp (Evolution) cai no meio da triagem | `candidate_messages.status='failed'` + `system_events` + fallback e-mail automático quando o candidato tem e-mail |
| 7 | `OPENAI_API_KEY`/env ausente | Processo pausa naquele passo, `system_events` error + alerta (mesmo padrão do SDR endurecido) — nunca falha silenciosa |
| 8 | Candidato duplicado (interno × externo) | Dedupe por telefone/e-mail normalizado + `external_ref`; mantém o registro mais rico, funde histórico |
| 9 | Mesma pessoa em 2 vagas simultâneas | Permitido, com transparência ao candidato; se aprovado em uma, o Recruiter atualiza a outra (`withdrew`, motivo registrado) |
| 10 | Empresa cancela a vaga no meio | `cancelled`; candidatos em processo recebem devolutiva imediata e honesta |
| 11 | Vaga com deadline vencido | Cron marca `expired`, alerta humano; só humano reabre |
| 12 | Mensagem inbound ambígua (candidato é também lead) | Roteamento §7.0 + decision log `route_ambiguous` |

---

## 17. Escalonamento para humanos

**Gatilhos automáticos:**
- Empresa escolheu candidato → handoff (fluxo feliz, §7.8).
- 3 follow-ups sem resposta da empresa.
- Pedido de negociação salarial/contratual (empresa ou candidato).
- Exigência discriminatória ou pedido antiético.
- Keywords de escalação do `agent_config` (mesma mecânica `findEscalationReason` do SDR:
  "contrato", "jurídico", "quero falar com humano"...).
- Reclamação explícita ou sinal de insatisfação forte (empresa ou candidato).
- Loop sem progresso: 2 ciclos de sourcing sem shortlist viável.

**Mecânica:** e-mail via Resend ao `owner_email` da org (e ao responsável Alizo quando for
falha de processo), com link direto para a página da vaga; estado `escalated_human`; card
vermelho no dashboard; janela anti-spam de 6h por tipo (reuso de `shouldNotifyForEvent`).
**Retomada:** humano resolve e clica "Devolver ao Recruiter" (PATCH) — o agente retoma do
estado anterior com o contexto novo registrado.

---

## 18. LGPD e conformidade

Recrutamento é tratamento de dado pessoal de terceiros (candidatos) — não é opcional:

- **Base legal e consentimento:** candidatos da API Smarter só entram com consentimento de
  compartilhamento na origem (`consent_status='granted'` + `consent_at`). Candidatos de
  portais (V2): conforme os termos da API do portal; primeira mensagem sempre informa a
  origem do contato e oferece opt-out em linguagem simples.
- **Opt-out imediato:** "não quero receber mensagens" (detectado pela IA) → `opted_out=true`
  na hora, confirmação educada, nunca mais contatado. Auditável.
- **Minimização:** só os campos do §6.2; sem documentos pessoais (RG/CPF) em V1 — isso é
  do humano pós-handoff.
- **Retenção:** candidatos sem interação há 24 meses → anonimização programada (job V2);
  transcrições seguem a mesma régua.
- **Transparência:** o agente sempre se identifica como assistente digital (§8.4).
- **Isolamento multi-tenant:** RLS garante que candidatos e vagas de uma org jamais
  aparecem para outra (mesma garantia já testada no `rls_smoke_test`).

---

## 19. Roadmap V1 / V2 / V3

### V1 — Recruiter funcional ponta a ponta (base interna) — ~4–6 semanas de dev
- Migrations: `job_openings`, `candidates`, `job_candidates`, `candidate_messages`,
  `recruiter_decisions`, `recruiter_events`, `company_recruiting_profiles` + RLS + pgvector.
- Handoff Sales→Recruiter: botão "Abrir vaga" no CRM (lead `won`) + `POST /api/jobs`.
- Intake conversacional com a empresa (WhatsApp/e-mail) + extractor + perfil ideal.
- Sourcing interno: sync da API Smarter (se env configurada) + ranking 3 estágios.
- Outreach + triagem via WhatsApp com fallback e-mail; nota por candidato.
- Relatórios + página de shortlist + envio à empresa.
- Follow-up (máx. 3) + escalação + handoff humano com dossiê.
- Cron `/api/cron/recruiter`; dashboard: cards, funil, tabela de vagas, decision log.
- Guard-rails LGPD (consent, opt-out) e limites §15 em código.
- **Critério de aceite:** 1 vaga real percorre draft→handed_off sem intervenção técnica,
  com todas as decisões visíveis no decision log.

### V2 — Alcance externo + aprendizado — ~6–8 semanas
- `JobBoardProvider` + integrações oficiais (Indeed/InfoJobs — condicionadas a parceria
  comercial aprovada; sem API oficial disponível, portal fica fora).
- Loop de aprendizado: preferências por empresa injetadas no ranking; calibração
  score×outcome; ajuste de pesos por segmento.
- NPS automatizado (empresas e candidatos) pós-processo.
- Fila de eventos (substitui processamento síncrono) + retries.
- Agendamento de entrevista empresa×candidato (link de calendário) — o Recruiter marca,
  humano conduz.
- Anonimização/retenção LGPD automatizada.

### V3 — Recruiter sênior — horizonte
- Entrevista de triagem por voz (telefonia/WhatsApp áudio) com transcrição.
- Multi-idioma (vagas bilíngues).
- Análise de currículo em arquivo (PDF parsing) e enriquecimento automático de perfil.
- Recomendação proativa: "temos 3 candidatos excelentes parados — sugerir vaga à empresa X?"
  (inverte o funil: talento → demanda).
- Marketplace de talentos entre unidades da mesma org (com consentimento).
- Auto-tuning contínuo da rubrica com validação humana amostral.

---

*Documento vivo: mudanças de escopo passam por revisão de arquitetura e atualização deste
arquivo antes de virar código.*
