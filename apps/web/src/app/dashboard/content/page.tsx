import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  PrimaryButton,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'
import { ContentPostActions } from '@/components/dashboard/content-post-actions'
import { ContentWeekActions } from '@/components/dashboard/content-week-actions'
import { ContentWeekView } from '@/components/dashboard/content-week-view'
import { BrandKitForm, type BrandKitValue } from '@/components/dashboard/brand-kit-form'
import { fullWeekDates, postingDaysFrom } from '@/lib/content/planner'
import { holidaysInRange } from '@/lib/content/holidays'
import { CONTENT_STATUS_LABEL, CONTENT_STATUS_VARIANT } from '@/lib/content/status-labels'
import type { ContentPost, SocialAccount } from '@/lib/content/types'
import type { AgentConfig, Unit } from '@/lib/types'
import { ImageOff, Paperclip, Plus, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

function platformLabel(platform: string): string {
  return platform === 'instagram' ? 'Instagram' : 'Facebook'
}

function KpiCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black tracking-tight text-white">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  )
}

/** Dia do post pra fins de calendário: scheduled_for (planejamento semanal) se houver, senão created_at (fluxo avulso). */
function postDateKey(post: ContentPost): string {
  const source = post.scheduled_for ?? post.created_at
  return new Date(source).toISOString().slice(0, 10)
}

function groupPostsByDay(posts: ContentPost[]): Map<string, ContentPost[]> {
  const map = new Map<string, ContentPost[]>()
  for (const post of posts) {
    const key = postDateKey(post)
    const bucket = map.get(key)
    if (bucket) bucket.push(post)
    else map.set(key, [post])
  }
  return map
}

