-- Ordens do Facil-IT direto na Agenda (pedido do Vinicius, 2026-09-15):
-- "vai direto para a agenda e o cliente consegue designar o trabalho
-- para o técnico responsável" — em vez de uma fila separada, cada
-- ordem importada agora vira uma linha real em `appointments`,
-- reaproveitando o MESMO pipeline já usado pelo Portal 360 (migration
-- 061): employee_id NULL = pendente de atribuição, admin abre a
-- agenda e atribui profissional/horário pelo formulário que já existe
-- (appointment-form-modal.tsx), sem tela nova nenhuma.
--
-- facilit_work_orders continua existindo só como registro de
-- deduplicação do sync (chave unit_id+facilit_order_number, evita
-- reimportar/recriar a mesma ordem todo dia) — appointment_id aponta
-- pra linha real que o admin de fato vê e edita.

alter table facilit_work_orders
  add column if not exists appointment_id uuid references appointments(id) on delete set null;

create index if not exists facilit_work_orders_appointment_idx on facilit_work_orders(appointment_id);
