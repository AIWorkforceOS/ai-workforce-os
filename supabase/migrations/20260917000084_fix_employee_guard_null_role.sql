-- ============================================================
-- AI Workforce OS — Migration 84: corrige bug real no trigger
-- appointments_guard_employee_write (migrations 056/057/058)
--
-- Achado ao investigar por que a cotação por IA do Portal 360 (pedido
-- URGENTE do Vinicius, 2026-09-17: "a AI não rodou/não existe nesse
-- fluxo" + "a página 3 saiu em português em vez de inglês") não estava
-- sendo salva: a condição `if public.current_app_role() <> 'employee'
-- then return new; end if;` usa `<>`, que em SQL nunca é verdadeiro
-- nem falso quando um dos lados é NULL — é NULL. Um `if NULL then` é
-- tratado como falso, então a linha NÃO retorna cedo, e cai direto no
-- loop que só permite colunas da allowlist (pensada só pra restringir
-- role='employee'). Toda chamada que roda com o service role (sem JWT
-- de usuário — auth.jwt() vem NULL, current_app_role() também vem
-- NULL) cai nesse mesmo buraco: fica bloqueada como se fosse um
-- funcionário tentando escrever campo fora da allowlist, mesmo sem ser
-- um funcionário de verdade.
--
-- Rotas do Portal 360 usam exatamente esse padrão (service role +
-- join client_company, ver app/api/portal-360/orders/.../quote/route.ts
-- e .../pdf/route.ts) porque o usuário role='client' não tem RLS
-- nenhuma de propósito (org_id NULL, migration 061). Resultado real
-- confirmado em produção: a ordem 159452-01 (2026-09-17) gerou a
-- cotação por IA com sucesso (chamada à OpenAI funcionou) mas o UPDATE
-- que salvaria service_order_quote_description_en/pt em appointments
-- foi rejeitado pelo trigger com exceção — por isso os campos
-- continuaram NULL e o PDF (lib/service-orders/pdf.ts, drawQuotePage)
-- caiu no fallback pro texto cru do técnico (em português) na seção
-- que deveria estar em inglês pronta pro cliente.
--
-- Fix: trocar `<>` por `is distinct from`, que trata NULL como "não é
-- 'employee'" (comparação correta, sem o buraco do NULL) — restaura a
-- intenção original do trigger (só restringir de verdade quando o
-- chamador É um funcionário autenticado; qualquer outro caso, inclusive
-- sem role identificável, sempre teve acesso amplo por outro caminho —
-- RLS de admin ou service role bypassando RLS — então não faz sentido
-- vazar a restrição pra esses casos).
-- ============================================================

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
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
  v_key text;
begin
  if public.current_app_role() is distinct from 'employee' then
    return new;
  end if;

  for v_key in select jsonb_object_keys(v_new) loop
    if v_key = any(v_allowed_keys) then
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
