-- Certificação dos funcionários digitais, catálogo operacional completo e
-- base de conhecimento pesquisável. Funcionários já ativos continuam ativos,
-- mas aparecem como "requer revisão" até a próxima certificação.

alter table public.services
  add column if not exists description text,
  add column if not exists price_notes text,
  add column if not exists booking_rules text,
  add column if not exists cancellation_rules text,
  add column if not exists customer_requirements text;

alter table public.agent_configs
  add column if not exists certification_status text not null default 'missing_information',
  add column if not exists certification_issues jsonb not null default '[]'::jsonb,
  add column if not exists certified_at timestamptz,
  add column if not exists certification_version integer not null default 1;

alter table public.agent_configs drop constraint if exists agent_configs_certification_status_check;
alter table public.agent_configs add constraint agent_configs_certification_status_check
  check (certification_status in ('ready', 'missing_information', 'requires_review'));

update public.agent_configs
set certification_status = 'requires_review',
    certification_issues = '["Certificação criada depois da ativação; execute a revisão guiada."]'::jsonb
where is_active = true and certification_status = 'missing_information';

create or replace function public.enforce_interview_before_activation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.is_active and new.interview_status <> 'completed' then
    raise exception 'interview_required: o funcionário digital só pode ser ativado depois de concluir a entrevista de treinamento';
  end if;
  if new.is_active
     and (tg_op = 'INSERT' or old.is_active = false)
     and new.certification_status <> 'ready' then
    raise exception 'certification_required: revise as informações e os cenários antes de ativar o funcionário';
  end if;
  return new;
end;
$$;

comment on column public.agent_configs.certification_status is
  'ready = pronto; missing_information = faltam dados obrigatórios; requires_review = dados existem, mas precisam de revisão/teste.';
comment on column public.services.booking_rules is
  'Regras verdadeiras para agendamento; entram no contexto da Recepcionista e nunca devem ser inventadas.';
