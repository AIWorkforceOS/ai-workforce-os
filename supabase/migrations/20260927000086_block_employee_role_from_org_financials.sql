-- Achado real de segurança (2026-09-27, pedido do Vinicius: "as
-- informações do financeiro da matriz nunca apareça para os
-- funcionários"): a migration 052 (employee_portal_access) fechou o
-- acesso de role='employee' em appointments/service_records/employees
-- (só a própria linha), mas três tabelas de financeiro ORG/UNIDADE
-- (nunca por-funcionário) ficaram de fora dessa varredura e continuavam
-- com policy de select aberta pra qualquer membro da org/unidade:
--
--   financial_records (migration 005): receivables/payables da própria
--     Alizo (cobrança da assinatura, custos) — is_org_member(org_id),
--     sem filtro de role.
--   invoices (migration 030): faturas emitidas pela unidade pros
--     CLIENTES dela (receita real da "matriz") — can_access_unit(unit_id),
--     sem filtro de role.
--   service_record_payments (migration 055): ledger de pagamento à
--     EQUIPE por ordem de serviço — can_access_unit(unit_id), sem
--     filtro de role (mostraria o pagamento de TODOS os colegas, não só
--     o do próprio funcionário).
--
-- Nenhuma tela do Portal do Funcionário consulta essas tabelas hoje
-- (confirmado por busca no código) — mas RLS é a fronteira de segurança
-- real neste projeto (Supabase expõe REST direto pra qualquer JWT
-- válido, independente do que a UI mostra), então um login de
-- funcionário válido conseguiria ler essas três tabelas inteiras via
-- chamada direta à API do Supabase, sem passar pelo app. Fecha o mesmo
-- jeito que a 052 fechou: financial_records/invoices não têm nenhum
-- conceito de "linha do funcionário" (nunca deveriam aparecer pra
-- role='employee', ponto); service_record_payments tem dono indireto
-- (via service_records.employee_id), então ganha o mesmo filtro por
-- dono em vez de bloqueio total.

drop policy if exists financial_records_select on financial_records;
create policy financial_records_select on financial_records
  for select using (
    public.is_org_member(org_id)
    and public.current_app_role() <> 'employee'
  );

drop policy if exists invoices_select on invoices;
create policy invoices_select on invoices
  for select using (
    public.can_access_unit(unit_id)
    and public.current_app_role() <> 'employee'
  );

drop policy if exists service_record_payments_select on service_record_payments;
create policy service_record_payments_select on service_record_payments
  for select using (
    public.can_access_unit(unit_id)
    and (
      public.current_app_role() <> 'employee'
      or exists (
        select 1 from service_records sr
        where sr.id = service_record_payments.service_record_id
          and sr.employee_id = public.current_app_employee_id()
      )
    )
  );
