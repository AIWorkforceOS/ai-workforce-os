-- Histórico administrativo da execução da ordem.
-- Aditiva: não altera nem apaga ordens existentes.

alter table public.appointments
  add column if not exists service_order_completion_summary text;

comment on column public.appointments.service_order_completion_summary is
  'Resumo objetivo do trabalho efetivamente executado, preenchido pelo técnico ou administrador ao finalizar a ordem.';

create index if not exists appointments_unit_service_order_status_idx
  on public.appointments (unit_id, service_order_status, starts_at desc)
  where service_order_file_url is not null or service_order_number is not null;

create or replace function public.appointments_guard_employee_write() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed_keys text[] := array[
    'service_order_signed_by', 'service_order_signed_at', 'service_order_signature_url',
    'service_order_status', 'service_order_part_purchase_link', 'service_order_material_description',
    'service_order_material_value', 'service_order_hours_needed', 'service_order_completion_summary',
    'service_order_photos', 'updated_at'
  ];
  v_event_keys text[] := array[
    'trip_started_at', 'trip_start_lat', 'trip_start_lng', 'trip_start_accuracy_m',
    'checked_in_at', 'checkin_lat', 'checkin_lng', 'checkin_accuracy_m',
    'work_ended_at', 'work_end_lat', 'work_end_lng', 'work_end_accuracy_m'
  ];
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
  v_event_write boolean := coalesce(current_setting('app.alizo_event_write', true), '') = '1';
begin
  if public.current_app_role() is distinct from 'employee' then return new; end if;
  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any(v_allowed_keys) then continue; end if;
    if v_event_write and v_key = any(v_event_keys) then continue; end if;
    if v_old -> v_key is distinct from v_new -> v_key then
      raise exception 'Funcionário só pode atualizar os campos de execução da ordem de serviço — campo "%" não é permitido.', v_key;
    end if;
  end loop;
  return new;
end;
$$;
