# Plano final de aplicação — migrations 093–096 (Super Agente de Cotações)

**Estado: APLICADAS em produção em 2026-10-18 (093→096), com autorização do Vinicius — ver seção 12. Código NÃO publicado, módulo desligado.** Aplicar as migrations NÃO liga o módulo: `units.quote_ai_team_mode` nasce `off` e `QUOTE_TEAM_ENABLED` segue desligado; o registro de etapas (`handlers.ts`) está vazio, então mesmo ligado nada chama IA até a Fase 4.

## 0. O que as migrations tocam em dados existentes
Só **1 coluna constante** em `units` (5 linhas, sem reescrever tabela). Nada em `appointments`, `service_order_*`, fotos, fila offline, PWA, financeiro. Tudo o mais é tabela/função nova.

## 1. Pré-requisitos (antes da janela)
| # | Item | Como | Quem |
|---|---|---|---|
| 1 | Autorização específica de aplicar | mensagem do Vinicius | Vinicius |
| 2 | Plano da Vercel confirmado como Pro (cron por minuto só existe no Pro; no Hobby o deploy do `vercel.json` falha) | Vercel → Settings → Billing | Vinicius |
| 3 | Janela com pouco movimento (sem sync Facil-IT rodando; cron dela é 6×/dia) | olhar horários em `vercel.json` | combinado |
| 4 | Ordem: migrations primeiro, deploy depois. (O código novo é inerte e não toca o banco enquanto `handlers.ts` estiver vazio, então a ordem inversa também não quebraria nada — ver seção 10) | seção 6 | assistente |

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

## 10. Evidências colhidas em 18/10/2026 (sem alterar nada em produção)
**Backup recuperável.** O cron `/api/cron/db-backup` roda todo dia às 06:00 UTC e gravou os dias 11 a 18/10 (10 arquivos/dia, ~1,0 MB). Baixei o backup de **18/10** e abri os 10 arquivos: JSON válido e contagens **idênticas** ao banco (organizations 4, units 5, employees 4, customers 10, appointments 121, service_records 237, service_record_payments 2, invoices 8, financial_records 4, facilit_work_orders 89). Limites honestos: é backup **lógico** (linhas de 10 tabelas, sem credenciais de propósito, sem Storage/fotos), fica no **mesmo projeto Supabase** (não protege contra perder o projeto) e não há recuperação ponto-no-tempo (plano Free). As migrations só adicionam 1 coluna constante em `units` e tabelas novas, então o risco real é baixo. Nenhum plano foi contratado nem alterado.
**Implantação inerte (unidades OFF + `QUOTE_TEAM_ENABLED=false`).** `handlers.ts` está vazio ⇒ `isPipelineReady` é falso ⇒ (a) o gancho ao salvar a ordem retorna `pipeline_not_ready` **sem nenhuma consulta ao banco**; (b) o cron por minuto responde `skipped` **sem criar cliente de banco**; (c) as rotas `/api/quote-jobs/*` respondem 409. Isso vale com ou sem a variável `QUOTE_TEAM_ENABLED`, antes ou depois das migrations. Cobertura automática nova: `app/api/cron/quote-jobs/__tests__/route.test.ts` (4 testes, inclusive banco que lança erro se for tocado). Como as 5 unidades nascem `off` (coluna com default constante), nada do fluxo de WO/foto/PDF/PWA muda.
**Ensaio completo das migrations 093→096 + pós-testes, em UMA transação desfeita no banco real:** as 4 migrations aplicaram sem erro; `quote_post_apply_checks` ⇒ `POST_OK` (12 tabelas com RLS, 11 funções só do `service_role`, plano de mão de obra sem coluna monetária, nenhuma unidade ligada, `authenticated`/`anon` sem acesso às camadas administrativas); `quote_budget_verify` ⇒ 9 grupos OK com as chaves estrangeiras reais. Depois: 0 tabelas, 0 funções, 0 colunas do módulo; appointments 121 / units 5 (nada gravado). Esse ensaio achou um falso positivo no meu próprio teste (`billable_hours_basis` é texto, não valor) — corrigido.
**Rollback:** conferência estática: toda função e tabela criada por 093–096 tem o `drop` correspondente no script (0 faltando). O script destrutivo completo já foi ensaiado antes (versão anterior); a versão atual só acrescentou as tabelas/funções novas do orçamento.

