-- Backup diário dos dados de negócio (2026-09-27, pedido do Vinicius:
-- "todas informações, valores, WOs, valores lançados precisa esta
-- sempre salvo nunca pode se perder, precisa ter backup diario ou
-- semanal"). Bucket PRIVADO — sem nenhuma policy pra anon/authenticated
-- de propósito, então só o service role (o cron) consegue ler/escrever
-- nele; é dados financeiros/de ordens de serviço de todas as unidades,
-- nunca deve ficar acessível por sessão de usuário nenhuma.

insert into storage.buckets (id, name, public)
values ('backups', 'backups', false)
on conflict (id) do nothing;
