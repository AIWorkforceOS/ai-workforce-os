# Plano final de aplicação — migrations 093–096 (Super Agente de Cotações)

**Estado: NADA aplicado.** Este plano só vale com autorização específica do Vinicius. Aplicar as migrations NÃO liga o módulo: `units.quote_ai_team_mode` nasce `off` e `QUOTE_TEAM_ENABLED` segue desligado; o registro de etapas (`handlers.ts`) está vazio, então mesmo ligado nada chama IA até a Fase 4.

## 0. O que as migrations tocam em dados existentes
Só **1 coluna constante** em `units` (5 linhas, sem reescrever tabela). Nada em `appointments`, `service_order_*`, fotos, fila offline, PWA, financeiro. Tudo o mais é tabela/função nova.

## 1. Pré-requisitos (antes da janela)
| # | Item | Como | Quem |
|---|---|---|---|
| 1 | Autorização específica de aplicar | mensagem do Vinicius | Vinicius |
| 2 | Plano da Vercel confirmado como Pro (cron por minuto só existe no Pro; no Hobby o deploy do `vercel.json` falha) | Vercel → Settings → Billing | Vinicius |
| 3 | Janela com pouco movimento (sem sync Facil-IT rodando; cron dela é 6×/dia) | olhar horários em `vercel.json` | combinado |
| 4 | Código local deployado **depois** das migrations (o código novo já tolera tabelas ausentes? NÃO — por isso a ordem é migrations → deploy) | seção 6 | assistente |

## 2. Backup (obrigatório antes de aplicar)
O projeto Supabase está no plano Free (sem backup nativo). Como as migrations são aditivas, o risco real é baixo, mas o backup é barato:
1. Disparar o backup lógico já existente: `GET /api/cron/db-backup` com `Authorization: Bearer $CRON_SECRET` (exporta `BACKUP_TABLES`, inclui `units` e `appointments`, para o bucket de backup). Conferir no retorno: `error: null` em todas as tabelas e contagens iguais às de hoje.
2. Guardar a linha de referência da pré-checagem (contagens + hash de `appointments`).
3. (Opcional, recomendado se o Supabase Pro for contratado antes) backup nativo/PITR.
**Critério:** backup do dia com 0 erros. Sem ele, não aplicar.

## 3. Pré-checagem (somente leitura)
Rodar [supabase/tests/quote_preflight.sql](../../supabase/tests/quote_preflight.sql). **Todas as linhas `ok = true`** (versão do Postgres, extensão, funções de RLS, papel `service_role`, tabelas-pai, módulo ainda não aplicado, nenhuma transação longa, linha de referência). Executada hoje (18/10): tudo `true` (PostgreSQL 17.6; units=5; appointments=121).
O hash de `appointments` muda sempre que uma ordem é editada: compare-o só se ninguém mexer entre a pré e a pós-checagem; o que vale é a contagem e a ausência de alteração pelas migrations (que não tocam essa tabela).

## 4. Execução (uma por vez, nesta ordem)
Cada arquivo começa com `lock_timeout = 5s` e `statement_timeout = 60s`: se algo segurar `appointments`/`units`, a migration **falha rápida e nada muda** — é só repetir.
| Ordem | Arquivo | Conferir logo depois |
|---|---|---|
| 1 | `20261017000093_quote_team_flags_and_rate_cards.sql` | `units.quote_ai_team_mode` existe e todas as 5 linhas = `off`; tabela `quote_rate_cards` existe |
| 2 | `…094_quote_team_core.sql` | tabelas `quote_analysis_jobs` (com `unconfirmed_usd`), `quote_drafts`, `quote_items`, `quote_item_options`, `quote_labor_plan`, `quote_draft_media`, `quote_commercial`, `quote_events`; RLS ligado |
| 3 | `…095_quote_team_infra.sql` | `quote_budget_reservations`, `quote_org_limits`, `product_price_cache` e as 11 funções |
| 4 | `…096_quote_team_approval_immutability.sql` | triggers de imutabilidade e `approve_quote_draft` |
Executar 096/095 sem as anteriores falha limpo (sem estado parcial). Reexecutar qualquer uma é seguro (idempotente).
Se uma falhar: **parar**, não pular para a próxima, anotar a mensagem, aplicar o rollback da seção 7 se necessário.

