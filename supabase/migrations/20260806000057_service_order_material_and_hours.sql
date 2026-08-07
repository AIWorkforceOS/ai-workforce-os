-- ============================================================
-- AI Workforce OS — Migration 57: Ordem de serviço — material
-- necessário/valor da compra (cotação) + horas necessárias
-- (Fase A Mawi/360, refinamento pós-teste do dono do produto)
--
-- Pedido literal, depois de testar a Fase A (migration 056) de
-- verdade: além do link de compra da peça que já existia, o técnico
-- precisa descrever QUAL material é necessário e QUANTO custa (só faz
-- sentido quando service_order_status = 'quote', igual ao link), mais
-- uma estimativa de HORAS necessárias pra executar o trabalho — essa
-- última é útil independente do status ser 'completed' ou 'quote', por
-- isso não é limpa/zerada conforme o status (diferente do link e do
-- material, que só existem no contexto de cotação).
-- ============================================================

alter table appointments
  add column if not exists service_order_material_description text,
  add column if not exists service_order_material_value numeric(12,2),
  add column if not exists service_order_hours_needed numeric(6,2);

comment on column appointments.service_order_material_description is
  'Descrição em texto livre do material/peça necessária pra executar o serviço — só relevante quando service_order_status = ''quote'' (junto do link de compra). Editável pelo técnico junto com a finalização.';
comment on column appointments.service_order_material_value is
  'Valor estimado da compra do material/peça necessária — só relevante quando service_order_status = ''quote''. Editável pelo técnico junto com a finalização.';
comment on column appointments.service_order_hours_needed is
  'Estimativa de horas necessárias pra executar o trabalho — preenchível independente do status ser ''completed'' ou ''quote'' (diferente do material/link, que só fazem sentido em cotação, este campo nunca é limpo automaticamente pelo status).';

-- ------------------------------------------------------------
-- Trigger appointments_guard_employee_write (migration 056) precisa
-- incluir as 3 colunas novas na lista de campos que role='employee'
-- pode alterar — sem isso, o UPDATE do técnico com esses campos seria
-- rejeitado pelo próprio banco. ALLOWED_EMPLOYEE_UPDATE_COLUMNS em
-- lib/service-orders/finalize.ts precisa espelhar exatamente esta
-- lista (documentado no comentário daquele arquivo).
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
