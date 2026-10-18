# Super Agente de Cotações — verificações antes de aplicar as migrations 093–096 (18/10/2026)

Nada foi aplicado em produção. Tudo abaixo foi verificado em **transações desfeitas** no banco real e por testes automáticos.

## 1. Cron por minuto na Vercel (plano Pro)
Fonte: documentação oficial da Vercel (consultada em 18/10/2026).
| Ponto | Resultado |
|---|---|
| Frequência mínima | Pro: **uma vez por minuto**, precisão por minuto (Hobby: só 1×/dia — não é o caso) |
| Limite de crons por projeto | **100** em todos os planos; hoje o projeto tem 21 → 22 com este |
| Custo | Cron = invocação de função. Pro: US$ 0,60 por milhão de invocações (abatido pelo crédito mensal do Pro). 1 por minuto = 43.200/mês ≈ **US$ 0,03/mês**; CPU ≈ zero (a rota responde em milissegundos quando não há trabalho; na Fase 2/3 nem toca no banco) |
| Entrega | **Melhor esforço**: pode **perder** execução e pode **duplicar** execução; Vercel **não repete** cron que falhou |
| Sobreposição | Se uma execução dura mais que 1 min, a próxima começa em paralelo |
| Duração | Mesmos limites de função (`maxDuration` 300 s configurado) |
| Rollback | Instant Rollback reverte também os crons para os do deployment anterior |
**Como o desenho cobre isso:** duplicata/sobreposição → lease por job + trava consultiva + **máx. 3 jobs rodando** ao mesmo tempo; execução perdida → o cron **não é o caminho principal** (a tela dispara o job logo após salvar) e o próximo minuto retoma; falha → o runner já tem tentativas com espera. **Alternativas seguras, se preferir:** `*/2` ou `*/5` (retomada de aba fechada em até 2–5 min), ou Vercel Queues/Workflow (beta) numa fase futura. **Recomendação:** manter por minuto (custo desprezível, melhor experiência).

## 2. Revisão das migrations
**Evidência colhida no banco real (transação desfeita):**
| Item | Resultado |
|---|---|
| Versão / dependências | PostgreSQL 17.6; `uuid-ossp`, funções `is_org_admin`, `is_org_member`, `can_access_unit`, `is_super_admin` e o papel `service_role` existem |
| Impacto em tabelas existentes | **Somente `units`** recebe 1 coluna (`quote_ai_team_mode`, constante `'off'`: sem reescrever a tabela — 5 linhas). Nenhum trigger/policy/coluna novos em `appointments`, `service_order_*`, fotos, fila ou PWA. Hash de todas as `appointments` **idêntico** antes/depois |
| Locks retidos | `units`: **AccessExclusive** (o `ALTER`, instantâneo com 5 linhas); `appointments`, `organizations`, `units`: **ShareRowExclusive** (criação das chaves estrangeiras das tabelas novas) — bloqueia **escritas** nessas tabelas só durante os milissegundos da criação; leituras nunca bloqueiam |
| Proteção contra espera | Cada migration começa com `set local lock_timeout = '5s'` e `statement_timeout = '60s'`: se uma transação longa (ex.: sync da Facil-IT) estiver segurando `appointments`, a migration **falha rápido e nada muda** — basta repetir |
| Execução individual / ordem | 096 e 095 sozinhas e 094 sem a 093 **falham de forma limpa** (sem estado parcial). Ordem obrigatória: 093 → 094 → 095 → 096 |
| Idempotência | Reexecutar as 4 de novo **não falha** (`if not exists`, `create or replace`, `drop … if exists`) |
| Rollback | `supabase/rollbacks/20261017_quote_team_rollback.sql`: remove só as tabelas/funções do módulo e a coluna de `units`; testado: depois dele **0 tabelas, 0 colunas** e dá para **reaplicar**. Passo 0 não destrutivo: `update units set quote_ai_team_mode = 'off'` + `QUOTE_TEAM_ENABLED=false` |
| Segurança (RLS) | Técnico lê 0 linhas de tarifas, comercial e jobs; admin de outra empresa 0; funções de fila/orçamento só pelo service role |
**Plano de aplicação sugerido:** janela com pouco movimento; aplicar uma por vez; conferir `select count(*) from quote_%`; em falha por `lock_timeout`, repetir.

## 3. Proteção do teto de US$ 0,60
| Cenário | Proteção | Verificado |
|---|---|---|
| Chamadas **simultâneas no mesmo job** | `SELECT … FOR UPDATE` na linha do job + soma `gasto + reservado + pedido ≤ teto` | teste SQL + 10 reservas em paralelo no teste automático: só 6 de US$ 0,10 passam |
| **Jobs diferentes da mesma empresa** (teto mensal) | lock consultivo por empresa serializa a checagem do mês | lock confirmado no banco; teste: teto mensal bloqueia |
| **Reserva não liberada** (processo morreu, timeout da função) | **REVISADO 18/10:** no próximo `claim` (e na varredura do cron) a reserva presa vira **"não confirmada"** (pior caso continua contando nos tetos, mas NÃO é registrada como gasto real) e pode ser reconciliada depois com o custo real. Ver `plano-aplicacao-migrations-093-096.md` §8 | teste SQL: `spent=0 reserved=0 unconfirmed=0,30`; liquidação tardia vira custo real sem duplicar |
| **Falha/erro da chamada** | **REVISADO:** só falha comprovadamente sem cobrança (4xx/429/chave ausente) devolve a reserva; falha ambígua (timeout/5xx/rede) a mantém como "não confirmada" | testes automáticos |
| **Timeout de etapa** | etapa abandonada; reserva fica e é cobrada/reconciliada (conservador); a chamada à OpenAI tem timeout próprio (80 s) menor que o da etapa (90 s) | teste do runner |
| **Custo real maior que o estimado** | pior caso usa saída máxima + imagem com margem de 25 %; se mesmo assim passar do teto, o runner **para as etapas de IA** e lista o pendente | teste automático |
| Job parado/terminado tentando gastar | `reserve` só aceita job `running` | teste SQL |
| **Reanálise em loop** | máx. 3 análises novas por ordem por dia (e cada uma conta no teto mensal) | teste automático |
| Concorrência de jobs | máx. 3 rodando; claim serializado | teste SQL: 4 jobs → 3 tomados |
**Limite honesto:** o banco não pôde ser testado com 2 conexões verdadeiramente paralelas antes de as migrations existirem; a garantia vem dos locks (verificados por leitura de `pg_locks`) e dos testes sequenciais. **Pós-aplicação (custo zero, não chama OpenAI):** script de 20 reservas paralelas contra um job de teste para confirmar que a soma nunca passa de US$ 0,60.
