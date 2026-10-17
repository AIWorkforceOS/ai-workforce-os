-- Upload direto de mídia (2026-10-16, etapa de confiabilidade): fotos e
-- vídeos agora sobem direto do aparelho pro Storage (o corpo de uma função
-- da Vercel é limitado a ~4,5MB — reproduzido: 5MB => 413
-- FUNCTION_PAYLOAD_TOO_LARGE) e depois são REGISTRADOS na ordem por esta
-- função. Registrar num único UPDATE atômico (jsonb || com dedupe por url)
-- elimina a corrida "ler lista, somar, gravar tudo" que perdia entradas
-- quando dois salvamentos aconteciam juntos.
--
-- SECURITY INVOKER de propósito: roda com a RLS e o trigger
-- appointments_guard_employee_write do próprio usuário — funcionário só
-- consegue mexer na própria ordem e só na coluna service_order_photos
-- (já na allowlist), exatamente como antes.

create or replace function public.append_service_order_media(p_appointment_id uuid, p_items jsonb)
returns jsonb
language sql
security invoker
set search_path = public
as $$
  update public.appointments a
  set service_order_photos = coalesce(a.service_order_photos, '[]'::jsonb) || coalesce((
    select jsonb_agg(item)
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as item
    where not exists (
      select 1
      from jsonb_array_elements(coalesce(a.service_order_photos, '[]'::jsonb)) as existing
      where existing ->> 'url' = item ->> 'url'
    )
  ), '[]'::jsonb)
  where a.id = p_appointment_id
  returning a.service_order_photos;
$$;

grant execute on function public.append_service_order_media(uuid, jsonb) to authenticated;
