-- E-mail de prospecção do Sales Rep: preview + edição de layout (2026-08-17).
-- Vinicius pediu pra ver como o e-mail chega pro lead e poder ajustar sem
-- mexer em código. O TEXTO continua 100% gerado pela IA por lead (não é um
-- template fixo pra travar) — o que fica editável aqui é só o WRAPPER visual
-- fixo (buildBrandedEmailHtml em lib/email.ts): cor de destaque e uma nota
-- extra no rodapé. null preserva o visual padrão atual (nada muda pra quem
-- não configurar).
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "email_accent_color" text;
ALTER TABLE "units" ADD COLUMN IF NOT EXISTS "email_footer_note" text;