## 11. Sequência final de execução (quando o Vinicius autorizar)
1. Pré-checagem `quote_preflight.sql` (todas `true`) + backup do dia conferido (§10) + novo disparo manual do `/api/cron/db-backup` imediatamente antes (0 erros).
2. Aplicar **uma por vez**: 093 → conferir → 094 → conferir → 095 → conferir → 096 → conferir (§4). Falha por `lock_timeout` ⇒ repetir; qualquer outra falha ⇒ parar e rollback.
3. `quote_post_apply_checks.sql` ⇒ `POST_OK`; `quote_budget_verify.sql` ⇒ `VERIFY_OK`.
4. Permissões por papel com claims JWT reais (técnico/admin/outra empresa) — roteiro de `verificacoes-pre-aplicacao.md` §2.
5. Concorrência real: `node tools/quote-budget-concurrency.mjs --confirm --appointment <ordem de teste>` ⇒ 6 aceitas de 20, 1 cobrança de 10 liquidações.
6. Conferir contagens (units, appointments) e que nenhuma unidade está fora de `off`.
7. **Parar.** Deploy do código e qualquer ativação (modo sombra) são autorizações separadas.
**Rollback não destrutivo a qualquer momento:** `update units set quote_ai_team_mode='off'` + `QUOTE_TEAM_ENABLED=false` (nada executa). Só depois, se necessário, o script de rollback (§7).

## 12. Execução real em 18/10/2026 (autorizada)
- **Backup externo** (fora do Supabase): `~/Documents/alizo-backup-externo-2026-10-18-pre-cotacoes/` (10 tabelas em JSON + MANIFEST com hash e contagem + CONFIG-SNAPSHOT.md). Verificado: hash, contagem e comparação com o banco, 10/10. Segredos/tokens omitidos de propósito (incl. `public_report_token`, `dedupe_key`). Só no Mac do Vinicius (não está na nuvem).
- **Baseline antes:** 121 ordens, 78 assinaturas, 18 mídias registradas, 137 arquivos no bucket `service-orders`, hash das ordens `07bc14ca…`, 5 unidades.
- **Aplicação** (`apply_migration`, uma por vez, cada uma conferida antes da próxima): 093 `quote_team_flags_and_rate_cards`, 094 `quote_team_core`, 095 `quote_team_infra`, 096 `quote_team_approval_immutability` — todas `success`, sem falha de lock/timeout. Migrações registradas: 84 → 88.
- **Pós-aplicação:** `POST_OK` (12 tabelas com RLS, 11 funções só do service_role, sem coluna monetária no plano de mão de obra, 0 unidades ligadas); orçamento 9 grupos OK; isolamento com claims JWT reais OK (funcionário em shadow 0 linhas; em live só a camada técnica da própria ordem; admin da empresa vê tudo; admin de outra empresa 0 linhas em 11 tabelas; escrita do funcionário negada); concorrência real 6/20 aceitas, 1 cobrança em 10 liquidações da mesma reserva (job de teste apagado).
- **Integridade depois:** ordens 121, assinaturas 78, mídias 18, arquivos 137, hash `07bc14ca…` **idêntico**; policies/triggers de `units`/`appointments` inalterados (7 e 3); 5/5 unidades `off`; 0 jobs/reservas/limites/tarifas residuais.
- **Achados do verificador de segurança do Supabase (novos, menores):** (1) `quote_set_updated_at`, `quote_drafts_guard_approved`, `quote_children_guard_approved` sem `search_path` fixo — sugerido `alter function … set search_path = public` numa migration 097 aditiva (NÃO aplicada); (2) `product_price_cache` e `quote_budget_reservations` com RLS sem policy (INFO — intencional: só service_role); (3) `quote_draft_visible_to_caller` executável por anon/authenticated (necessário para a policy; devolve só um booleano; mesmo padrão das funções de RLS existentes).
- **Não verificável:** `QUOTE_TEAM_ENABLED` na Vercel (a API devolve 403 ao listar variáveis). Irrelevante para o comportamento atual: etapas vazias ⇒ módulo inerte.
