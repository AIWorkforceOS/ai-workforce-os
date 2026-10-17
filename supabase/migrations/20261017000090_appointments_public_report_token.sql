-- Link público do relatório fotográfico (2026-10-17): o cliente que recebe o PDF
-- (360) não tem login, então o PDF leva um botão "Download all photos & videos"
-- que abre /relatorio/<token> — página sem login onde ele vê, abre e baixa
-- (ZIP ou galeria do celular) todas as fotos e vídeos. O token é um UUID
-- aleatório por ordem (não adivinhável); trocar o valor desta coluna revoga o
-- link antigo. Mesmo padrão de job_openings.public_application_token (046).
-- Funcionário não consegue alterar: a coluna não está na allowlist do trigger
-- appointments_guard_employee_write.

alter table public.appointments
  add column if not exists public_report_token uuid not null default gen_random_uuid();

create unique index if not exists appointments_public_report_token_key
  on public.appointments (public_report_token);
