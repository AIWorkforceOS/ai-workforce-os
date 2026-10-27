alter table public.content_posts
  drop column if exists instruction_cta,
  drop column if exists instruction_format_reason,
  drop column if exists instruction_objective,
  drop column if exists instruction_id;
drop table if exists public.content_instruction_history;
drop table if exists public.content_instructions;
