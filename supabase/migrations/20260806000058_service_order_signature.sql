-- ============================================================
-- AI Workforce OS — Migration 58: Ordem de serviço — assinatura
-- desenhada por toque (Fase A Mawi/360, refinamento pós-teste)
--
-- Pedido do dono do produto: o campo "nome de quem assinou" (texto)
-- já existia, mas precisa também da assinatura desenhada — o técnico
-- passa o celular pro GERENTE DA LOJA assinar com o dedo na tela.
-- Guarda só a URL pública (bucket service-orders, mesmo fluxo das
-- fotos) do PNG gerado pelo canvas; nome (service_order_signed_by) e
-- data (service_order_signed_at) já existem desde a migration 056.
-- ============================================================

alter table appointments
  add column if not exists service_order_signature_url text;

comment on column appointments.service_order_signature_url is
  'URL pública (bucket service-orders) da assinatura desenhada por toque pelo gerente da loja — PNG gerado pelo canvas no Portal do Funcionário. Editável pelo técnico junto com a finalização, igual às fotos.';

-- ------------------------------------------------------------
-- Trigger appointments_guard_employee_write (migrations 056/057)
-- precisa incluir a coluna nova na lista de campos que role='employee'
-- pode alterar. ALLOWED_EMPLOYEE_UPDATE_COLUMNS em
-- lib/service-orders/finalize.ts precisa espelhar exatamente esta
-- lista.
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
    'service_order_signature_url',
    'service_order_status',
    'service_order_part_purchase_link',
    'service_order_material_description',
    'service_order_material_value',
    'service_order_hours_needed',
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
        'Funcionário só pode atualizar os campos de execução da ordem de serviço (assinatura, fotos, status, link de compra, material, horas) — campo "%" não é permitido.',
        v_key;
    end if;
  end loop;

  return new;
end;
$$;