## 5. Verificações pós-aplicação
1. [supabase/tests/quote_post_apply_checks.sql](../../supabase/tests/quote_post_apply_checks.sql) → mensagem `POST_OK` (tabelas com RLS; funções só do `service_role`; `anon`/`authenticated` sem acesso às camadas administrativas; plano de mão de obra sem coluna monetária; nenhuma unidade ligada). Termina em exceção de propósito (nada é gravado).
2. [supabase/tests/quote_budget_verify.sql](../../supabase/tests/quote_budget_verify.sql) → `VERIFY_OK` (9 grupos: liquidação idempotente, tetos somando os 3 baldes, liberar, reconciliar, claim com lease vencido, varredura, job parado, teto mensal, permissões). Também em transação desfeita.
3. **Permissões por papel** (técnico × admin × outra empresa com claims JWT reais): repetir o roteiro de `verificacoes-pre-aplicacao.md` §2 (técnico lê 0 linhas de tarifas/comercial/jobs; admin de outra empresa 0).
4. **Concorrência real (custo US$ 0, sem OpenAI):** `node tools/quote-budget-concurrency.mjs --confirm --appointment <id de uma ordem de TESTE>` → 20 reservas paralelas: **exatamente 6** aceitas (teto 0,60), ids distintos, 10 liquidações paralelas da mesma reserva = **1** cobrança; apaga o job de teste. Escreve 1 job e o apaga (só isso).
5. Reconferir contagens: `units`=5, `appointments`=121 (+ ordens novas do dia), nenhuma unidade com modo ≠ `off`.
6. Só então o deploy do código (seção 6).

## 6. Deploy do código (autorização separada)
Código local (commits não publicados) inclui: rota `/api/quote-jobs/*`, cron `/api/cron/quote-jobs` (por minuto), gancho em `service-order/route.ts` — todos **inertes** com o módulo `off`/`QUOTE_TEAM_ENABLED` ausente. O cron por minuto roda a varredura de reservas e sai (milissegundos, sem tocar IA). Depois do deploy: conferir em Vercel → Cron Jobs que o novo cron aparece e responde 200; conferir logs.

## 7. Rollback (do menos para o mais destrutivo)
| Passo | Ação | Destrói dados? |
|---|---|---|
| 0 | `update public.units set quote_ai_team_mode = 'off';` + `QUOTE_TEAM_ENABLED=false` | **Não** |
| 1 | Instant Rollback do deploy na Vercel (reverte código e cron) | Não |
| 2 | `supabase/rollbacks/20261017_quote_team_rollback.sql` (remove tabelas/funções do módulo e a coluna de `units`) | Só dados do próprio módulo (análises/jobs/reservas). **Exportar antes** se já houver uso real |
Passo 0 basta para qualquer problema operacional: com o módulo `off` nada do Super Agente executa e nenhum fluxo de ordem/foto/PDF/PWA depende dele. O passo 2 foi testado em transação desfeita (0 tabelas e 0 colunas depois; reaplicável) e agora inclui `quote_budget_reservations` e as funções novas.

## 8. Orçamento de IA — como a reconciliação funciona (revisado)
Três baldes por cotação, todos contando nos tetos de **US$ 0,60/cotação** e **US$ 50/mês/empresa**:
| Balde | Significa | Entra por | Sai por |
|---|---|---|---|
| `spent_usd` (confirmado) | custo **real** medido na resposta da API | liquidação (`settle`) ou reconciliação | — |
| `reserved_usd` (ativo) | pior caso de uma chamada em andamento | `reserve` (antes de chamar) | liquidação / liberação / expiração |
| `unconfirmed_usd` (preventivo) | pior caso de chamada **interrompida** ou de resultado ambíguo; **não** é gasto real | falha ambígua (timeout, rede, 5xx), lease vencido, varredura (>10 min sem worker) | liquidação tardia (worker lento respondeu) ou reconciliação com o custo real (pode ser 0) |
Regras: (a) só falha **comprovadamente sem cobrança** (chave ausente, HTTP 4xx, 429) libera a reserva; (b) cada reserva tem id e **liquidar/liberar/reconciliar é idempotente** (nunca cobra duas vezes); (c) falha ao gravar a liquidação não descarta o resultado nem devolve a reserva; (d) o teto mensal soma o **razão** (`quote_budget_reservations`), não a data do job; (e) travas sempre na ordem empresa → job → reserva (sem deadlock); (f) `quote_org_budget_report(org)` mostra confirmado × ativo × não confirmado × excesso (`overrun_usd` = custo real acima do pior caso estimado, alarme de estimativa subestimada).
**Reconciliar com dado real:** `select reconcile_quote_reservation('<id>', <custo real>, 'relatório OpenAI');` (service role). Reservas não confirmadas listadas por `select * from quote_budget_reservations where status='unconfirmed'`.
Efeito prático: falhas repetidas podem consumir o teto **preventivamente** (3 timeouts de pior caso 0,20 esgotam a cotação) — é intencional e conservador; o técnico segue manual e o admin reconcilia.

## 9. O que continua dependendo de autorização do Vinicius
1. Aplicar as migrations 093–096 (e a data/janela).
2. Push dos commits locais e deploy (inclui o cron por minuto, que exige Vercel Pro).
3. Qualquer chamada paga adicional à OpenAI (novos testes com fotos de defeitos reais).
4. Fase 4 (ligar etapas além do diagnóstico, modo sombra) e a escolha definitiva do modelo.
5. Supabase Pro / backup nativo, se quiser.
