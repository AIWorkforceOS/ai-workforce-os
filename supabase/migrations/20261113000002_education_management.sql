-- Módulo escolar — aditivo. Não altera nem remove dados/tabelas existentes.

create table public.education_programs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  duration_months integer check (duration_months is null or duration_months > 0),
  total_hours integer check (total_hours is null or total_hours > 0),
  enrollment_fee numeric(12,2) check (enrollment_fee is null or enrollment_fee >= 0),
  monthly_price numeric(12,2) check (monthly_price is null or monthly_price >= 0),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD')),
  completion_requirements text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.education_subjects (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  program_id uuid not null references public.education_programs(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  description text,
  workload_hours integer check (workload_hours is null or workload_hours > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, name)
);

create table public.education_teachers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  specialties text[] not null default '{}',
  document_reference text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.education_students (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  email text,
  phone text,
  birth_date date,
  document_number text,
  guardian_name text,
  guardian_phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'graduated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.education_cohorts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  program_id uuid not null references public.education_programs(id) on delete restrict,
  teacher_id uuid references public.education_teachers(id) on delete set null,
  name text not null check (length(trim(name)) > 0),
  start_date date not null,
  end_date date,
  schedule jsonb not null default '{}'::jsonb,
  capacity integer check (capacity is null or capacity > 0),
  price_per_student numeric(12,2) check (price_per_student is null or price_per_student >= 0),
  status text not null default 'planned' check (status in ('planned', 'active', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date)
);

create table public.education_enrollments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  cohort_id uuid not null references public.education_cohorts(id) on delete cascade,
  student_id uuid not null references public.education_students(id) on delete restrict,
  enrolled_at date not null default current_date,
  status text not null default 'active' check (status in ('active', 'paused', 'cancelled', 'completed')),
  agreed_price numeric(12,2) check (agreed_price is null or agreed_price >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cohort_id, student_id)
);

create table public.education_class_sessions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  cohort_id uuid not null references public.education_cohorts(id) on delete cascade,
  subject_id uuid references public.education_subjects(id) on delete set null,
  teacher_id uuid references public.education_teachers(id) on delete set null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  topic text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at)
);

create table public.education_attendance (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  session_id uuid not null references public.education_class_sessions(id) on delete cascade,
  student_id uuid not null references public.education_students(id) on delete cascade,
  status text not null check (status in ('present', 'absent', 'excused', 'late')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id, student_id)
);

create table public.education_documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  student_id uuid references public.education_students(id) on delete cascade,
  program_id uuid references public.education_programs(id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  document_type text not null,
  storage_path text,
  external_url text,
  issued_at date,
  expires_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or external_url is not null),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

create table public.education_diplomas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  enrollment_id uuid not null unique references public.education_enrollments(id) on delete restrict,
  serial_number text not null unique,
  issued_at date not null default current_date,
  completion_date date not null,
  total_hours integer check (total_hours is null or total_hours > 0),
  document_path text,
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.education_set_updated_at() returns trigger
language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

