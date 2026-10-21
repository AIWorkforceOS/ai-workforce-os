-- Migration 099 — CORREÇÃO DE SEGURANÇA (ADITIVA; NÃO aplicada até autorização).
-- Antes: a política users_update deixava QUALQUER usuário logado editar a PRÓPRIA linha em public.users, inclusive role, org_id e unit_id —
-- um técnico conseguia, pela API, virar super_admin ou trocar de empresa (testado em transação desfeita, 20/10/2026).
-- Agora: um usuário comum (role de banco "authenticated") só altera o próprio nome e o último acesso. Qualquer outra coluna, atual ou futura,
-- só muda pelo super admin ou pelo servidor (service role) / SQL administrativo. Nenhum fluxo do app depende de o usuário editar essas colunas.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.users_guard_privileged_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Só a requisição de um usuário comum é restringida (função SEM security definer: current_user continua "authenticated").
  if current_user <> 'authenticated' then
    return new;
  end if;
  if public.is_super_admin() then
    return new;
  end if;
  if (to_jsonb(new) - 'name' - 'last_login_at' - 'updated_at') is distinct from (to_jsonb(old) - 'name' - 'last_login_at' - 'updated_at') then
    raise exception 'Você só pode alterar o seu nome. Papel, empresa, unidade e permissões são definidos pela administração.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_privileged_columns on public.users;
create trigger users_guard_privileged_columns
  before update on public.users
  for each row execute function public.users_guard_privileged_columns();
