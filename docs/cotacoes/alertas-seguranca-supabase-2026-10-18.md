# Alertas do verificador de segurança do Supabase — documentação (18/10/2026)

Estado após a migration 097 (aplicada em 18/10): **7 → 4** alertas de `function_search_path_mutable` (saíram as 3 funções do módulo de cotações). Nada fora do módulo de cotações foi alterado (decisão do Vinicius: não mexer em funções existentes nesta etapa). Nenhum dos alertas abaixo expõe dados entre empresas (testado com JWT reais em 18/10: funcionário, admin da empresa e admin de outra empresa).

| Alerta | Itens | Origem | Avaliação | Ação futura sugerida (não executada) |
|---|---|---|---|---|
| `rls_enabled_no_policy` (INFO) | `product_price_cache`, `quote_budget_reservations` | módulo de cotações | **Intencional**: RLS ligado sem policy = só o service role acessa (cache público de produtos; razão de orçamento) | nenhuma |
| `function_search_path_mutable` (WARN) | `enforce_interview_before_activation`, `can_access_unit`, `prevent_paid_invoice_financial_edit`, `service_records_derive_payment_status` | pré-existentes | Hardening: sem `search_path` fixo. `can_access_unit` entra nas policies de quase todas as tabelas → prioridade maior | migration aditiva `alter function … set search_path = public` (verificar corpo de cada uma antes; mesma técnica da 097) |
| `extension_in_public` (WARN) | `vector` | pré-existente | Cosmético/hardening; mover a extensão pode quebrar colunas/índices `vector` | planejar à parte, com teste; não urgente |
| `anon_/authenticated_security_definer_function_executable` (WARN) | `admin_delete_organization`, `consolidate_invoices`, `generate_service_records_invoice`, `register_service_record_payment`, `record_appointment_event`, `current_app_*`, `current_org_id`, `unit_org_id`, `sync_service_record_payment_totals`, `appointments_guard_employee_write` | pré-existentes; **+1 do módulo**: `quote_draft_visible_to_caller` | Funções mutáveis **checam permissão por dentro** (super_admin / admin da unidade / próprio funcionário) — testado: `anon` e funcionário de outra empresa são recusados. `current_*` devolvem só o contexto do próprio chamador. `quote_draft_visible_to_caller` é necessário à policy e devolve só booleano. Gatilhos (`sync_…`, `appointments_guard_…`) não fazem nada fora do contexto de gatilho | revogar `execute` de `anon` nas funções que só usuários logados chamam; avaliar `unit_org_id` (abaixo) |
| `auth_leaked_password_protection` (WARN) | Auth | configuração | Desligado no painel do Supabase | ligar no painel (Auth → Passwords); **pode exigir plano Pro** — decisão do Vinicius |

## Achados baixos, pré-existentes (sem exposição de dados de negócio)
1. `unit_org_id(uuid)` responde a qualquer um (inclusive `anon`) com o `org_id` da unidade, sem checar nada: só um uuid de empresa, e exige conhecer o uuid da unidade.
2. `register_service_record_payment` distingue "lançamento não encontrado" de "sem permissão" (oráculo de existência de um uuid de lançamento) — baixo.
3. `generate_service_records_invoice`, `consolidate_invoices`: checam permissão **antes** de tocar nos dados. `register_service_record_payment` faz `select … for update` do lançamento **antes** de checar (trava a linha por milissegundos; sem impacto prático).
Nenhum deles foi alterado.
