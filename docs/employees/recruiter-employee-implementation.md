# Recruiter Employee — Status de Implementação (V1)

**Data:** 2026-07-13
**Spec de referência:** [`recruiter-employee-spec.md`](./recruiter-employee-spec.md)
**Status:** V1 implementado ponta a ponta — pronto para teste real após aplicar a migration e configurar o agente.

---

## O que foi implementado

| Camada | Arquivos |
|---|---|
| Schema + RLS + pgvector | `supabase/migrations/20260713000008_recruiter_employee.sql` (7 tabelas + RPC `match_candidates_for_job`) |
| Motores | `apps/web/src/lib/recruiter/` — `intake-engine`, `sourcing-engine`, `scoring-engine`, `screening-engine`, `reporting`, `orchestrator`, `messaging`, `guardrails`, `log`, `smarter-api`, `job-boards`, `prompts`, `types`, `ui` |
| Rotas | `POST/GET /api/jobs`, `GET/PATCH /api/jobs/[id]`, `GET /api/jobs/[id]/shortlist`, `GET /api/cron/recruiter` |
| Webhook | `/api/webhooks/whatsapp` agora roteia em cascata (candidato → empresa-com-vaga → SDR, §7.0 da spec) |
| Dashboard | `/dashboard/recruiter` (KPIs, alertas, tabela), `/dashboard/recruiter/jobs/[id]` (pipeline, decision log, ações humanas), `.../shortlist` (apresentação); botão **"Abrir vaga"** em leads `won` no CRM; config do agente em Unidades → Agente |
| Cron | `vercel.json` → `/api/cron/recruiter` diário às 12:00 UTC (09:00 BRT) |
| Testes | `supabase/tests/rls_smoke_test.sql` estendido para vagas/candidatos; smoke test das funções puras (guard-rails, rubrica, briefing) executado em dev |

**Fluxo coberto (o cenário-prioridade do produto):**
1. Lead `won` no CRM → "Abrir vaga" → intake conversacional com a empresa via WhatsApp (extractor JSON + confirmação do perfil ideal).
2. Sourcing: sync da base Smarter via API de parceiro → ranking em 3 estágios (filtros SQL → pgvector → rubrica LLM com justificativa por dimensão).
3. Insuficiente (< 8 qualificados)? → briefing de busca externa para humano (ver limitação abaixo).
4. Outreach personalizado por candidato (WhatsApp, fallback e-mail), em lotes, com reforço em 72h.
5. Triagem conversacional com checklist estruturado (interesse, disponibilidade, expectativa de bolsa, início, matrícula) → nota 0–100 + relatório com pontos fortes/fracos honestos.
6. Shortlist de até 5 (nunca inflada) → apresentação por WhatsApp + e-mail + página autenticada → follow-ups +2/+5/+9 → escolha → devolutiva individual a todos → dossiê de handoff por e-mail → `handed_off`.

Toda decisão autônoma vai para `recruiter_decisions` (com raciocínio legível) e todo passo do processo para `recruiter_events` — ambos visíveis na página da vaga.

---

## 100% automático vs. precisa de humano

### Automático (sem intervenção)
- Intake com a empresa, extração e síntese do perfil, pedido de confirmação.
- Sync Smarter (se env configurada), embeddings, ranking, criação do pipeline.
- Outreach, reforço 72h, marcação de inalcançável, chamada do próximo do ranking.
- Triagem, nota, relatório, montagem e apresentação da shortlist.
- Follow-ups à empresa (3, com ângulos diferentes) e lembretes de intake (2).
- Devolutivas de não selecionados, opt-out LGPD imediato, dossiê de handoff.
- Vencimento de deadline (`expired`), detecção de vaga parada (`stalled`), escalações.

