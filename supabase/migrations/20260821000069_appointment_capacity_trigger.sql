-- Fase 10 (agenda confiável) — idempotência contra duplicidade de agendamento.
--
-- Achado: nada no banco impede duas reservas simultâneas do mesmo unit_id +
-- service_id + starts_at além da capacidade configurada do serviço
-- (services.capacity_per_slot). O código de aplicação já tinha a mensagem de
-- erro pronta pra essa colisão ("horário pode ter sido ocupado no mesmo
-- instante", ver executeBooking em
-- apps/web/src/lib/receptionist/scheduling.ts) mas nenhuma constraint real
-- levantava esse erro — duas inserções concorrentes simplesmente teriam
-- sucesso as duas, criando um double-booking silencioso.
--
-- Por que trigger e não `unique index`: a regra é "não passar da capacidade
-- configurada", não "nunca repetir o horário" — services.capacity_per_slot
-- pode ser > 1 (ex.: aula em grupo), e nesse caso vários agendamentos DEVEM
-- coexistir no mesmo horário. Um unique index simples quebraria esse caso
-- legítimo.
--
-- pg_advisory_xact_lock serializa a concorrência real: sem ele, duas
-- transações simultâneas contariam os agendamentos ativos em paralelo,
-- ambas veriam "ainda cabe" e ambas commitariam — o mesmo problema que a
-- trigger existe pra resolver. Com o lock, a segunda transação espera a
-- primeira liberar (commit ou rollback) antes de contar.
--
-- Não testado contra Postgres real nesta sessão (sem Supabase
-- CLI/Docker disponível no ambiente) — revisar e validar em staging antes
-- de aplicar em produção, como as demais migrations deste projeto.

create or replace function enforce_appointment_capacity()
returns trigger as $$
declare
  service_capacity int;
  active_count int;
begin
  -- só bloqueia status que de fato ocupam o horário; sem service_id não há
  -- capacidade pra comparar (ex.: bloqueio manual de agenda sem serviço).
  if new.status not in ('scheduled', 'confirmed') or new.service_id is null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.unit_id::text || '|' || new.service_id::text || '|' || new.starts_at::text));

  select capacity_per_slot into service_capacity from services where id = new.service_id;
  if service_capacity is null then
    return new; -- serviço não encontrado/sem capacidade configurada — não bloqueia, deixa a FK de service_id ser quem barra isso
  end if;

  select count(*) into active_count
  from appointments
  where unit_id = new.unit_id
    and service_id = new.service_id
    and starts_at = new.starts_at
    and status in ('scheduled', 'confirmed')
    and id <> new.id;

  if active_count >= service_capacity then
    raise exception 'appointment_slot_full: este horário já está na capacidade máxima (%) para este serviço', service_capacity;
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists appointments_enforce_capacity on appointments;
create trigger appointments_enforce_capacity
  before insert or update on appointments
  for each row execute function enforce_appointment_capacity();
