-- Viagem/check-in/fim (2026-10-17): o horário do marco é o do TOQUE do técnico, mas a posição do GPS pode
-- chegar um instante depois (ex.: ao tocar em "Iniciar viagem" o app abre o Google Maps e vai para o segundo
-- plano). Se o marco JÁ existe e ficou sem posição, uma nova chamada com posição só PREENCHE as coordenadas
-- (nunca muda o horário nem sobrescreve coordenadas já gravadas).

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
    elsif v_row.trip_started_at is not null and v_row.trip_start_lat is null and p_lat is not null and p_lng is not null then
      update public.appointments
        set trip_start_lat = p_lat, trip_start_lng = p_lng, trip_start_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  elsif p_type = 'check_in' then
    if v_row.checked_in_at is null then
      update public.appointments
        set checked_in_at = greatest(v_at, coalesce(v_row.trip_started_at, v_at)),
            checkin_lat = p_lat, checkin_lng = p_lng, checkin_accuracy_m = p_accuracy
        where id = p_appointment_id;
    elsif v_row.checkin_lat is null and p_lat is not null and p_lng is not null then
      update public.appointments
        set checkin_lat = p_lat, checkin_lng = p_lng, checkin_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  elsif p_type = 'finish' then
    if v_row.checked_in_at is not null and v_row.work_ended_at is null then
      update public.appointments
        set work_ended_at = greatest(v_at, v_row.checked_in_at),
            work_end_lat = p_lat, work_end_lng = p_lng, work_end_accuracy_m = p_accuracy
        where id = p_appointment_id;
    elsif v_row.work_ended_at is not null and v_row.work_end_lat is null and p_lat is not null and p_lng is not null then
      update public.appointments
        set work_end_lat = p_lat, work_end_lng = p_lng, work_end_accuracy_m = p_accuracy
        where id = p_appointment_id;
    end if;
  else
    raise exception 'invalid_event_type' using errcode = '22023';
  end if;

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
