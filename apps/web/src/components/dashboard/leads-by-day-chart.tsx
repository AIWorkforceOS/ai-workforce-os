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
            <span className="text-xs font-medium text-slate-400">{day.count}</span>
            <div className="flex h-32 w-full items-end rounded" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <div
                className="w-full rounded"
                style={{
                  height: `${Math.max(4, heightPct)}%`,
                  background: 'linear-gradient(180deg, #06b6d4 0%, #4361ee 100%)',
                  boxShadow: '0 0 8px rgba(6,182,212,0.3)',
                }}
              />
            </div>
            <span className="text-xs text-slate-500">{WEEKDAY_LABEL[date.getDay()]}</span>
          </div>
        )
      })}
    </div>
  )
}
