-- Duas modalidades de WhatsApp por unidade:
-- economy: Evolution/WhatsApp Web via QR (comportamento existente)
-- official_requested: cliente solicitou onboarding na Cloud API da Meta
-- official: integração oficial validada e ativada pela Alizo
--
-- A solicitação nunca desativa a conexão atual. O valor "official" só deve
-- ser gravado pelo fluxo servidor/admin depois que credenciais, webhook,
-- número e faturamento da Meta estiverem confirmados.

alter table public.units
  add column if not exists whatsapp_connection_mode text not null default 'economy'
  check (whatsapp_connection_mode in ('economy', 'official_requested', 'official'));

comment on column public.units.whatsapp_connection_mode is
  'economy=QR/Evolution; official_requested=aguardando onboarding Meta; official=Cloud API validada e ativa';

create index if not exists units_whatsapp_connection_mode_idx
  on public.units (whatsapp_connection_mode)
  where whatsapp_connection_mode <> 'economy';