### Precisa de humano (por desenho ou por limitação externa)
| Ponto | Motivo | Como funciona |
|---|---|---|
| **Busca externa (Indeed/InfoJobs)** | **Limitação real verificada (2026-07-13): nenhum dos dois oferece API pública de busca de currículos.** Indeed Smart Sourcing é produto pago restrito a parceiros; InfoJobs BR não tem API pública. Scraping violaria os ToS e está proibido. | Quando o sourcing interno fica abaixo da meta, o agente **gera e envia por e-mail um briefing de busca** (strings booleanas prontas, filtros, o que validar). O humano roda a busca nos portais e cadastra os currículos na base (`candidates`, source `manual`); o agente assume dali (contato → triagem → ranking). Interface `JobBoardProvider` pronta para plugar API oficial no V2 se houver parceria comercial. |
| Confirmar candidato escolhido | Regra da spec: aprovação nunca é inferida | Empresa confirma explicitamente na conversa OU humano clica "Marcar como escolhido" no dashboard |
| Contrato/documentação | Fora do escopo do agente (proibição §15.1) | E-mail de handoff com dossiê completo |
| Negociação de bolsa/salário | Proibição §15.2 | Agente registra a expectativa no relatório e informa a empresa; nunca negocia |
| Reabrir vaga expirada / devolver escalada | Regra da spec | Botão "Devolver ao Recruiter" na página da vaga |
| Faturamento | `financial_records` nunca é tocado pelo agente | Ação humana no painel |

---

## Passos manuais para colocar em produção (checklist)

1. **Aplicar a migration** `20260713000008_recruiter_employee.sql` no SQL Editor do Supabase
   (requer pgvector — `create extension vector` está na própria migration; no Supabase é só rodar).
2. **Rodar** `supabase/tests/rls_smoke_test.sql` no SQL Editor e conferir os dois `OK:` no output.
3. **Configurar envs no Vercel** (novas, opcionais mas recomendadas):
   - `SMARTER_CANDIDATES_API_URL` + `SMARTER_CANDIDATES_API_TOKEN` — API de parceiro da Smarter
     (sem elas o sourcing usa só a base própria e avisa em `system_events`). **Nunca** conexão
     direta ao banco do Sistema Smarter — o contrato é `GET ?course=&city=&updated_since=&limit=`
     com Bearer token, retornando candidatos com `consent_status`.
   - `NEXT_PUBLIC_APP_URL` — usada nos links da shortlist (já usada na tela de Settings).
   - `RECRUITER_RANKING_MODEL` (opcional, default `gpt-4o`) — modelo do ranking/avaliação.
4. **Ativar o agente**: Unidades → [unidade] → Agente → seção "Recrutador IA" (persona, tom,
   horário, limite diário — compartilhado com o SDR) → marcar ativo.
5. **Redeploy** para o Vercel Cron registrar `/api/cron/recruiter`.

## Observações de arquitetura

- `agent_configs.escalation_rules` aceita as chaves novas (por convenção, sem migration):
  `company_followup_max` (3), `candidate_attempts_max` (2), `screening_score_cutoff` (60),
  `sourcing_qualified_target` (8), `match_score_qualified` (65), `outreach_batch_size` (8).
- Guard-rails em **código**, não em prompt: horário ativo, limite diário compartilhado,
  opt-out/consent LGPD, filtro determinístico de promessa de contratação (regex, testado),
  máximos de tentativa. Atributos protegidos nem entram no contexto do ranking (candidatos
  anonimizados como C1..Cn, sem nome/telefone/e-mail no prompt).
- DISC do currículo Smarter é persistido (`candidates.disc_profile`) e entra na dimensão
  comportamental da rubrica (peso 10).
- O cron é o loop de reconciliação: qualquer passo inline que falhe (sourcing no webhook,
  intake no POST /api/jobs) é reprocessado no dia seguinte. Caps por execução mantêm o
  tempo de função dentro do limite da Vercel.
- Colisão de numeração evitada: a migration do Recruiter é a `...000008` (o Traffic
  Specialist ocupa a numeração anterior).
