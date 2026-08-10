-- ============================================================
-- AI Workforce OS — Migration 61: Portal do Cliente (360 Service
-- Provider) — primeiro login voltado a alguém DE FORA da empresa
--
-- Pedido do dono do produto: a 360 (contratante que hoje só manda
-- ordens de serviço por fora do sistema) ganha um login único e
-- COMPARTILHADO pra toda a rede — não um login por loja — de onde
-- consegue anexar novas ordens (escolhendo só o DIA desejado, nunca
-- profissional/horário — isso continua 100% com o admin da Mawi),
-- acompanhar status, e baixar fotos (antes/depois) + PDF assinado.
--
-- É a primeira vez que este sistema autentica alguém que não é admin
-- nem funcionário da empresa contratada — por isso o desenho aqui é
-- deliberadamente mais conservador que o do Portal do Funcionário
-- (migrations 052/053/056): em vez de abrir policies de RLS novas
-- pra um role 'client', o usuário dessa conta é criado com org_id
-- NULL. Toda policy de escrita/leitura já existente é construída em
-- cima de can_access_unit()/is_org_admin()/is_org_member(), que por
-- sua vez dependem de current_org_id() = public.users.org_id do
-- usuário logado (migration 005/020) — com org_id NULL,
-- current_org_id() devolve NULL e toda comparação
-- "unit_org_id(x) = current_org_id()" resolve pra NULL (falsy em
-- RLS), então o role 'client' fica automaticamente SEM NENHUM acesso
-- direto a nenhuma tabela por RLS, sem precisar tocar em uma única
-- policy existente. Único ponto de acesso: rotas de API server-side
-- (app/api/portal-360/**, ver lib/portal-360/data.ts) usando o
-- client de service role e validando explicitamente, em código, que
-- todo dado lido/escrito pertence ao client_company do usuário
-- logado — a mesma filosofia de "não confiar em RLS ampla" que o
-- dono do produto pediu explicitamente pra esta feature.
--
-- A única exceção necessária é a policy users_select (migration 005),
-- que já libera "lower(email) = lower(jwt email)" independente de
-- org_id — o usuário 'client' consegue ler a própria linha (role,
-- client_company) pra getAppUser() funcionar, sem enxergar mais nada.
--
--   users.client_company — preenchido só pra role='client': identifica
--   qual rede externa aquele login representa (hoje só "360 Service
--   Provider", mas o campo é genérico pra caber outra contratante no
--   futuro sem migration nova).
--
--   customers.client_company — mesma string, no cadastro do
--   cliente/loja em `customers`. Resolve o problema de agrupamento
--   "todas as ordens da 360" mesmo com cada loja podendo (em tese)
--   ser seu próprio customers.id: em vez de tentar adivinhar a
--   empresa a partir de service_order_issuer_name (é o CONTATO que
--   emitiu a ordem, ex. "Mariana Bloch" — uma pessoa, não uma
--   empresa, não serve pra agrupar), a coluna é populada por um valor
--   fixo no momento em que o customer é criado pelo próprio pipeline
--   de ordem de serviço (hoje 100% exclusivo da 360 — o PDF final já
--   assume isso, ver COMPANY_LINES em lib/service-orders/pdf.ts) e
--   por um backfill aqui embaixo pros que já existem. Uma ordem
--   pertence à 360 se seu customer_id aponta pra um customers.id com
--   este campo preenchido — nunca por nome de loja/local (esse
--   continua livre em service_order_location_name, só descritivo).
--
--   appointments.service_order_requested_date — o DIA que a 360
--   escolheu ao anexar a ordem pelo portal novo, antes de o admin
--   escolher profissional/horário. Guardado à parte de starts_at
--   (que nessas linhas recebe um horário-placeholder só pra satisfazer
--   a constraint NOT NULL/ends_at > starts_at da tabela — não é um
--   horário real) pra a UI do admin mostrar "dia pedido: X" sem
--   precisar reverter engenharia de um timestamp de meio-dia UTC.
--
-- Fluxo de "pendente de atribuição" (decisão registrada aqui porque
-- molda o schema): NÃO criamos tabela nova de "solicitações". O
-- pedido da 360 vira uma linha real em `appointments` — mesma
-- maquinaria de extração por IA, fotos, PDF, RLS de storage — só que
-- com employee_id NULL (nunca usado hoje fora do agendamento
-- conversacional do Receptionist, que também deixa employee_id NULL
-- por design, migration 026 comentário em
-- lib/receptionist/scheduling.ts) e source =
-- 'service_order_client_portal' (constante em
-- lib/portal-360/constants.ts) — é essa combinação (não status, que
-- fica no default 'scheduled' de propósito pra reaproveitar filtros
-- existentes) que identifica de forma exclusiva "pedido da 360 ainda
-- sem profissional/horário atribuído". O admin atribui pela MESMA
-- tela de "Reagendar" que já existe (AppointmentFormModal, mode
-- reschedule) — o formulário já teria employee_id/starts_at/ends_at
-- como campos obrigatórios, então salvar ali já completa a
-- atribuição sem rota nova. appointments.starts_at/ends_at são NOT
-- NULL (confirmado em migration 026) — daí o horário-placeholder.
-- ============================================================

alter table users
  add column if not exists client_company text;

comment on column users.client_company is
  'Preenchido só para role=''client'': nome da rede/empresa externa que este login representa (ex.: "360 Service Provider"). Usado para filtrar explicitamente, em código (nunca via RLS ampla — ver lib/portal-360/data.ts), quais customers/appointments este usuário pode ver. NULL nas demais roles.';

alter table customers
  add column if not exists client_company text;

create index if not exists customers_client_company_idx on customers(client_company) where client_company is not null;

comment on column customers.client_company is
  'Preenchido quando este customer representa (ou faz parte d)a rede de um cliente externo com portal próprio (ex.: "360 Service Provider" — Portal 360, migration 061). Todo appointment cujo customer_id aponta para um customers.id com este campo preenchido é visível/baixável pelo login correspondente em client_company. Populado automaticamente na criação (nunca via texto extraído por IA, que não é confiável para nome de empresa) + backfill abaixo para os que já existiam.';

-- Backfill: todo customer que já participou do pipeline de ordem de
-- serviço (tem pelo menos 1 appointment com arquivo de ordem anexado)
-- é, na prática de hoje, sempre um customer da 360 — o PDF final
-- (lib/service-orders/pdf.ts) já é gerado 100% como se fosse emitido
-- por ela, sem qualquer outro contratante usando esse fluxo ainda.
update customers
set client_company = '360 Service Provider'
where client_company is null
  and id in (
    select distinct customer_id
    from appointments
    where service_order_file_url is not null
  );

alter table appointments
  add column if not exists service_order_requested_date date;

comment on column appointments.service_order_requested_date is
  'Dia (sem hora) escolhido pela 360 ao anexar a ordem pelo Portal 360 (migration 061) — só profissional/horário exato ficam com o admin da Mawi. NULL em qualquer agendamento que não veio desse fluxo. starts_at/ends_at nessas linhas carregam um horário-placeholder (meio-dia local +1h) só para satisfazer a constraint NOT NULL da tabela, nunca um horário real — a UI do admin deve mostrar este campo, não starts_at, enquanto employee_id for NULL.';
