-- ============================================================
-- AI Workforce OS — Migration 14: canal de mensagens SMS (Twilio)
--
-- Fora do Brasil (ex.: EUA, onde o produto começa a prospectar limpeza
-- comercial com clientes como a Mawi Services) o WhatsApp não é o canal
-- dominante — lá se usa SMS. Esta migration adiciona SMS como canal
-- alternativo ao WhatsApp: cada unidade escolhe o canal em
-- units.messaging_channel, e as credenciais Twilio (uma conta por
-- empresa cliente nos EUA, por causa do registro A2P 10DLC) ficam nos
-- mesmos moldes das credenciais Evolution API (colunas em texto plano na
-- própria unidade, mesma RLS que já protege o resto de `units`).
-- ============================================================

alter table units
  add column if not exists messaging_channel text check (messaging_channel in ('whatsapp', 'sms')),
  add column if not exists twilio_account_sid text,
  add column if not exists twilio_auth_token text,
  add column if not exists twilio_phone_number text;

comment on column units.messaging_channel is
  'Canal de mensagens escolhido pela unidade: whatsapp ou sms. Null = padrão histórico (whatsapp), para não quebrar unidades já em produção.';
comment on column units.twilio_account_sid is
  'Account SID da conta Twilio desta unidade. Null = usa TWILIO_ACCOUNT_SID (não recomendado em produção: cada empresa cliente nos EUA precisa da própria conta por causa do registro A2P 10DLC).';
comment on column units.twilio_auth_token is
  'Auth Token da conta Twilio desta unidade. Null = usa TWILIO_AUTH_TOKEN.';
comment on column units.twilio_phone_number is
  'Número Twilio (formato E.164, ex.: +15551234567) usado para enviar/receber SMS desta unidade. Null = usa TWILIO_PHONE_NUMBER.';

-- candidate_messages.channel tinha CHECK restrito a whatsapp/email —
-- precisa aceitar sms também, já que o Recruiter reaproveita o mesmo
-- lib/channels/messaging-channel.ts do SDR/Sales Rep.
alter table candidate_messages drop constraint if exists candidate_messages_channel_check;
alter table candidate_messages add constraint candidate_messages_channel_check
  check (channel in ('whatsapp', 'email', 'sms'));
