-- ============================================================
-- AI Workforce OS — Migration 62: Generaliza a biblioteca de materiais
-- (employee_attachments, migration 036) em um recurso da organização
--
-- Pedido do produto: além do Sales Rep (único que já consumia isso),
-- Recepcionista e Recrutador também precisam decidir sozinhos, na
-- conversa, quando mandar um material — e o mesmo material às vezes
-- serve pra mais de um funcionário (ex.: a mesma tabela de preços vale
-- pro SDR e pra Recepcionista) e às vezes vale pra organização inteira,
-- não só pra uma unidade.
--
-- Reaproveita a tabela existente em vez de criar uma nova: o mecanismo
-- (upload no Storage OU link, instrução de uso injetada no prompt,
-- decisão do próprio modelo via campo attachment_id, envio real como
-- mídia no WhatsApp/anexo no e-mail — ver lib/channels/messaging-channel.ts)
-- já está pronto e testado; só o escopo estava restrito demais:
--
--   agent_type (1 valor) → applicable_employees (text[]): um mesmo
--     material agora pode valer pra vários funcionários ao mesmo tempo,
--     escolhidos por checkbox na tela admin — sem precisar cadastrar o
--     mesmo PDF de novo pra cada um.
--   unit_id not null → unit_id nullable: null passa a significar "vale
--     pra toda a organização", mesma convenção de employees/financial_records
--     (migration 004/005) — não um valor mágico novo.
--   kind ('pdf'|'link') → +'image': cliente também pode subir imagens
--     (ex.: foto de um produto, print de um catálogo).
--
-- RLS: com unit_id agora podendo ser null, can_access_unit(unit_id) não
-- serve mais de guarda (ela exige um unit_id não-nulo). Troca pro mesmo
-- padrão de employees/financial_records — que já são org-scoped com
-- unit_id opcional: is_org_member(org_id) pra leitura,
-- org_id = current_org_id() + is_org_admin() pra escrita. Efeito
-- prático idêntico ao de antes (can_access_unit só checava "mesma org do
-- usuário", nunca havia ACL por unidade dentro da org).
--
-- Storage: o path dos arquivos passa a começar por {org_id} em vez de
-- {unit_id} (só assim dá pra checar a policy sem depender de unit_id,
-- que agora pode ser null). Arquivos já enviados antes desta migration
-- continuam com URL pública funcionando normalmente (a policy de leitura
-- é irrestrita); só não podem mais ser reescritos/apagados pelo path
-- antigo — sem efeito prático hoje, porque a tela nunca reescreve nem
-- apaga o objeto do Storage (exclusão remove só a linha da tabela).
-- ============================================================

alter table employee_attachments
  add column if not exists applicable_employees text[] not null default '{}';

update employee_attachments
  set applicable_employees = array[agent_type]
  where applicable_employees = '{}';

alter table employee_attachments
  alter column unit_id drop not null;

alter table employee_attachments
  drop column if exists agent_type;

alter table employee_attachments
  drop constraint if exists employee_attachments_kind_check;

alter table employee_attachments
  add constraint employee_attachments_kind_check check (kind in ('pdf', 'link', 'image'));

comment on column employee_attachments.unit_id is
  'Unidade dona do material, ou null quando o material vale para toda a organização (mesma convenção de employees.unit_id/financial_records.unit_id).';
comment on column employee_attachments.applicable_employees is
  'agent_configs.agent_type dos funcionários que podem enviar este material (ex.: {sdr,receptionist}) — escolhido por checkbox na tela admin. Um mesmo material pode valer para vários funcionários.';

drop index if exists employee_attachments_unit_agent_idx;

create index if not exists employee_attachments_org_unit_idx
  on employee_attachments(org_id, unit_id)
  where is_active;

create index if not exists employee_attachments_applicable_employees_idx
  on employee_attachments using gin (applicable_employees);

alter table employee_attachments enable row level security;

drop policy if exists employee_attachments_select on employee_attachments;
create policy employee_attachments_select on employee_attachments
  for select using (public.is_org_member(org_id));

drop policy if exists employee_attachments_write on employee_attachments;
create policy employee_attachments_write on employee_attachments
  for all using (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  )
  with check (
    public.is_super_admin()
    or (org_id = public.current_org_id() and public.is_org_admin())
  );

drop policy if exists employee_attachments_write_storage on storage.objects;
create policy employee_attachments_write_storage on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'employee-attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists employee_attachments_update_storage on storage.objects;
create policy employee_attachments_update_storage on storage.objects
  for update to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists employee_attachments_delete_storage on storage.objects;
create policy employee_attachments_delete_storage on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.is_org_member((storage.foldername(name))[1]::uuid)
  );
