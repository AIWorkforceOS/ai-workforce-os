# Traffic Specialist — Especialista em Tráfego Pago (Digital Employee)

**Plataforma:** Alizo AI Workforce OS
**Tipo:** Digital Employee (`agent_type = 'traffic_specialist'`)
**Status:** V1 implementada — pipeline completo validado com dados mockados; execução em contas reais aguarda credenciais Meta/Google (ver `docs/setup/traffic-apis-setup.md`)
**Versão do documento:** 1.0 (2026-07-13)

---

## 1. Visão geral

O Traffic Specialist é o funcionário digital de mídia paga do Alizo. Ele conecta as contas
de **Meta Ads** e **Google Ads** do cliente, acompanha todos os indicadores continuamente,
decide mudanças de estratégia com base em performance real e — quando autorizado — executa
essas mudanças direto nas contas (pausar/reativar campanhas, ajustar orçamento), sempre com
justificativa registrada e auditoria completa.

Ele opera como um gestor de tráfego sênior operaria:

| Disciplina | Como o agente cobre |
|---|---|
| Estratégia full-funnel | Classifica cada campanha em awareness/consideração/conversão pelo objetivo; alerta quando 100% da verba está em fundo de funil (`funnel_rebalance`) |
| Alocação de orçamento por ROAS/CPA real | Regras de escala (+% gradual em quem bate o alvo), redução (−% em quem fica abaixo) e pausa (CPA acima do multiplicador do alvo, com volume mínimo de conversões) |
| Fadiga de criativo | Frequência (Meta) acima do limiar + queda de CTR vs período anterior → `refresh_creative`; fadiga severa → `new_audience_suggestion` (lookalikes, expansão) |
| Estratégia de lance | Volume de conversões suficiente em lance manual/lowest-cost → recomenda migrar para lance automático por alvo (cost cap / tCPA / tROAS) |
| Detecção de anomalias | CPM disparando vs período anterior; gasto relevante com zero conversões (pixel quebrado, cliques inválidos ou landing ruim) |
| Pixel / rastreamento | O alerta de "gasto sem conversão" instrui verificação do Meta Pixel/Conversions API e da Google tag/Enhanced Conversions antes de mexer em mídia |
| Landing page | `landing_page_suggestion` quando o tráfego chega mas não converte |
| Sazonalidade | `seasonal_budget_multiplier` na estratégia da conta amplifica as sugestões de aumento em períodos fortes |
| Relatórios executivos | Resumo diário em linguagem de negócio (via OpenAI, com fallback determinístico) em `traffic_reports` |
| Conformidade de plataforma | O agente **nunca** cria anúncios/criativos sozinho (menor superfície de risco de política); mudanças limitam-se a status/orçamento com limites duros |

**O que ele nunca faz:** gastar acima dos tetos configurados, mexer em entidade marcada
`is_managed=false`, executar qualquer coisa em modo sugestão sem aprovação humana, ou fazer
mudança sem registrar rationale + auditoria.

---

## 2. Modos de operação (segurança primeiro)

Cada conta (`ad_accounts.optimization_mode`) opera em um de dois modos:

- **`suggestion` (padrão, obrigatório no início):** o motor gera decisões com justificativa;
  um humano aprova ou rejeita no dashboard. Aprovar uma decisão executável dispara a mudança
  real na plataforma na hora.
- **`autonomous` (opt-in consciente):** decisões executáveis (pausa, orçamento) são aplicadas
  direto pelo cron. Recomendação: ativar só depois de semanas observando a qualidade das
  sugestões em conta real. Decisões advisory (criativo, público, landing, anomalias) nunca
  são "executadas" — são sempre recomendações.

Guard-rails duros em código (não em prompt), validados na proposta E revalidados na execução:
`max_budget_change_pct` (padrão ±20%), `min/max_daily_budget_cents`, volume mínimo de
conversões para decisões de CPA/ROAS, `TRAFFIC_DRY_RUN=1` (registra sem chamar plataforma).

