-- Super Agente de Cotações — migration 097 (ADITIVA; corrige alerta do verificador de segurança do Supabase: function_search_path_mutable).
-- Fixa o search_path das 3 funções-gatilho criadas nas migrations 093/094/096. NÃO muda corpo, dono, SECURITY INVOKER nem permissões:
-- ALTER FUNCTION ... SET só acrescenta a configuração da função (proconfig). Idempotente (pode rodar de novo).
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter function public.quote_set_updated_at() set search_path = public;
alter function public.quote_drafts_guard_approved() set search_path = public;
alter function public.quote_children_guard_approved() set search_path = public;
