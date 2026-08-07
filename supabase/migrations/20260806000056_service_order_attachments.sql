-- ============================================================
-- AI Workforce OS — Migration 56: Ordem de serviço anexada ao
-- agendamento (Fase A — Mawi/360, general_maintenance)
--
-- Pedido literal do dono do produto: a 360 manda uma ordem de serviço
-- (PDF ou foto) que precisa ser assinada. Fluxo: o admin anexa a ordem
-- no agendamento do profissional (a IA já resume em português e
-- pré-preenche endereço/número quando dá pra extrair da imagem — ver
-- lib/service-orders/extraction.ts); o técnico abre a ordem no Portal
-- do Funcionário pra mostrar ao gerente da loja e, ao final, registra
-- quem assinou + data, tira fotos, marca "Finalizado" ou "Cotação" (com
-- link de compra da peça quando for cotação).
--
-- Isto é só a FASE A. Uma FASE B futura (botão "Compra Material", foto
-- de nota fiscal + extração de itens/valores) foi citada pelo dono do
-- produto mas NÃO é implementada aqui — por isso service_order_photos
-- é um jsonb array genérico { url, uploaded_at }[] (mesma forma que uma
-- lista de fotos de nota fiscal usaria depois) em vez de uma tabela
-- rígida, e o bucket de Storage novo (service-orders) não é dedicado só
-- à ordem em si — nomeamos pensando em reuso.
--
--   service_order_status é DISTINTO de appointments.status (que já
--   cobre scheduled/confirmed/completed/cancelled/no_show, sem
--   "cotação"): 'pending' (nada registrado ainda), 'completed'
--   (serviço executado, assinado), 'quote' (visita de orçamento, sem
--   execução — o técnico deixa fotos + link de compra da peça
--   necessária pro Vinicius decidir/comprar).
--
--   appointments.address já existe (migration 030) e é reaproveitado
--   — a extração por IA só o preenche quando estiver vazio, nunca
--   sobrescreve o que já foi digitado.
--
-- RLS de escrita: appointments_write (migration 026) é "for all" e
-- exige is_org_admin() — role='employee' nunca conseguiria atualizar a
-- própria ordem por ela. Esta migration adiciona uma policy de UPDATE
-- permissiva adicional pro funcionário (só a própria linha, via
-- current_app_employee_id() — migration 053), MAS Postgres RLS não
-- restringe por coluna: sem proteção extra, a mesma policy permitiria
-- ao funcionário reagendar, reatribuir ou cancelar pela mesma via.
-- Defesa: trigger BEFORE UPDATE (mesma receita de
-- service_records_derive_payment_status, migration 055) que, quando
-- current_app_role() = 'employee', rejeita qualquer UPDATE que altere
-- coluna fora da lista de execução da ordem.
-- ============================================================

-- ------------------------------------------------------------
-- APPOINTMENTS: campos da ordem de serviço
-- ------------------------------------------------------------
alter table appointments
  add column if not exists service_order_number text,
  add column if not exists service_order_file_url text,
  add column if not exists service_order_file_name text,
  add column if not exists service_order_summary_pt text,
  add column if not exists service_order_status text not null default 'pending'
    check (service_order_status in ('pending', 'completed', 'quote')),
  add column if not exists service_order_signed_by text,
  add column if not exists service_order_signed_at timestamptz,
  add column if not exists service_order_part_purchase_link text,
  add column if not exists service_order_photos jsonb not null default '[]'::jsonb;

comment on column appointments.service_order_number is
  'Número da ordem de serviço enviada pela empresa contratante (ex.: Mawi/360). Preenchido manualmente pelo admin ao anexar, ou pré-preenchido pela extração por IA quando o anexo é uma imagem legível (lib/service-orders/extraction.ts) — sempre revisável antes de salvar.';
comment on column appointments.service_order_file_url is
  'URL pública (bucket service-orders) do arquivo original da ordem (PDF ou foto), como recebido da contratante. Sempre disponível para o técnico abrir/mostrar ao gerente da loja, mesmo se a extração automática falhar ou ficar em branco.';
comment on column appointments.service_order_summary_pt is
  'Resumo em português da descrição do trabalho, gerado por IA (visão) a partir do anexo — pra o técnico bater o olho e já saber o que precisa fazer, sem ler a ordem inteira. Bônus, não obrigatório: fica null quando a extração não roda ou falha.';
