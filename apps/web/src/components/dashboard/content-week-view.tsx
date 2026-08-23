import { Badge, Card, CardHeader } from '@/components/ui/dashboard-ui'
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_VARIANT } from '@/lib/content/status-labels'
import type { ContentPost } from '@/lib/content/types'

// Calendário semanal do Gestor de Conteúdo (pedido do Vinicius,
// 2026-08-23): mostra todos os posts da semana, um por dia, sem precisar
// abrir a fila de aprovação pra ver o panorama. `days` sempre tem 7 datas
// (segunda a domingo, ver lib/content/planner.ts).

const WEEKDAY_LABELS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom']

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function platformLabel(platform: string): string {
  return platform === 'instagram' ? 'Instagram' : 'Facebook'
}

export function ContentWeekView({
  title,
  days,
  postsByDay,
  holidaysByDay,
}: {
  title: string
  days: Date[]
  postsByDay: Map<string, ContentPost[]>
  holidaysByDay: Map<string, string>
}) {
  const todayKey = dateKey(new Date())

  return (
    <Card className="overflow-hidden">
      <div className="px-6 pt-5">
        <CardHeader eyebrow="calendário de conteúdo" title={title} />
      </div>
      <div className="overflow-x-auto p-4">
        <div className="grid min-w-[980px] grid-cols-7 gap-2.5">
          {days.map((date, i) => {
            const key = dateKey(date)
            const posts = postsByDay.get(key) ?? []
            const holiday = holidaysByDay.get(key)
            const isToday = key === todayKey

            return (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-xl p-2.5"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: isToday ? '1px solid rgba(6,182,212,0.4)' : '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <div>
                  <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">{WEEKDAY_LABELS[i]}</p>
                  <p className="text-sm font-black text-white">
                    {date.getUTCDate().toString().padStart(2, '0')}/{(date.getUTCMonth() + 1).toString().padStart(2, '0')}
                  </p>
                  {holiday && (
                    <p className="mt-0.5 truncate text-[9px] font-bold text-amber-400" title={holiday}>
                      🎉 {holiday}
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  {posts.length === 0 ? (
                    <p className="text-[10px] text-slate-600">—</p>
                  ) : (
                    posts.map((post) => (
                      <div key={post.id} className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex flex-wrap items-center gap-1">
                          <Badge variant={CONTENT_STATUS_VARIANT[post.status] ?? 'slate'}>
                            {CONTENT_STATUS_LABEL[post.status] ?? post.status}
                          </Badge>
                          <span className="text-[9px] font-bold text-slate-500">{platformLabel(post.platform)}</span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-slate-400">{post.caption}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </Card>
  )
}
