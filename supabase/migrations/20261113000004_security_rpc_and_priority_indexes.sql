-- Segunda etapa da auditoria: RPCs financeiras exigem sessão e índices
-- dos módulos operacionais mais acessados.

revoke execute on function public.consolidate_invoices(uuid, uuid, uuid[], text, date) from public, anon;
grant execute on function public.consolidate_invoices(uuid, uuid, uuid[], text, date) to authenticated, service_role;

revoke execute on function public.generate_client_invoice(uuid, text, uuid[], text, date, text) from public, anon;
grant execute on function public.generate_client_invoice(uuid, text, uuid[], text, date, text) to authenticated, service_role;

revoke execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text, date) from public, anon;
grant execute on function public.generate_service_records_invoice(uuid, uuid, uuid[], text, date, text, date) to authenticated, service_role;

revoke execute on function public.register_service_record_payment(uuid, numeric, text) from public, anon;
grant execute on function public.register_service_record_payment(uuid, numeric, text) to authenticated, service_role;

create index if not exists employee_attachments_unit_idx on public.employee_attachments(unit_id);
create index if not exists education_attendance_unit_idx on public.education_attendance(unit_id);
create index if not exists education_class_sessions_subject_idx on public.education_class_sessions(subject_id);
create index if not exists education_class_sessions_teacher_idx on public.education_class_sessions(teacher_id);
create index if not exists education_class_sessions_unit_idx on public.education_class_sessions(unit_id);
create index if not exists education_cohorts_teacher_idx on public.education_cohorts(teacher_id);
create index if not exists education_cohorts_unit_idx on public.education_cohorts(unit_id);
create index if not exists education_diplomas_unit_idx on public.education_diplomas(unit_id);
create index if not exists education_documents_program_idx on public.education_documents(program_id);
create index if not exists education_documents_unit_idx on public.education_documents(unit_id);
create index if not exists education_enrollments_unit_idx on public.education_enrollments(unit_id);
create index if not exists education_programs_unit_idx on public.education_programs(unit_id);
create index if not exists education_students_unit_idx on public.education_students(unit_id);
create index if not exists education_subjects_unit_idx on public.education_subjects(unit_id);
create index if not exists education_teachers_unit_idx on public.education_teachers(unit_id);
