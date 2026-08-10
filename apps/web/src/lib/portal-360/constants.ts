/**
 * Portal 360 (migration 061) — login único e compartilhado para a
 * rede 360 Service Provider anexar ordens de serviço e acompanhar
 * status/fotos/PDF. Constantes compartilhadas entre as rotas de API,
 * as páginas do portal e o código do dashboard admin que precisa
 * reconhecer uma linha vinda desse fluxo (calendar-view.tsx).
 */

/** appointments.source para uma linha criada pelo Portal 360 — junto com employee_id NULL, é o sinal exclusivo de "pedido da 360 ainda sem profissional/horário atribuído" (ver migration 061). */
export const CLIENT_PORTAL_SOURCE = 'service_order_client_portal'

/**
 * Único client_company em uso hoje. O pipeline de ordem de serviço
 * inteiro (extração por IA, PDF final) já é 100% modelado em cima da
 * 360 — não há outro contratante usando esse fluxo. Usado tanto no
 * backfill (migration 061) quanto para marcar novos customers criados
 * por esse mesmo pipeline (ver bulk-service-order-import-modal.tsx).
 */
export const DEFAULT_CLIENT_COMPANY_NAME = '360 Service Provider'
