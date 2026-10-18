-- Super Agente de Cotações — Fase 2 / migration 096 (ADITIVA; NÃO aplicada até autorização).
-- Versão APROVADA nunca é sobrescrita nem apagada. Aprovação técnica ≠ comercial (colunas separadas).
-- Segurança de aplicação: falha rápido em vez de travar atrás de transação longa (ex.: sync da Facil-IT) e nunca roda sem limite.
set local lock_timeout = '5s';
set local statement_timeout = '60s';


-- Rascunho aprovado: só o estado COMERCIAL pode mudar (admin), e approved -> superseded quando uma revisão nova é aprovada.
create or replace function public.quote_drafts_guard_approved() returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'superseded') then
      raise exception 'Versão aprovada da cotação não pode ser apagada.' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.status in ('approved', 'superseded') then
    -- campos que continuam livres: estado comercial e carimbo de atualização
    if new.status is distinct from old.status and not (old.status = 'approved' and new.status = 'superseded') then
      raise exception 'Versão aprovada não pode voltar a rascunho.' using errcode = '42501';
    end if;
    if (to_jsonb(new) - 'commercial_status' - 'updated_at' - 'status')
       is distinct from (to_jsonb(old) - 'commercial_status' - 'updated_at' - 'status') then
      raise exception 'Versão aprovada da cotação é imutável (só o estado comercial pode mudar). Crie uma nova revisão.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists quote_drafts_guard_approved on public.quote_drafts;
create trigger quote_drafts_guard_approved before update or delete on public.quote_drafts
  for each row execute function public.quote_drafts_guard_approved();

-- Filhos (itens, opções, mão de obra, mídias) de rascunho aprovado/superado também não mudam
create or replace function public.quote_children_guard_approved() returns trigger
language plpgsql
as $$
declare
  v_draft uuid := coalesce(case when tg_op = 'DELETE' then old.draft_id else new.draft_id end, null);
  v_status text;
begin
  select status into v_status from public.quote_drafts where id = v_draft;
  if v_status in ('approved', 'superseded') then
    raise exception 'Itens de uma versão aprovada da cotação são imutáveis. Crie uma nova revisão.' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists quote_items_guard_approved on public.quote_items;
create trigger quote_items_guard_approved before insert or update or delete on public.quote_items
  for each row execute function public.quote_children_guard_approved();
drop trigger if exists quote_item_options_guard_approved on public.quote_item_options;
create trigger quote_item_options_guard_approved before insert or update or delete on public.quote_item_options
  for each row execute function public.quote_children_guard_approved();
drop trigger if exists quote_labor_plan_guard_approved on public.quote_labor_plan;
create trigger quote_labor_plan_guard_approved before insert or update or delete on public.quote_labor_plan
  for each row execute function public.quote_children_guard_approved();
drop trigger if exists quote_draft_media_guard_approved on public.quote_draft_media;
create trigger quote_draft_media_guard_approved before insert or update or delete on public.quote_draft_media
  for each row execute function public.quote_children_guard_approved();

-- Aprovar a versão TÉCNICA (chamada pela rota de servidor DEPOIS de recalcular tudo). Congela a versão e substitui a aprovada anterior.
create or replace function public.approve_quote_draft(p_draft_id uuid, p_approved_by uuid, p_snapshot jsonb)
returns public.quote_drafts
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.quote_drafts%rowtype;
  v_result public.quote_drafts%rowtype;
begin
  select * into v_draft from public.quote_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'draft_not_found' using errcode = 'P0002';
  end if;
  if v_draft.status <> 'draft' then
    raise exception 'Só um rascunho pode ser aprovado.' using errcode = '42501';
  end if;
  if v_draft.technical_check = 'blocked' then
    raise exception 'Cotação bloqueada por informação crítica não pode ser aprovada como validada.' using errcode = '42501';
  end if;

  update public.quote_drafts
     set status = 'superseded'
   where appointment_id = v_draft.appointment_id and status = 'approved' and id <> p_draft_id;

  update public.quote_drafts
     set status = 'approved', approved_by = p_approved_by, approved_at = now(), approval_snapshot = p_snapshot
   where id = p_draft_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function public.approve_quote_draft(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.approve_quote_draft(uuid, uuid, jsonb) to service_role;