---

## 3. Arquitetura

```
Vercel Cron (diário)                    Dashboard /dashboard/traffic
      │                                       │  aprovar/rejeitar
      ▼                                       ▼
GET /api/cron/traffic ──► lib/traffic/sync.ts ◄── POST /api/traffic/accounts/[id]/sync
                            │
        ┌───────────────────┼──────────────────────┐
        ▼                   ▼                      ▼
  meta-ads.ts         google-ads.ts          mock-data.ts (TRAFFIC_USE_MOCK=1)
  (Graph v25.0)       (REST v24 + GAQL)
        │                   │
        └───────► normalização (PlatformEntity / PlatformMetricsRow)
                            │
                            ▼
              metrics.ts (derivadas, agregação, sinais)
                            │
                            ▼
              strategy-engine.ts (regras → DecisionProposal[])
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
     traffic_decisions            executor.ts (modo autônomo ou aprovação)
     (rationale sempre)                   │
                                          ▼
                          Meta/Google APIs + ad_actions_log (auditoria imutável)
```

Módulos em `apps/web/src/lib/traffic/`: `types.ts`, `meta-ads.ts`, `google-ads.ts`,
`metrics.ts`, `strategy-engine.ts`, `executor.ts`, `sync.ts`, `reporting.ts`, `mock-data.ts`.

---

## 4. Banco de dados (migration `20260713000007_traffic_specialist.sql`)

| Tabela | Papel |
|---|---|
| `ad_accounts` | Contas conectadas por unidade; credenciais por conta; `optimization_mode` + `strategy` (alvos/limites) |
| `ad_entities` | Hierarquia campanha/conjunto/anúncio das duas plataformas, com `is_managed`, funil, orçamento e `raw` |
| `ad_metrics_snapshots` | Métricas diárias por entidade (impressões, cliques, gasto, conversões, valor) + derivadas persistidas (CTR, CPC, CPM, CPA, ROAS) |
| `traffic_decisions` | Decision log: tipo, severidade, rationale, ação recomendada, métricas que a embasaram, modo, status, quem decidiu |
| `ad_actions_log` | Auditoria imutável de toda ação executada: payload enviado, estado anterior, resposta da API, executor |
| `traffic_reports` | Relatórios executivos diários/semanais em linguagem de negócio |

RLS em todas (mesma receita do OS): leitura `can_access_unit(unit_id)`; escrita humana
`+ is_org_admin()`; snapshots/decisões/auditoria/relatórios são escritos pelo service role
(cron); `ad_actions_log` não tem policy de update/delete — log imutável.

`agent_configs`: sem mudança de schema — registro com `agent_type='traffic_specialist'`
e `is_active=true` liga o agente na unidade.

---

## 5. Regras do motor (strategy-engine.ts)

Parâmetros por conta em `ad_accounts.strategy` (defaults em `DEFAULT_STRATEGY`):

| Regra | Gatilho | Decisão | Executável? |
|---|---|---|---|
| Pausa por CPA | `cpa > target_cpa × cpa_pause_multiplier` (padrão 1.5×) com ≥ `min_conversions_for_decision` | `pause_entity` (critical) | ✅ |
| Escala | `roas ≥ target_roas × 1.2` ou `cpa ≤ target_cpa × 0.8` | `increase_budget` +20% gradual × sazonal | ✅ |
| Redução | `roas < target_roas × 0.6` (sem estourar gatilho de pausa) | `decrease_budget` −20% | ✅ |
| Realocação | forte + fraco simultâneos | `reallocate_budget` (resumo executivo) | advisory |
| Fadiga de criativo | frequência ≥ 3.5 e CTR −25% vs período anterior | `refresh_creative`; severa → `new_audience_suggestion` | advisory |
| Anomalia CPM | CPM +40% vs período anterior | `anomaly_alert` | advisory |
| Gasto sem conversão | ≥ 3× CPA alvo gasto, ≥30 cliques, 0 conversões (campanha de conversão) | `landing_page_suggestion` (checar pixel → landing → tráfego) | advisory |
| Full-funnel | <10% da verba em topo/meio com ≥2 campanhas | `funnel_rebalance` | advisory |
| Lance | ≥30 conversões no período em lance manual/lowest-cost | `change_bid_strategy` | advisory |

