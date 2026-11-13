-- Identificadores públicos do WhatsApp Business Platform por unidade.
-- O token permanece somente no ambiente do servidor (META_WHATSAPP_ACCESS_TOKEN).
alter table public.units
  add column if not exists meta_whatsapp_phone_number_id text,
  add column if not exists meta_whatsapp_waba_id text;

create unique index if not exists units_meta_whatsapp_phone_number_id_key
  on public.units (meta_whatsapp_phone_number_id)
  where meta_whatsapp_phone_number_id is not null;

create unique index if not exists units_meta_whatsapp_phone_number_id_key
  on public.units (meta_whatsapp_phone_number_id)
  where meta_whatsapp_phone_number_id is not null;

comment on column public.units.meta_whatsapp_phone_number_id is
  'ID do número na WhatsApp Cloud API. Preenchido somente após onboarding e teste concluídos.';
comment on column public.units.meta_whatsapp_waba_id is
  'ID da conta WhatsApp Business (WABA) proprietária do número oficial.';
