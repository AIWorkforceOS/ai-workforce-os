const WEEKDAY_LABEL = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function LeadsByDayChart({ counts }: { counts: { date: string; count: number }[] }) {
  const max = Math.max(1, ...counts.map((c) => c.count))

  return (
    <div className="flex items-end gap-3 px-1">
      {counts.map((day) => {
        const date = new Date(`${day.date}T00:00:00`)
        const heightPct = (day.count / max) * 100
        return (
          <div key={day.date} className="flex flex-1 flex-col items-center gap-2">
            <span className="text-xs font-medium text-gray-700">{day.count}</span>
            <div className="flex h-32 w-full items-end rounded bg-gray-50">
              <div
                className="w-full rounded bg-gray-900"
                style={{ height: `${Math.max(4, heightPct)}%` }}
              />
            </div>
            <span className="text-xs text-gray-400">{WEEKDAY_LABEL[date.getDay()]}</span>
          </div>
        )
      })}
    </div>
  )
}
