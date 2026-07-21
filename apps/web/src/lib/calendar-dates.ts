// Helper de calendário puro usado pela tela de agendamento (server page e
// componentes client) — soma/subtrai dias de uma data 'YYYY-MM-DD' sem
// depender de fuso horário local do processo.

export function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number) as [number, number, number]
  const cursor = new Date(Date.UTC(year, month - 1, day + days))
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`
}