comment on column appointments.service_order_status is
  'Status da execução da ORDEM (distinto de appointments.status, que é o status do AGENDAMENTO): pending = nada registrado ainda; completed = serviço executado e assinado pelo gerente; quote = visita de orçamento (sem execução), com fotos + link de compra da peça necessária.';
comment on column appointments.service_order_signed_by is
  'Nome de quem assinou (o gerente da loja) — texto livre digitado pelo técnico no momento da finalização, não é assinatura digital verificável.';
comment on column appointments.service_order_signed_at is
  'Data/hora em que o técnico registrou a assinatura do gerente (finalização da ordem), não necessariamente o instante exato do atendimento.';
comment on column appointments.service_order_part_purchase_link is
  'Link de compra da peça necessária — só relevante quando service_order_status = ''quote''. Editável pelo técnico junto com a finalização.';
comment on column appointments.service_order_photos is
  'Array jsonb de fotos anexadas pelo técnico ao finalizar/cotar: [{ url, uploaded_at }]. Forma genérica de propósito — pensada pra Fase B (fotos de nota fiscal de compra de material) reaproveitar o mesmo padrão sem precisar de nova migration.';

-- ------------------------------------------------------------
-- STORAGE: bucket novo para ordens de serviço + fotos
--
-- Público pelo mesmo motivo do employee-attachments (migration 036):
-- o técnico abre a URL direto no navegador/app pra mostrar ao gerente
-- da loja, sem o backend como intermediário. Caminho dos arquivos:
-- {unit_id}/{appointment_id}/{filename} — a policy usa o primeiro
-- segmento do path com can_access_unit(), mesmo padrão já usado.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('service-orders', 'service-orders', true)
on conflict (id) do nothing;

drop policy if exists service_orders_public_read on storage.objects;
create policy service_orders_public_read on storage.objects
  for select using (bucket_id = 'service-orders');

drop policy if exists service_orders_write_storage on storage.objects;
create policy service_orders_write_storage on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'service-orders'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists service_orders_update_storage on storage.objects;
create policy service_orders_update_storage on storage.objects
  for update to authenticated
  using (
    bucket_id = 'service-orders'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

drop policy if exists service_orders_delete_storage on storage.objects;
create policy service_orders_delete_storage on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'service-orders'
    and public.can_access_unit((storage.foldername(name))[1]::uuid)
  );

-- ------------------------------------------------------------
-- RLS: funcionário pode ATUALIZAR a própria ordem (não o agendamento
-- inteiro) — policy permissiva adicional, restrita por coluna pelo
-- trigger abaixo.
-- ------------------------------------------------------------
drop policy if exists appointments_employee_service_order_update on appointments;
create policy appointments_employee_service_order_update on appointments
  for update
  using (
    public.current_app_role() = 'employee'
    and employee_id = public.current_app_employee_id()
  )
  with check (
    public.current_app_role() = 'employee'
    and employee_id = public.current_app_employee_id()
  );

-- ------------------------------------------------------------
-- Trigger: blinda o UPDATE de funcionário contra alterar qualquer
-- coluna fora do fluxo de execução da ordem (assinatura, fotos, status
-- da ordem, link de compra). RLS puro do Postgres não restringe por
-- coluna — sem isso, a policy acima abriria reagendamento/reatribuição/
-- cancelamento pelo mesmo caminho.
-- ------------------------------------------------------------
create or replace function public.appointments_guard_employee_write() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys text[] := array[
    'service_order_signed_by',
    'service_order_signed_at',
    'service_order_status',
    'service_order_part_purchase_link',
    'service_order_photos',
    'updated_at'
  ];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
begin
  if public.current_app_role() <> 'employee' then
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any(v_allowed_keys) then
      continue;
    end if;
    if v_old -> v_key is distinct from v_new -> v_key then
      raise exception
        'Funcionário só pode atualizar os campos de execução da ordem de serviço (assinatura, fotos, status, link de compra) — campo "%" não é permitido.',
        v_key;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists appointments_guard_employee_write on appointments;
create trigger appointments_guard_employee_write
  before update on appointments
  for each row execute function public.appointments_guard_employee_write();
