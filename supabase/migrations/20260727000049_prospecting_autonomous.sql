-- ------------------------------------------------------------
-- Prospecção autônoma do Sales Rep (sem botão manual)
--
-- 1) agent_configs.prospecting_profile — perfil de segmentação da
--    prospecção, em texto livre, configurado pelo dono da unidade e
--    lido AO VIVO a cada execução do cron (nunca congelado):
--    {
--      "mode": "business_types" | "general",
--      "business_types": ["academias", "padarias", ...],  -- texto livre
--      "region": "Moema",                                 -- bairro/região, texto livre
--      "general_sector": "serviços",                      -- modo "empresas em geral"
--      "headcount_range": "11-50"                         -- METADADO aproximado:
--                                                         -- Google Places não filtra
--                                                         -- por nº de funcionários
--    }
--
-- 2) prospecting_daily_captures — contador de LEADS NOVOS capturados
--    por dia por unidade (separado do limite diário de MENSAGENS,
--    agent_configs.daily_limit). O cron para de buscar (e de gastar
--    chamadas ao Google Places) ao atingir 15 capturas no dia.
-- ------------------------------------------------------------

alter table agent_configs
  add column if not exists prospecting_profile jsonb not null default '{}'::jsonb;

create table if not exists prospecting_daily_captures (
  unit_id uuid not null references units(id) on delete cascade,
  capture_date date not null,
  captured_count int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (unit_id, capture_date)
);

alter table prospecting_daily_captures enable row level security;

-- Escrita só pelo cron (service role, que ignora RLS); leitura segue o
-- mesmo padrão das outras tabelas por unidade para exibir no painel.
drop policy if exists prospecting_daily_captures_select on prospecting_daily_captures;
create policy prospecting_daily_captures_select on prospecting_daily_captures
  for select using (public.can_access_unit(unit_id));
