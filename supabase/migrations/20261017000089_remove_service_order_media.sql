-- Técnico/admin pode excluir foto ou vídeo da ordem (2026-10-17). Remove a
-- ENTRADA da lista service_order_photos de forma atômica (um UPDATE, sem a
-- corrida "ler a lista, tirar, gravar tudo"). O ARQUIVO continua guardado no
-- Storage de propósito: a exclusão some do app, do PDF e do relatório
-- fotográfico, mas nada é apagado definitivamente (recuperável pelo caminho).
--
-- SECURITY INVOKER: roda com a RLS e o trigger de funcionário do próprio
-- usuário (service_order_photos já está na allowlist de colunas).

create or replace function public.remove_service_order_media(p_appointment_id uuid, p_url text)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.appointments a
  set service_order_photos = coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(coalesce(a.service_order_photos, '[]'::jsonb)) as item
    where item ->> 'url' is distinct from p_url
  ), '[]'::jsonb)
  where a.id = p_appointment_id
  returning a.service_order_photos;
$$;

grant execute on function public.remove_service_order_media(uuid, text) to authenticated;
