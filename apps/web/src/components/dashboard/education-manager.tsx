'use client'

import { useState, useTransition, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpen, CalendarDays, GraduationCap, School, UserRoundCheck, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

type Row = Record<string, unknown> & { id: string; name?: string }
type EducationData = Record<string, Row[]>
type Section = 'overview' | 'programs' | 'people' | 'cohorts' | 'classes' | 'documents'

const fieldClass = 'w-full rounded-xl border border-white/10 bg-[#0d1324] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500'
const buttonClass = 'rounded-xl bg-cyan-500 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50'

function text(row: Row, key: string) {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

export function EducationManager({ orgId, initialUnitId, units, readOnly, data }: {
  orgId: string
  initialUnitId: string
  units: { id: string; name: string }[]
  readOnly: boolean
  data: EducationData
}) {
  const router = useRouter()
  const [section, setSection] = useState<Section>('overview')
  const [unitId, setUnitId] = useState(initialUnitId)
  const [message, setMessage] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const programs = data.education_programs ?? []
  const teachers = data.education_teachers ?? []
  const students = data.education_students ?? []
  const cohorts = data.education_cohorts ?? []
  const enrollments = data.education_enrollments ?? []
  const sessions = data.education_class_sessions ?? []

  function switchUnit(next: string) {
    setUnitId(next)
    const url = new URL(window.location.href)
    url.searchParams.set('unit', next)
    router.push(url.pathname + url.search)
  }

  async function insert(table: string, payload: Record<string, unknown>, form: HTMLFormElement) {
    setMessage(null)
    const supabase = createClient()
    const { error } = await supabase.from(table).insert({ ...payload, org_id: orgId, unit_id: unitId })
    if (error) {
      setMessage(`Não foi possível salvar: ${error.message}`)
      return
    }
    form.reset()
    setMessage('Salvo com sucesso.')
    startTransition(() => router.refresh())
  }

  function submit(table: string, build: (form: FormData) => Record<string, unknown>) {
    return (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      const form = event.currentTarget
      void insert(table, build(new FormData(form)), form)
    }
  }

  const cards = [
    { label: 'Cursos', value: programs.length, icon: BookOpen },
    { label: 'Turmas', value: cohorts.length, icon: School },
    { label: 'Alunos', value: students.length, icon: Users },
    { label: 'Professores', value: teachers.length, icon: UserRoundCheck },
    { label: 'Matrículas', value: enrollments.length, icon: GraduationCap },
    { label: 'Aulas', value: sessions.length, icon: CalendarDays },
  ]

  const tabs: { id: Section; label: string }[] = [
    { id: 'overview', label: 'Resumo' }, { id: 'programs', label: 'Cursos e disciplinas' },
    { id: 'people', label: 'Alunos e professores' }, { id: 'cohorts', label: 'Turmas e matrículas' },
    { id: 'classes', label: 'Aulas e presença' }, { id: 'documents', label: 'Documentos e diplomas' },
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">Gestão escolar</p>
          <h1 className="mt-1 text-3xl font-black text-white">Escola e cursos</h1>
          <p className="mt-2 text-sm text-slate-400">Cursos, turmas, alunos, aulas, presença, documentos e conclusão em um só lugar.</p>
        </div>
        <label className="text-xs font-bold text-slate-400">Unidade
          <select value={unitId} onChange={(event) => switchUnit(event.target.value)} className={`${fieldClass} mt-1 min-w-52`}>
            {units.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}
          </select>
        </label>
      </header>

      <nav className="flex gap-2 overflow-x-auto pb-1" aria-label="Áreas da gestão escolar">
        {tabs.map((tab) => <button key={tab.id} onClick={() => setSection(tab.id)} className={`whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold ${section === tab.id ? 'bg-cyan-500 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`}>{tab.label}</button>)}
      </nav>

      {message ? <p role="status" className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-200">{message}</p> : null}
      {readOnly ? <p className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">Seu acesso é somente para consulta.</p> : null}

      {section === 'overview' ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{cards.map(({ label, value, icon: Icon }) => <div key={label} className="rounded-2xl border border-white/5 bg-[#141a2b] p-5"><Icon className="text-cyan-400" size={20} /><p className="mt-4 text-3xl font-black text-white">{value}</p><p className="text-sm text-slate-400">{label}</p></div>)}</div> : null}

      {section === 'programs' ? <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Novo curso"><form onSubmit={submit('education_programs', (f) => ({ name: f.get('name'), duration_months: Number(f.get('duration')) || null, total_hours: Number(f.get('hours')) || null, monthly_price: Number(f.get('price')) || null, completion_requirements: f.get('requirements') || null }))} className="space-y-3"><Input name="name" label="Nome do curso" required /><div className="grid grid-cols-3 gap-2"><Input name="duration" label="Meses" type="number" /><Input name="hours" label="Carga horária" type="number" /><Input name="price" label="Mensalidade" type="number" step="0.01" /></div><Input name="requirements" label="Regras para conclusão" /><Save disabled={readOnly || pending} /></form><List rows={programs} secondary={(row) => `${row.duration_months ?? '—'} meses · ${row.total_hours ?? '—'}h`} /></Panel>
        <Panel title="Nova disciplina"><form onSubmit={submit('education_subjects', (f) => ({ program_id: f.get('program_id'), name: f.get('name'), workload_hours: Number(f.get('hours')) || null }))} className="space-y-3"><Select name="program_id" label="Curso" rows={programs} /><Input name="name" label="Disciplina" required /><Input name="hours" label="Carga horária" type="number" /><Save disabled={readOnly || pending || programs.length === 0} /></form><List rows={data.education_subjects ?? []} secondary={(row) => `${row.workload_hours ?? '—'}h`} /></Panel>
      </div> : null}

      {section === 'people' ? <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Novo aluno"><form onSubmit={submit('education_students', (f) => ({ name: f.get('name'), email: f.get('email') || null, phone: f.get('phone') || null, document_number: f.get('document') || null, guardian_name: f.get('guardian') || null }))} className="space-y-3"><Input name="name" label="Nome completo" required /><Input name="email" label="E-mail" type="email" /><Input name="phone" label="Telefone" /><Input name="document" label="Documento" /><Input name="guardian" label="Responsável (se necessário)" /><Save disabled={readOnly || pending} /></form><List rows={students} secondary={(row) => text(row, 'email') || text(row, 'phone')} /></Panel>
        <Panel title="Novo professor"><form onSubmit={submit('education_teachers', (f) => ({ name: f.get('name'), email: f.get('email') || null, phone: f.get('phone') || null, specialties: String(f.get('specialties') ?? '').split(',').map((v) => v.trim()).filter(Boolean) }))} className="space-y-3"><Input name="name" label="Nome completo" required /><Input name="email" label="E-mail" type="email" /><Input name="phone" label="Telefone" /><Input name="specialties" label="Especialidades (separadas por vírgula)" /><Save disabled={readOnly || pending} /></form><List rows={teachers} secondary={(row) => Array.isArray(row.specialties) ? row.specialties.join(', ') : ''} /></Panel>
      </div> : null}

      {section === 'cohorts' ? <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Nova turma"><form onSubmit={submit('education_cohorts', (f) => ({ program_id: f.get('program_id'), teacher_id: f.get('teacher_id') || null, name: f.get('name'), start_date: f.get('start_date'), end_date: f.get('end_date') || null, capacity: Number(f.get('capacity')) || null, price_per_student: Number(f.get('price')) || null, status: 'planned' }))} className="space-y-3"><Select name="program_id" label="Curso" rows={programs} /><Select name="teacher_id" label="Professor principal" rows={teachers} optional /><Input name="name" label="Nome da turma" required /><div className="grid grid-cols-2 gap-2"><Input name="start_date" label="Início" type="date" required /><Input name="end_date" label="Fim" type="date" /></div><div className="grid grid-cols-2 gap-2"><Input name="capacity" label="Vagas" type="number" /><Input name="price" label="Valor por aluno" type="number" step="0.01" /></div><Save disabled={readOnly || pending || programs.length === 0} /></form><List rows={cohorts} secondary={(row) => `${row.start_date ?? ''} · ${row.status ?? ''}`} /></Panel>
        <Panel title="Nova matrícula"><form onSubmit={submit('education_enrollments', (f) => ({ cohort_id: f.get('cohort_id'), student_id: f.get('student_id'), agreed_price: Number(f.get('price')) || null }))} className="space-y-3"><Select name="cohort_id" label="Turma" rows={cohorts} /><Select name="student_id" label="Aluno" rows={students} /><Input name="price" label="Valor acordado" type="number" step="0.01" /><Save disabled={readOnly || pending || cohorts.length === 0 || students.length === 0} /></form><List rows={enrollments} secondary={(row) => String(row.status ?? '')} title={(row) => `${nameOf(students, row.student_id)} · ${nameOf(cohorts, row.cohort_id)}`} /></Panel>
      </div> : null}

      {section === 'classes' ? <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Registrar aula"><form onSubmit={submit('education_class_sessions', (f) => ({ cohort_id: f.get('cohort_id'), subject_id: f.get('subject_id') || null, teacher_id: f.get('teacher_id') || null, starts_at: f.get('starts_at'), ends_at: f.get('ends_at') || null, topic: f.get('topic') || null }))} className="space-y-3"><Select name="cohort_id" label="Turma" rows={cohorts} /><Select name="subject_id" label="Disciplina" rows={data.education_subjects ?? []} optional /><Select name="teacher_id" label="Professor" rows={teachers} optional /><Input name="starts_at" label="Início" type="datetime-local" required /><Input name="ends_at" label="Fim" type="datetime-local" /><Input name="topic" label="Conteúdo da aula" /><Save disabled={readOnly || pending || cohorts.length === 0} /></form><List rows={sessions} title={(row) => text(row, 'topic') || nameOf(cohorts, row.cohort_id)} secondary={(row) => new Date(String(row.starts_at)).toLocaleString('pt-BR')} /></Panel>
        <Panel title="Registrar presença"><form onSubmit={submit('education_attendance', (f) => ({ session_id: f.get('session_id'), student_id: f.get('student_id'), status: f.get('status'), notes: f.get('notes') || null }))} className="space-y-3"><Select name="session_id" label="Aula" rows={sessions} display={(row) => text(row, 'topic') || new Date(String(row.starts_at)).toLocaleString('pt-BR')} /><Select name="student_id" label="Aluno" rows={students} /><label className="block text-xs font-bold text-slate-400">Situação<select name="status" className={`${fieldClass} mt-1`}><option value="present">Presente</option><option value="absent">Falta</option><option value="excused">Falta justificada</option><option value="late">Atraso</option></select></label><Input name="notes" label="Observação" /><Save disabled={readOnly || pending || sessions.length === 0 || students.length === 0} /></form><List rows={data.education_attendance ?? []} title={(row) => nameOf(students, row.student_id)} secondary={(row) => String(row.status ?? '')} /></Panel>
      </div> : null}

      {section === 'documents' ? <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Registrar documento"><form onSubmit={submit('education_documents', (f) => ({ student_id: f.get('student_id') || null, program_id: f.get('program_id') || null, title: f.get('title'), document_type: f.get('type'), external_url: f.get('url') }))} className="space-y-3"><Input name="title" label="Título" required /><Input name="type" label="Tipo (RG, contrato, histórico...)" required /><Select name="student_id" label="Aluno" rows={students} optional /><Select name="program_id" label="Curso" rows={programs} optional /><Input name="url" label="Link seguro do documento" type="url" required /><Save disabled={readOnly || pending} /></form><List rows={data.education_documents ?? []} secondary={(row) => text(row, 'document_type')} /></Panel>
        <Panel title="Emitir diploma"><form onSubmit={submit('education_diplomas', (f) => ({ enrollment_id: f.get('enrollment_id'), serial_number: f.get('serial'), completion_date: f.get('completion_date'), total_hours: Number(f.get('hours')) || null, document_path: f.get('path') || null }))} className="space-y-3"><Select name="enrollment_id" label="Matrícula concluída" rows={enrollments} display={(row) => `${nameOf(students, row.student_id)} · ${nameOf(cohorts, row.cohort_id)}`} /><Input name="serial" label="Número de registro" required /><Input name="completion_date" label="Data de conclusão" type="date" required /><Input name="hours" label="Carga horária concluída" type="number" /><Input name="path" label="Caminho do arquivo (opcional)" /><Save disabled={readOnly || pending || enrollments.length === 0} /></form><List rows={data.education_diplomas ?? []} title={(row) => `Diploma ${text(row, 'serial_number')}`} secondary={(row) => String(row.completion_date ?? '')} /></Panel>
      </div> : null}
    </div>
  )
}

function Panel({ title, children }: { title: string; children: ReactNode }) { return <section className="rounded-2xl border border-white/5 bg-[#141a2b] p-5"><h2 className="mb-4 text-lg font-black text-white">{title}</h2>{children}</section> }
function Input({ label, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) { return <label className="block text-xs font-bold text-slate-400">{label}<input {...props} className={`${fieldClass} mt-1`} /></label> }
function Save({ disabled }: { disabled: boolean }) { return <button type="submit" disabled={disabled} className={buttonClass}>Salvar</button> }
function Select({ label, rows, optional = false, name, display }: { label: string; rows: Row[]; optional?: boolean; name: string; display?: (row: Row) => string }) { return <label className="block text-xs font-bold text-slate-400">{label}<select name={name} required={!optional} className={`${fieldClass} mt-1`}>{optional ? <option value="">Não informado</option> : null}{rows.map((row) => <option key={row.id} value={row.id}>{display?.(row) ?? row.name ?? row.id}</option>)}</select></label> }
function List({ rows, title, secondary }: { rows: Row[]; title?: (row: Row) => string; secondary?: (row: Row) => string }) { if (rows.length === 0) return <p className="mt-5 text-sm text-slate-500">Nenhum registro ainda.</p>; return <div className="mt-5 max-h-64 space-y-2 overflow-y-auto">{rows.map((row) => <div key={row.id} className="rounded-xl bg-white/[0.03] px-3 py-2"><p className="text-sm font-bold text-slate-200">{title?.(row) ?? row.name ?? row.id}</p>{secondary ? <p className="text-xs text-slate-500">{secondary(row)}</p> : null}</div>)}</div> }
function nameOf(rows: Row[], id: unknown) { return rows.find((row) => row.id === id)?.name ?? 'Registro' }