export default async function ContentPage() {
  const supabase = await createClient()

  const { data: units } = await supabase.from('units').select('*').order('created_at', { ascending: true })
  const firstUnit = (units ?? [])[0] as Unit | undefined

  const [{ data: org }, { data: config }] = await Promise.all([
    firstUnit ? supabase.from('organizations').select('business_profile').eq('id', firstUnit.org_id).maybeSingle() : Promise.resolve({ data: null }),
    firstUnit
      ? supabase
          .from('agent_configs')
          .select('*')
          .eq('unit_id', firstUnit.id)
          .eq('agent_type', 'content_specialist')
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  const brandKit = ((org?.business_profile as { brand_kit?: BrandKitValue } | undefined)?.brand_kit as BrandKitValue | undefined) ?? null
  const postingDays = postingDaysFrom((config as AgentConfig | null)?.business_profile ?? {})

  const now = new Date()
  const thisWeek = fullWeekDates(now)
  const nextWeek = fullWeekDates(new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000))
  const holidays = holidaysInRange(thisWeek[0]!, nextWeek[6]!)
  const holidaysByDay = new Map(holidays.map((h) => [h.date.toISOString().slice(0, 10), h.name]))

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const calendarStart = thisWeek[0]!.toISOString()
  const calendarEnd = new Date(nextWeek[6]!.getTime() + 24 * 60 * 60 * 1000).toISOString()

  const [accountsRes, postsRes, calendarRes] = await Promise.all([
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false }),
    supabase
      .from('content_posts')
      .select('*')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(60),
    // Calendário: pega tanto quem tem scheduled_for no intervalo (planejamento semanal)
    // quanto quem foi criado no intervalo sem scheduled_for (fluxo avulso).
    supabase
      .from('content_posts')
      .select('*')
      .or(`and(scheduled_for.gte.${calendarStart},scheduled_for.lt.${calendarEnd}),and(scheduled_for.is.null,created_at.gte.${calendarStart},created_at.lt.${calendarEnd})`),
  ])

  const accounts = (accountsRes.data ?? []) as SocialAccount[]
  const posts = (postsRes.data ?? []) as ContentPost[]
  const calendarPosts = (calendarRes.data ?? []) as ContentPost[]
  const accountById = new Map(accounts.map((account) => [account.id, account]))

  const thisWeekKeys = new Set(thisWeek.map((d) => d.toISOString().slice(0, 10)))
  const thisWeekPosts = calendarPosts.filter((p) => thisWeekKeys.has(postDateKey(p)))
  const nextWeekPosts = calendarPosts.filter((p) => !thisWeekKeys.has(postDateKey(p)))
  const postsByDayThisWeek = groupPostsByDay(thisWeekPosts)
  const postsByDayNextWeek = groupPostsByDay(nextWeekPosts)

  const pending = posts.filter((post) => post.status === 'pending_approval')
  const published = posts.filter((post) => post.status === 'published')
  const failed = posts.filter((post) => post.status === 'failed')
  const history = posts.filter((post) => post.status !== 'pending_approval')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="funcionário digital"
        title="Gestor de Conteúdo"
        subtitle="Ele gera posts com legenda e imagem para o Instagram e o Facebook — sozinho ou passando por sua aprovação, do jeito que você configurar."
        action={
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/equipe-digital/recursos?unit=${firstUnit?.id ?? ''}&employee=content_specialist`}
              className="flex items-center gap-1.5 rounded-xl border border-white/10 px-3.5 py-2 text-xs font-bold text-slate-300 transition-colors hover:bg-white/5"
            >
              <Paperclip size={12} /> Anexar criativos de referência
            </Link>
            <PrimaryButton href="/dashboard/content/connect" icon={<Plus size={14} />}>
              Conectar conta
            </PrimaryButton>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Aguardando aprovação" value={String(pending.length)} hint="posts prontos, esperando sua decisão" />
        <KpiCard label="Publicados (30d)" value={String(published.length)} hint="foram ao ar no período" />
        <KpiCard label="Contas conectadas" value={String(accounts.length)} hint="Instagram/Facebook ativos" />
        <KpiCard label="Falhas (30d)" value={String(failed.length)} hint={failed.length > 0 ? 'confira o motivo no histórico' : undefined} />
      </div>

      {firstUnit && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
          <ContentWeekActions unitId={firstUnit.id} initialPostingDays={postingDays} />
          <BrandKitForm unitId={firstUnit.id} initial={brandKit} />
        </div>
      )}

      <ContentWeekView title="Esta semana" days={thisWeek} postsByDay={postsByDayThisWeek} holidaysByDay={holidaysByDay} />
      {nextWeekPosts.length > 0 && (
        <ContentWeekView title="Semana que vem (já planejada)" days={nextWeek} postsByDay={postsByDayNextWeek} holidaysByDay={holidaysByDay} />
      )}

      {/* Fila de aprovação */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="fila de aprovação" title="Posts aguardando sua decisão" />
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} className="text-white" />}
            title="Nada pendente agora"
            subtitle="Clique em &quot;Criar conteúdo agora&quot; ou &quot;Gerar planejamento semanal&quot; acima, ou espere o próximo ciclo automático — os posts gerados em modo &quot;fila de aprovação&quot; aparecem aqui."
          />
        ) : (
          <div className="flex flex-col">
            {pending.map((post) => {
              const account = accountById.get(post.social_account_id)
              return (
                <div
                  key={post.id}
                  className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start"
                  style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <div className="flex-shrink-0">
                    {post.image_url ? (
                      <img
                        src={post.image_url}
                        alt="Imagem gerada para o post"
                        className="h-32 w-32 rounded-xl object-cover"
                        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                      />
                    ) : (
                      <div
                        className="flex h-32 w-32 items-center justify-center rounded-xl"
                        style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
                      >
                        <ImageOff size={20} className="text-slate-600" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="cyan">{platformLabel(post.platform)}</Badge>
                      {post.content_pillar && <Badge variant="purple">{post.content_pillar}</Badge>}
                      {post.scheduled_for && (
                        <Badge variant="blue">Agendado {new Date(post.scheduled_for).toLocaleDateString('pt-BR')}</Badge>
                      )}
                      <span className="text-xs text-slate-500">
                        {account?.page_name ?? ''} · {new Date(post.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{post.caption}</p>
                    {post.reasoning && <p className="mt-1.5 text-[11px] text-slate-500">{post.reasoning}</p>}
                  </div>
                  <div className="flex-shrink-0">
                    <ContentPostActions postId={post.id} initialCaption={post.caption} scheduledFor={post.scheduled_for} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Histórico */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="calendário de conteúdo" title="Histórico de posts" />
        </div>
        {history.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} className="text-white" />}
            title="Nenhum post ainda"
            subtitle="Assim que o funcionário começar a gerar posts, o histórico completo (publicados, rejeitados, com falha) aparece aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <TableShell>
                <Th>Quando</Th>
                <Th>Conta</Th>
                <Th>Plataforma</Th>
                <Th>Status</Th>
                <Th>Legenda</Th>
              </TableShell>
              <tbody>
                {history.map((post) => {
                  const account = accountById.get(post.social_account_id)
                  return (
                    <Tr key={post.id}>
                      <Td className="text-slate-400">{new Date(post.created_at).toLocaleString('pt-BR')}</Td>
                      <Td className="text-slate-400">{account?.page_name ?? '—'}</Td>
                      <Td className="text-slate-400">{platformLabel(post.platform)}</Td>
                      <Td>
                        <Badge variant={CONTENT_STATUS_VARIANT[post.status] ?? 'slate'}>{CONTENT_STATUS_LABEL[post.status] ?? post.status}</Badge>
                        {post.error_message && <p className="mt-1 max-w-md text-[11px] text-red-400">{post.error_message}</p>}
                      </Td>
                      <Td className="max-w-md truncate text-slate-300">{post.caption}</Td>
                    </Tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
