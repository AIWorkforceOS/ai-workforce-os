# Faturamento por cliente (22/10/2026)

**Pedido:** separar o faturamento por cliente, com o total do mês embaixo. Cada ordem tem o seu vencimento (ex.: Net 15 → o administrador informa 15 dias ao finalizar); o sistema lembra um dia antes e no dia para enviar a invoice das ordens com vencimento naquela data; **uma invoice separada por cliente**. Lembrete manual no primeiro momento.

## O que existe
- **Operação → "Lançar serviço executado"** (onde a ordem é finalizada financeiramente): novo campo **Vencimento (envio da invoice)** com atalhos **Net 15 / 30 / 45 / 60** (data do serviço + N dias), data livre e, se o cliente tem outro prazo padrão, o botão "Padrão do cliente: Net N".
- **Clientes Facility:** campo **Prazo padrão de pagamento (dias)** por cliente (livre; atalhos 15/30/45/60).
- **Financeiro → Faturamento por cliente** (por unidade, mês a mês):
  - **Lembretes manuais** no topo: "Atrasadas", "Vencem hoje" e "Vencem amanhã", agrupados por cliente e data, cada grupo com o botão **Gerar invoice deste cliente**.
  - Um bloco **por cliente**: ordens do mês com valor, vencimento editável (data ou Net 15/30/45/60) e situação (A faturar / INV-xxxx / Recebida); totais do cliente (total, a faturar, faturado, recebido); botão para gerar a invoice com as ordens marcadas.
  - **Total faturamento do mês** embaixo (total, a faturar, faturado, recebido e quebra por cliente).
- **Uma invoice por cliente:** a função `generate_client_invoice` reúne as ordens de **todas as lojas/cadastros do cliente** numa só invoice (rascunho), cobrada do cadastro do cliente; recusa misturar clientes, ordem já faturada ou sem valor. A invoice nasce em rascunho e segue o fluxo de sempre (PDF e envio na Operação) — **o padrão da invoice não muda**.

## Migration 102 (aditiva; validada em produção em transação desfeita; NÃO aplicada até autorização)
`service_records.due_date`, `client_company_profiles.payment_terms_days` (0–365) e a função `generate_client_invoice`. Rollback: `supabase/rollbacks/20261022_102_billing_by_client_rollback.sql`.
**Ordem:** aplicar a 102 ANTES de publicar o código (o formulário da Operação passa a gravar o vencimento).

## Fora desta etapa
Lembrete automático (e-mail/WhatsApp ao administrador) — deixado manual de propósito. A data do vencimento hoje é a de **envio da invoice**, como descrito; se depois a invoice precisar de "vencimento de pagamento" à parte, é um segundo campo.
