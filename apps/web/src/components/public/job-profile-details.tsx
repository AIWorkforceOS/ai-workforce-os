import { MapPin, GraduationCap, Wallet, Clock, CalendarDays, CalendarClock } from 'lucide-react'
import type { JobProfile } from '@/lib/recruiter/types'

type Locale = 'pt' | 'en'

const MODALITY_LABEL: Record<Locale, Record<string, string>> = {
  pt: { presencial: 'Presencial', hibrido: 'Híbrido', remoto: 'Remoto' },
  en: { presencial: 'On-site', hibrido: 'Hybrid', remoto: 'Remote' },
}

const COPY: Record<
  Locale,
  {
    location: string
    course: string
    scholarship: string
    schedule: string
    startDate: string
    deadline: string
    experience: string
    hardSkills: string
    tools: string
    languages: string
    competencies: string
    softSkills: string
  }
> = {
  pt: {
    location: 'Local',
    course: 'Curso',
    scholarship: 'Bolsa',
    schedule: 'Horário',
    startDate: 'Início',
    deadline: 'Prazo para contratação',
    experience: 'Experiência esperada',
    hardSkills: 'Hard skills',
    tools: 'Ferramentas',
    languages: 'Idiomas',
    competencies: 'Competências',
    softSkills: 'Soft skills',
  },
  en: {
    location: 'Location',
    course: 'Field of study',
    scholarship: 'Compensation',
    schedule: 'Schedule',
    startDate: 'Start date',
    deadline: 'Hiring deadline',
    experience: 'Expected experience',
    hardSkills: 'Hard skills',
    tools: 'Tools',
    languages: 'Languages',
    competencies: 'Competencies',
    softSkills: 'Soft skills',
  },
}

function ordinal(n: number, locale: Locale): string {
  if (locale === 'pt') return `${n}º`
  const v = n % 100
  if (v >= 11 && v <= 13) return `${n}th`
  switch (n % 10) {
    case 1:
      return `${n}st`
    case 2:
      return `${n}nd`
    case 3:
      return `${n}rd`
    default:
      return `${n}th`
  }
}

function formatSemesterRange(min: number | null | undefined, max: number | null | undefined, locale: Locale): string | null {
  if (min && max) {
    return locale === 'pt' ? `${ordinal(min, locale)} ao ${ordinal(max, locale)} semestre` : `${ordinal(min, locale)}–${ordinal(max, locale)} semester`
  }
  if (min) {
    return locale === 'pt' ? `a partir do ${ordinal(min, locale)} semestre` : `from ${ordinal(min, locale)} semester`
  }
  if (max) {
    return locale === 'pt' ? `até o ${ordinal(max, locale)} semestre` : `up to ${ordinal(max, locale)} semester`
  }
  return null
}

function formatDeadline(value: string, locale: Locale): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return locale === 'pt'
    ? date.toLocaleDateString('pt-BR')
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

type Fact = { icon: typeof MapPin; label: string; value: string }

export function JobProfileDetails({
  profile,
  hiringDeadline,
  locale,
}: {
  profile: JobProfile
  hiringDeadline: string | null
  locale: Locale
}) {
  const t = COPY[locale]

  const facts: Fact[] = []

  const modalityLabel = profile.modality ? (MODALITY_LABEL[locale][profile.modality] ?? profile.modality) : null
  const locationParts = [profile.city, modalityLabel].filter((v): v is string => Boolean(v))
  if (locationParts.length) facts.push({ icon: MapPin, label: t.location, value: locationParts.join(' · ') })

  const semesterText = formatSemesterRange(profile.semester_min, profile.semester_max, locale)
  const courseParts = [profile.course, semesterText].filter((v): v is string => Boolean(v))
  if (courseParts.length) facts.push({ icon: GraduationCap, label: t.course, value: courseParts.join(' — ') })

  if (profile.scholarship) facts.push({ icon: Wallet, label: t.scholarship, value: profile.scholarship })
  if (profile.schedule) facts.push({ icon: Clock, label: t.schedule, value: profile.schedule })
  if (profile.start_date) facts.push({ icon: CalendarDays, label: t.startDate, value: profile.start_date })
  if (hiringDeadline) facts.push({ icon: CalendarClock, label: t.deadline, value: formatDeadline(hiringDeadline, locale) })

  const skillGroups = [
    { label: t.hardSkills, items: profile.hard_skills },
    { label: t.tools, items: profile.tools },
    { label: t.languages, items: profile.languages },
    { label: t.competencies, items: profile.competencies },
    { label: t.softSkills, items: profile.soft_skills },
  ].filter((g): g is { label: string; items: string[] } => Boolean(g.items && g.items.length > 0))

  const hasAnything = Boolean(profile.ideal_profile_summary) || facts.length > 0 || Boolean(profile.experience) || skillGroups.length > 0
  if (!hasAnything) return null

  return (
    <div className="mt-6 flex flex-col gap-6">
      {profile.ideal_profile_summary && (
        <p className="text-[15px] leading-relaxed text-slate-300">{profile.ideal_profile_summary}</p>
      )}

      {facts.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="flex items-start gap-2.5 rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              <fact.icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-cyan-400" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{fact.label}</p>
                <p className="text-sm text-slate-200">{fact.value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {profile.experience && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{t.experience}</p>
          <p className="mt-1 text-sm leading-relaxed text-slate-300">{profile.experience}</p>
        </div>
      )}

      {skillGroups.length > 0 && (
        <div className="flex flex-col gap-3">
          {skillGroups.map((group) => (
            <div key={group.label}>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{group.label}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-cyan-200"
                    style={{ background: 'rgba(6,182,212,0.12)' }}
                  >
                    {item}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
