-- Migration 107 — O técnico (role='employee') nunca lê dados do cliente. ADITIVA; NÃO aplicada até autorização.
-- Regra de negócio: o técnico (e o gerente da loja, que vê o Sign Off no aparelho dele) só enxerga a Mawi e a loja do atendimento. O app já não busca
-- esses dados no Portal do Funcionário; aqui o banco também fecha (RLS é a fronteira real — o Supabase expõe a API direta a qualquer login válido):
--  * customers: o técnico não lê o cadastro de clientes (nome, e-mail, telefone, client_company).
--  * client_company_profiles: o técnico não lê logo nem dados dos clientes cadastrados (a migration 101 liberava a qualquer pessoa da empresa).
-- Política RESTRITIVA: soma-se às existentes (AND), não reescreve nenhuma. Administradores, escritório e service role não são afetados.
-- O Sign Off do técnico é gerado no servidor com a marca da Mawi (chave de serviço), sem depender dessas leituras.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

drop policy if exists customers_no_technician on public.customers;
create policy customers_no_technician on public.customers
  as restrictive for select
  using (public.current_app_role() is distinct from 'employee');

drop policy if exists client_company_profiles_no_technician on public.client_company_profiles;
create policy client_company_profiles_no_technician on public.client_company_profiles
  as restrictive for select
  using (public.current_app_role() is distinct from 'employee');
