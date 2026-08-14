-- ============================================================
-- AI Workforce OS — Migration 63: Texto extraído dos PDFs da biblioteca
-- de materiais (employee_attachments, migrations 036/062)
--
-- Achado (auditoria 2026-08-14): buildAttachmentsContext (lib/attachments.ts)
-- só injeta título, tipo e usage_instructions (texto manual do dono) no
-- prompt do funcionário — o CONTEÚDO do PDF nunca era lido pelo modelo.
-- Um funcionário só sabia "quando" enviar um material (a instrução
-- escrita), nunca o que estava escrito dentro dele.
--
-- Reaproveita a mesma abordagem já usada pela extração de ordens de
-- serviço (lib/service-orders/extraction.ts): manda o PDF pra OpenAI via
-- content part nativo de arquivo (generateStructuredReplyFromPdf, sem
-- OCR/lib de parsing à parte) e pede o texto integral do documento —
-- ver extractAttachmentPdfText em lib/attachments.ts. Decisão deliberada
-- (ver diagnóstico): extração de texto simples, não RAG/embeddings — o
-- texto (truncado a um tamanho razoável antes de injetar, ver
-- ATTACHMENT_TEXT_MAX_CHARS) entra direto no mesmo prompt que já injeta
-- usage_instructions.
-- ============================================================

alter table employee_attachments
  add column if not exists extracted_text text;

comment on column employee_attachments.extracted_text is
  'Texto extraído do PDF por IA no momento do upload (ver extractAttachmentPdfText em lib/attachments.ts) — null para kind != pdf, ou quando a extração falhou (best-effort, nunca bloqueia o upload). Injetado (truncado) no prompt do funcionário junto com usage_instructions, ver buildAttachmentsContext.';
