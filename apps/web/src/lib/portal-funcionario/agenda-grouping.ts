import { addDays } from '@/lib/calendar-dates'
import { todayInTimezone } from '@/lib/service-operations-month'

/** 'YYYY-MM-DD' de um ISO timestamp no fuso dado (en-CA formata exatamente assim). */
export function dayKeyInTimezone(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(iso))
}

/**
 * Separa os agendamentos em Hoje/Amanhã no fuso da unidade — a aba
 * Lista do portal do técnico mostra por padrão só essas duas seções
 * (pedido do dono do produto, depois de testar): agendamentos de outra
 * data qualquer continuam acessíveis pela aba Calendário, que já deixa
 * navegar mês a mês e selecionar um dia específico.
 */
export function groupAppointmentsByTodayTomorrow<T extends { starts_at: string }>(
  appointments: T[],
  timezone: string,
): { today: T[]; tomorrow: T[] } {
  const todayKey = todayInTimezone(timezone)
  const tomorrowKey = addDays(todayKey, 1)

  const today: T[] = []
  const tomorrow: T[] = []
  for (const appt of appointments) {
    const key = dayKeyInTimezone(appt.starts_at, timezone)
    if (key === todayKey) today.push(appt)
    else if (key === tomorrowKey) tomorrow.push(appt)
  }
  return { today, tomorrow }
}
