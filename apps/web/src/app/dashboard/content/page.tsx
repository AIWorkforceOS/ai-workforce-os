import { createClient } from '@/lib/supabase/server'
import {
  Badge,
  type BadgeVariant,
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
import type { ContentPost, SocialAccount } from '@/lib/content/types'
import { ImageOff, Plus, Sparkles } from 'lucide-react'

export const dynamic = 'force-dynamic'

const STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'blue',
  scheduled: 'blue',
  published: 'green',
  rejected: 'slate',
  failed: 'red',
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  published: 'Publicado',
  rejected: 'Rejeitado',
  failed: 'Falhou',
}

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

export default async function ContentPage() {
  const supabase = await createClient()

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const [accountsRes, postsRes] = await Promise.all([
    supabase.from('social_accounts').select('*').order('created_at', { ascending: false }),
    supabase
      .from('content_posts')
      .select('*')
      .gte('created_at', thirtyDaysAgo)
      .order('created_at', { ascending: false })
      .limit(60),
  ])

  const accounts = (accountsRes.data ?? []) as SocialAccount[]
  const posts = (postsRes.data ?? []) as ContentPost[]
  const accountById = new Map(accounts.map((account) => [account.id, account]))

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
          <PrimaryButton href="/dashboard/content/connect" icon={<Plus size={14} />}>
            Conectar conta
          </PrimaryButton>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard label="Aguardando aprovação" value={String(pending.length)} hint="posts prontos, esperando sua decisão" />
        <KpiCard label="Publicados (30d)" value={String(published.length)} hint="foram ao ar no período" />
        <KpiCard label="Contas conectadas" value={String(accounts.length)} hint="Instagram/Facebook ativos" />
        <KpiCard label="Falhas (30d)" value={String(failed.length)} hint={failed.length > 0 ? 'confira o motivo no histórico' : undefined} />
      </div>

      {/* Fila de aprovação */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5">
          <CardHeader eyebrow="fila de aprovação" title="Posts aguardando sua decisão" />
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={<Sparkles size={22} className="text-white" />}
            title="Nada pendente agora"
            subtitle="Assim que uma conta estiver conectada em modo 'fila de aprovação', os posts gerados aparecem aqui todo dia para você aprovar, editar ou rejeitar."
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
                      <span className="text-xs text-slate-500">
                        {account?.page_name ?? ''} · {new Date(post.created_at).toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-200">{post.caption}</p>
                    {post.reasoning && <p className="mt-1.5 text-[11px] text-slate-500">{post.reasoning}</p>}
                  </div>
                  <div className="flex-shrink-0">
                    <ContentPostActions postId={post.id} initialCaption={post.caption} />
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
                        <Badge variant={STATUS_VARIANT[post.status] ?? 'slate'}>{STATUS_LABEL[post.status] ?? post.status}</Badge>
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
