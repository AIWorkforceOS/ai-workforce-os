-- Viagem / check-in / fim do serviço com GPS (2026-10-17, pedido do Vinicius):
--   iniciar viagem  -> trip_started_at   (+ posição)
--   check-in        -> checked_in_at     (+ posição)   tempo de viagem  = checked_in_at - trip_started_at
--   assinar+salvar  -> work_ended_at     (+ posição)   tempo de serviço = work_ended_at - checked_in_at
-- O admin escolhe QUEM usa a função (employees.requires_checkin).
--
-- Integridade: as colunas de tempo/posição NÃO entram na allowlist do trigger
-- appointments_guard_employee_write, então o técnico não consegue editá-las por
-- UPDATE direto (nem pela API). Ele só as preenche por esta função, que:
--   * confere que a ordem é DELE (current_app_employee_id());
--   * grava cada marco UMA vez (reenvio da fila offline é idempotente);
--   * aceita o horário do aparelho (o evento pode acontecer sem sinal) só se for
--     plausível (até 7 dias atrás, no máximo 5 min no futuro); senão usa o do servidor;
--   * exige a ordem correta: check-in antes do fim.

alter table public.employees
  add column if not exists requires_checkin boolean not null default false;

comment on column public.employees.requires_checkin is
  'true = este profissional precisa iniciar viagem/fazer check-in com GPS nas ordens de serviço (migration 091). Escolha do admin.';

alter table public.appointments
  add column if not exists trip_started_at timestamptz,
  add column if not exists trip_start_lat double precision,
  add column if not exists trip_start_lng double precision,
  add column if not exists trip_start_accuracy_m double precision,
  add column if not exists checked_in_at timestamptz,
  add column if not exists checkin_lat double precision,
  add column if not exists checkin_lng double precision,
  add column if not exists checkin_accuracy_m double precision,
  add column if not exists work_ended_at timestamptz,
  add column if not exists work_end_lat double precision,
  add column if not exists work_end_lng double precision,
  add column if not exists work_end_accuracy_m double precision;

create or replace function public.record_appointment_event(
  p_appointment_id uuid,
  p_type text,
  p_at timestamptz default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_employee uuid := public.current_app_employee_id();
  v_row public.appointments%rowtype;
  v_at timestamptz;
begin
  if v_employee is null then
    raise exception 'not_an_employee' using errcode = '42501';
  end if;

  -- Sinal (só nesta transação) para o trigger de guarda deixar passar ESTAS colunas:
  -- dentro de SECURITY DEFINER o JWT continua sendo o do funcionário, então sem isso o
  -- trigger barraria o próprio UPDATE da função.
  perform set_config('app.alizo_event_write', '1', true);

  select * into v_row from public.appointments where id = p_appointment_id and employee_id = v_employee;
  if not found then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  v_at := case
    when p_at is not null and p_at > now() - interval '7 days' and p_at < now() + interval '5 minutes' then p_at
    else now()
  end;

  if p_lat is not null and (p_lat < -90 or p_lat > 90) then p_lat := null; p_lng := null; p_accuracy := null; end if;
  if p_lng is not null and (p_lng < -180 or p_lng > 180) then p_lat := null; p_lng := null; p_accuracy := null; end if;

  if p_type = 'trip_start' then
    if v_row.trip_started_at is null and v_row.checked_in_at is null then
      update public.appointments
        set trip_started_at = v_at, trip_start_lat = p_lat, trip_start_lng = p_lng, trip_start_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  elsif p_type = 'check_in' then
    if v_row.checked_in_at is null then
      update public.appointments
        set checked_in_at = greatest(v_at, coalesce(v_row.trip_started_at, v_at)),
            checkin_lat = p_lat, checkin_lng = p_lng, checkin_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  elsif p_type = 'finish' then
    if v_row.checked_in_at is not null and v_row.work_ended_at is null then
      update public.appointments
        set work_ended_at = greatest(v_at, v_row.checked_in_at),
            work_end_lat = p_lat, work_end_lng = p_lng, work_end_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  else
    raise exception 'invalid_event_type' using errcode = '22023';
  end if;

  -- Fecha a janela: depois dos UPDATEs desta função, o sinal volta a desligado (nada além daqui na mesma transação pode escrever essas colunas).
  perform set_config('app.alizo_event_write', '', true);

  return (
    select jsonb_build_object(
      'trip_started_at', a.trip_started_at,
      'checked_in_at', a.checked_in_at,
      'work_ended_at', a.work_ended_at
    )
    from public.appointments a where a.id = p_appointment_id
  );
end;
$$;

revoke all on function public.record_appointment_event(uuid, text, timestamptz, double precision, double precision, double precision) from public, anon;
grant execute on function public.record_appointment_event(uuid, text, timestamptz, double precision, double precision, double precision) to authenticated;

-- Guarda do funcionário (mesma de 084) + exceção para o UPDATE feito por record_appointment_event.
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
  if public.current_app_role() is distinct from 'employee' then
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any(v_allowed_keys) then
      continue;
    end if;
    -- colunas de viagem/check-in só mudam pela função record_appointment_event
    if v_event_write and v_key = any(v_event_keys) then
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