-- Impede referências cruzadas entre organizações/unidades mesmo que alguém
-- tente escrever diretamente pela Data API com UUIDs conhecidos.
create or replace function public.education_assert_scope() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if not exists (select 1 from public.units u where u.id = new.unit_id and u.org_id = new.org_id) then
    raise exception using errcode = '23514', message = 'education_scope_mismatch: unidade não pertence à organização';
  end if;

  if tg_table_name = 'education_subjects' and not exists
    (select 1 from public.education_programs p where p.id = new.program_id and p.org_id = new.org_id and p.unit_id = new.unit_id) then
    raise exception using errcode = '23514', message = 'education_scope_mismatch: curso inválido';
  elsif tg_table_name = 'education_cohorts' then
    if not exists (select 1 from public.education_programs p where p.id = new.program_id and p.org_id = new.org_id and p.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: curso inválido';
    end if;
    if new.teacher_id is not null and not exists (select 1 from public.education_teachers t where t.id = new.teacher_id and t.org_id = new.org_id and t.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: professor inválido';
    end if;
  elsif tg_table_name = 'education_enrollments' and (
    not exists (select 1 from public.education_cohorts c where c.id = new.cohort_id and c.org_id = new.org_id and c.unit_id = new.unit_id)
    or not exists (select 1 from public.education_students s where s.id = new.student_id and s.org_id = new.org_id and s.unit_id = new.unit_id)
  ) then
    raise exception using errcode = '23514', message = 'education_scope_mismatch: turma ou aluno inválido';
  elsif tg_table_name = 'education_class_sessions' then
    if not exists (select 1 from public.education_cohorts c where c.id = new.cohort_id and c.org_id = new.org_id and c.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: turma inválida';
    end if;
    if new.subject_id is not null and not exists (select 1 from public.education_subjects s where s.id = new.subject_id and s.org_id = new.org_id and s.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: disciplina inválida';
    end if;
    if new.teacher_id is not null and not exists (select 1 from public.education_teachers t where t.id = new.teacher_id and t.org_id = new.org_id and t.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: professor inválido';
    end if;
  elsif tg_table_name = 'education_attendance' and (
    not exists (select 1 from public.education_class_sessions s where s.id = new.session_id and s.org_id = new.org_id and s.unit_id = new.unit_id)
    or not exists (select 1 from public.education_students st where st.id = new.student_id and st.org_id = new.org_id and st.unit_id = new.unit_id)
  ) then
    raise exception using errcode = '23514', message = 'education_scope_mismatch: aula ou aluno inválido';
  elsif tg_table_name = 'education_documents' then
    if new.student_id is not null and not exists (select 1 from public.education_students s where s.id = new.student_id and s.org_id = new.org_id and s.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: aluno inválido';
    end if;
    if new.program_id is not null and not exists (select 1 from public.education_programs p where p.id = new.program_id and p.org_id = new.org_id and p.unit_id = new.unit_id) then
      raise exception using errcode = '23514', message = 'education_scope_mismatch: curso inválido';
    end if;
  elsif tg_table_name = 'education_diplomas' and not exists
    (select 1 from public.education_enrollments e where e.id = new.enrollment_id and e.org_id = new.org_id and e.unit_id = new.unit_id) then
    raise exception using errcode = '23514', message = 'education_scope_mismatch: matrícula inválida';
  end if;
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'education_programs', 'education_subjects', 'education_teachers',
    'education_students', 'education_cohorts', 'education_enrollments',
    'education_class_sessions', 'education_attendance', 'education_documents',
    'education_diplomas'
  ] loop
    execute format('create index %I on public.%I (org_id, unit_id)', table_name || '_org_unit_idx', table_name);
    execute format('create trigger %I before update on public.%I for each row execute function public.education_set_updated_at()', table_name || '_updated_at', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.education_assert_scope()', table_name || '_assert_scope', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (can_access_unit(unit_id))', table_name || '_select', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (is_super_admin() or (org_id = current_org_id() and is_org_admin() and can_access_unit(unit_id)))', table_name || '_insert', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (is_super_admin() or (org_id = current_org_id() and is_org_admin() and can_access_unit(unit_id))) with check (is_super_admin() or (org_id = current_org_id() and is_org_admin() and can_access_unit(unit_id)))', table_name || '_update', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (is_super_admin() or (org_id = current_org_id() and is_org_admin() and can_access_unit(unit_id)))', table_name || '_delete', table_name);
  end loop;
end $$;

create index education_subjects_program_idx on public.education_subjects(program_id, sort_order);
create index education_cohorts_program_idx on public.education_cohorts(program_id, start_date desc);
create index education_enrollments_student_idx on public.education_enrollments(student_id, status);
create index education_sessions_cohort_idx on public.education_class_sessions(cohort_id, starts_at desc);
create index education_attendance_student_idx on public.education_attendance(student_id, created_at desc);
create index education_documents_student_idx on public.education_documents(student_id, document_type);

revoke all on function public.education_set_updated_at() from public, anon, authenticated;
revoke all on function public.education_assert_scope() from public, anon, authenticated;
