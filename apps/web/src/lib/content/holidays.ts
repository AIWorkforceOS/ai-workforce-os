// Datas comemorativas (pedido do Vinicius, 2026-08-23): o planejamento
// semanal do Gestor de Conteúdo verifica se algum dia da semana cai numa
// data comemorativa relevante — geral (Natal, Ano Novo, Black Friday...)
// ou específica do negócio (via instrução no prompt, ver generator.ts) —
// pra gerar um post pensado pra ocasião em vez do pilar de conteúdo normal.
//
// Calendário embutido (determinístico, sem depender de API externa paga):
// cobre as datas comerciais/comemorativas mais relevantes pros mercados
// BR e EUA (a maioria dos clientes da Alizo hoje). Datas específicas e
// obscuras do nicho do negócio ficam a cargo do próprio modelo, que já
// tem esse conhecimento geral — o calendário aqui é o piso confiável.

export type Holiday = { name: string; date: Date }

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day))
}

/** N-ésima ocorrência de um dia da semana num mês (weekday: 0=domingo..6=sábado, n: 1-based). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = utcDate(year, month, 1)
  const offset = (weekday - first.getUTCDay() + 7) % 7
  return utcDate(year, month, 1 + offset + (n - 1) * 7)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function startOfUtcDay(date: Date): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

const FIXED_HOLIDAYS: { name: string; month: number; day: number }[] = [
  { name: 'Ano Novo', month: 1, day: 1 },
  { name: "Dia dos Namorados nos EUA (Valentine's Day)", month: 2, day: 14 },
  { name: 'Dia Internacional da Mulher', month: 3, day: 8 },
  { name: 'Dia do Trabalho', month: 5, day: 1 },
  { name: 'Independência dos EUA (4 de julho)', month: 7, day: 4 },
  { name: 'Independência do Brasil', month: 9, day: 7 },
  { name: 'Dia do Cliente (Brasil)', month: 9, day: 15 },
  { name: 'Halloween', month: 10, day: 31 },
  { name: 'Véspera de Natal', month: 12, day: 24 },
  { name: 'Natal', month: 12, day: 25 },
  { name: 'Véspera de Ano Novo', month: 12, day: 31 },
]

const FLOATING_HOLIDAYS: { name: string; compute: (year: number) => Date }[] = [
  { name: 'Dia das Mães (Brasil e EUA)', compute: (y) => nthWeekdayOfMonth(y, 5, 0, 2) }, // 2º domingo de maio
  { name: "Dia dos Pais nos EUA (Father's Day)", compute: (y) => nthWeekdayOfMonth(y, 6, 0, 3) }, // 3º domingo de junho
  { name: 'Dia dos Pais no Brasil', compute: (y) => nthWeekdayOfMonth(y, 8, 0, 2) }, // 2º domingo de agosto
  { name: 'Thanksgiving (EUA)', compute: (y) => nthWeekdayOfMonth(y, 11, 4, 4) }, // 4ª quinta-feira de novembro
  { name: 'Black Friday', compute: (y) => addDays(nthWeekdayOfMonth(y, 11, 4, 4), 1) },
]

/** Todas as datas comemorativas embutidas dentro de um intervalo [start, end], inclusive, ordenadas por data. */
export function holidaysInRange(start: Date, end: Date): Holiday[] {
  const rangeStart = startOfUtcDay(start)
  const rangeEnd = startOfUtcDay(end)
  const results: Holiday[] = []

  for (let year = rangeStart.getUTCFullYear(); year <= rangeEnd.getUTCFullYear(); year++) {
    for (const h of FIXED_HOLIDAYS) {
      const date = utcDate(year, h.month, h.day)
      if (date >= rangeStart && date <= rangeEnd) results.push({ name: h.name, date })
    }
    for (const h of FLOATING_HOLIDAYS) {
      const date = h.compute(year)
      if (date >= rangeStart && date <= rangeEnd) results.push({ name: h.name, date })
    }
  }
  return results.sort((a, b) => a.date.getTime() - b.date.getTime())
}

/** A data comemorativa embutida que cai exatamente num dia, se houver. */
export function holidayOnDate(date: Date): Holiday | null {
  return holidaysInRange(date, date)[0] ?? null
}