Dedupe: o cron não recria sugestão aberta igual (mesmo tipo + entidade); sugestões expiram
em 7 dias (`expires_at`) para não acumular recomendação sobre métrica velha.

---

## 6. Integrações

### Meta Marketing API — Graph API v25.0 (fev/2026)
- Leitura: `GET /act_{id}/campaigns|adsets|insights` (escopo `ads_read`)
- Escrita: `POST /{object_id}` com `status` ou `daily_budget` (escopo `ads_management` — exige App Review/Advanced Access)
- Token: system user do Business Manager, por conta (`ad_accounts.access_token`) ou global (`META_SYSTEM_USER_TOKEN`)

### Google Ads API — REST v24
- Leitura: GAQL via `POST /v24/customers/{cid}/googleAds:search`
- Escrita: `campaigns:mutate` (status) e `campaignBudgets:mutate` (orçamento, em micros)
- Headers: `Authorization: Bearer` (OAuth, escopo `https://www.googleapis.com/auth/adwords`), `developer-token`, `login-customer-id` (MCC)
- Envs: `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID/SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; refresh token por conta

Ambas degradam graciosamente: sem credenciais → conta em `pending_credentials` +
`system_events` warning, nunca crash. Passo a passo completo de credenciais em
`docs/setup/traffic-apis-setup.md`.

### Rotas

| Rota | Método | Auth | Função |
|---|---|---|---|
| `/api/cron/traffic` | GET | `CRON_SECRET` | Loop diário: sync + motor + execução autônoma + relatórios |
| `/api/traffic/accounts` | GET/POST | sessão (RLS) | Listar/conectar contas |
| `/api/traffic/accounts/[id]/sync` | POST | sessão + service | Sync manual imediato |
| `/api/traffic/decisions/[id]` | PATCH | sessão (RLS) | Aprovar (executa) / rejeitar decisão |

---

## 7. Dashboard (`/dashboard/traffic`)

KPIs 7d (investimento, conversões, ROAS, CPA, decisões pendentes) · relatório executivo
mais recente · contas conectadas com status/modo · feed de decisões com rationale e botões
**Aprovar e executar** / **Rejeitar** · tabela de campanhas com performance 7d · auditoria
de ações executadas. Item "Tráfego Pago" no grupo Operações da sidebar.

---

## 8. Validação e limites conhecidos da V1

**Validado com dados mockados (28 testes, `pnpm --filter @ai-workforce-os/web test`):**
normalização fiel dos shapes reais das duas APIs, métricas derivadas, todos os detectores
e regras do motor, guard-rails de orçamento e `is_managed`.

**Modo demo:** `TRAFFIC_USE_MOCK=1` roda o pipeline inteiro (sync → decisões → relatório →
dashboard) com o cenário mockado; `TRAFFIC_DRY_RUN=1` registra execuções sem tocar plataforma.

**Não testado ponta a ponta (exige credenciais reais):** chamadas HTTP às APIs da Meta e do
Google (autenticação, paginação em contas grandes, códigos de erro reais, rate limits).
O código segue a documentação oficial atual, mas deve ser validado numa conta sandbox/real
antes do primeiro cliente pagante.

**Escopo V2 (não incluído na V1):** criação de campanhas/criativos pelo agente, gestão de
públicos via API (custom/lookalike audiences programáticas), UTM automation, modelo de
atribuição comparativo, relatórios semanais agendados por e-mail, OAuth flow no painel
(hoje o refresh token do Google é colado manualmente), criptografia dedicada dos tokens
em repouso (hoje protegidos por RLS + service role).
