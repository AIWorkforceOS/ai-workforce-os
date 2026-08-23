import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  AlertBanner,
  Badge,
  type BadgeVariant,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
  TableShell,
  Td,
  Th,
  Tr,
} from '@/components/ui/dashboard-ui'
import { SeoContentItemActions } from '@/components/dashboard/seo-content-item-actions'
import { SeoGbpChecklist } from '@/components/dashboard/seo-gbp-checklist'
import { SeoKeywordTracker, type TrackedKeywordRow } from '@/components/dashboard/seo-keyword-tracker'
import { SeoAuditRunButton } from '@/components/dashboard/seo-audit-run-button'
import { SeoGscOAuthBanner, SeoGscSitePicker } from '@/components/dashboard/seo-gsc-site-picker'
import { GBP_CHECKLIST_ITEMS } from '@/lib/seo/gbp-checklist'
import { getSerpApiKey } from '@/lib/seo/rank-tracking'
import { getGoogleSearchConsoleCredentials } from '@/lib/seo/search-console-oauth'
import { siteUrlFrom } from '@/lib/seo/planner'
import type {
  SeoAudit,
  SeoContentItem,
  SeoGbpChecklistState,
  SeoGscOAuthSession,
  SeoKeyword,
  SeoKeywordRanking,
  SeoSearchConsoleAccount,
  SeoSearchConsoleSnapshot,
} from '@/lib/seo/types'
import type { AgentConfig, Unit } from '@/lib/types'
import { AlertTriangle, ExternalLink, FileText, Gauge, ImageOff, Link2, MapPin, Megaphone, MousePointerClick, Search, Sparkles, TrendingUp } from 'lucide-react'

export const dynamic = 'force-dynamic'

const CHECK_STATUS_VARIANT: Record<string, BadgeVariant> = { pass: 'green', warning: 'amber', fail: 'red' }
const CHECK_STATUS_LABEL: Record<string, string> = { pass: 'OK', warning: 'Atenção', fail: 'Problema' }

const CONTENT_TYPE_VARIANT: Record<string, BadgeVariant> = {
  blog: 'cyan',
  landing_page: 'blue',
  gbp_description: 'purple',
  gbp_post: 'purple',
}
const CONTENT_TYPE_LABEL: Record<string, string> = {
  blog: 'Post de blog',
  landing_page: 'Landing page',
  gbp_description: 'Descrição do GBP',
  gbp_post: 'Post de atualização (GBP)',
}

const CONTENT_STATUS_VARIANT: Record<string, BadgeVariant> = { pending_approval: 'amber', approved: 'green', rejected: 'slate' }
const CONTENT_STATUS_LABEL: Record<string, string> = { pending_approval: 'Aguardando aprovação', approved: 'Aprovado', rejected: 'Rejeitado' }

export default async function SeoPage({
  searchParams,
}: {
  searchParams: Promise<{ oauth_session?: string; oauth_success?: string; oauth_error?: string }>
}) {
  const { oauth_session: oauthSessionId, oauth_success: oauthSuccess, oauth_error: oauthError } = await searchParams
  const supabase = await createClient()

  const { data: units } = await supabase.from('units').select('*').order('created_at', { ascending: true })
  const unitRows = (units ?? []) as Unit[]
  const primaryUnit = unitRows[0] ?? null

  if (!primaryUnit) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="funcionário digital" title="Especialista em SEO" subtitle="Crie uma unidade primeiro para contratar este funcionário." />
      </div>
    )
  }

  const [
    { data: configRow },
    { data: audits },
    { data: contentItems },
    { data: checklistState },
    { data: keywordRows },
    { data: gscAccountRow },
    { data: gscSnapshots },
    gscOauthSession,
  ] = await Promise.all([
    supabase.from('agent_configs').select('*').eq('unit_id', primaryUnit.id).eq('agent_type', 'seo_specialist').maybeSingle(),
    supabase.from('seo_audits').select('*').eq('unit_id', primaryUnit.id).order('created_at', { ascending: false }).limit(1),
    supabase.from('seo_content_items').select('*').order('created_at', { ascending: false }).limit(60),
    supabase.from('seo_gbp_checklist_state').select('*').eq('unit_id', primaryUnit.id),
    supabase.from('seo_keywords').select('*').eq('unit_id', primaryUnit.id).order('created_at', { ascending: true }),
    supabase.from('seo_search_console_accounts').select('*').eq('unit_id', primaryUnit.id).maybeSingle(),
    supabase.from('seo_search_console_snapshots').select('*').eq('unit_id', primaryUnit.id).order('created_at', { ascending: false }).limit(1),
    oauthSessionId
      ? supabase.from('seo_gsc_oauth_sessions').select('*').eq('id', oauthSessionId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const gscAccount = gscAccountRow as SeoSearchConsoleAccount | null
  const latestGscSnapshot = ((gscSnapshots ?? [])[0] ?? null) as SeoSearchConsoleSnapshot | null
  const pendingGscSession = gscOauthSession.data as SeoGscOAuthSession | null
  const gscOauthEnabled = getGoogleSearchConsoleCredentials() !== null

  const config = configRow as AgentConfig | null
  const latestAudit = ((audits ?? [])[0] ?? null) as SeoAudit | null
  const items = (contentItems ?? []) as SeoContentItem[]
  const checklistDoneKeys = ((checklistState ?? []) as SeoGbpChecklistState[]).filter((row) => row.is_done).map((row) => row.item_key)
  const keywords = (keywordRows ?? []) as SeoKeyword[]

  let rankingRows: SeoKeywordRanking[] = []
  if (keywords.length > 0) {
    const { data: rankings } = await supabase
      .from('seo_keyword_rankings')
      .select('*')
      .in(
        'keyword_id',
        keywords.map((k) => k.id),
      )
      .order('checked_at', { ascending: false })
    rankingRows = (rankings ?? []) as SeoKeywordRanking[]
  }
  const latestRankingByKeyword = new Map<string, SeoKeywordRanking>()
  for (const ranking of rankingRows) {
    if (!latestRankingByKeyword.has(ranking.keyword_id)) latestRankingByKeyword.set(ranking.keyword_id, ranking)
  }
  const trackedKeywords: TrackedKeywordRow[] = keywords.map((k) => {
    const latest = latestRankingByKeyword.get(k.id) ?? null
    return { id: k.id, keyword: k.keyword, latestPosition: latest?.position ?? null, latestCheckedAt: latest?.checked_at ?? null }
  })

  const siteUrl = siteUrlFrom(config?.business_profile)
  const pending = items.filter((item) => item.status === 'pending_approval')
  const history = items.filter((item) => item.status !== 'pending_approval')
  const gbpTexts = items.filter((item) => item.content_type === 'gbp_description' || item.content_type === 'gbp_post')
  const failedChecks = (latestAudit?.checks ?? []).filter((c) => c.status === 'fail').length
  const serpConfigured = Boolean(getSerpApiKey())

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="funcionário digital"
        title="Especialista em SEO"
        subtitle="Auditoria técnica real do site, conteúdo otimizado (blog/landing), Google Business Profile e acompanhamento de palavra-chave — sem prometer o que nenhuma IA entrega de verdade: colocar sua empresa no topo do Google depende de tempo, conteúdo e backlinks."
      />

      <SeoGscOAuthBanner success={oauthSuccess ?? null} error={oauthError ?? null} />
      {pendingGscSession && pendingGscSession.site_urls.length > 0 && (
        <SeoGscSitePicker sessionId={pendingGscSession.id} siteUrls={pendingGscSession.site_urls} />
      )}

      {!config || !siteUrl ? (
        <EmptyState
          icon={<Search size={22} className="text-white" />}
          title="Ainda sem site cadastrado"
          subtitle="Complete a entrevista de contratação do Especialista em SEO (em Equipe Digital) informando a URL do site — é a partir dela que a auditoria e o conteúdo são gerados."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Nota da auditoria" value={latestAudit ? `${latestAudit.score}/100` : '—'} sub={latestAudit ? new Date(latestAudit.created_at).toLocaleDateString('pt-BR') : 'ainda não rodou'} icon={<Gauge size={16} className="text-white" />} />
            <KpiCard label="Problemas encontrados" value={String(failedChecks)} sub="itens marcados como falha" icon={<AlertTriangle size={16} className="text-white" />} gradient="from-amber-400 to-orange-500" />
            <KpiCard label="Conteúdo aguardando" value={String(pending.length)} sub="pronto para você decidir" icon={<FileText size={16} className="text-white" />} />
            <KpiCard label="Palavras-chave acompanhadas" value={String(keywords.length)} sub={serpConfigured ? 'checagem automática ativa' : 'checagem automática não configurada'} icon={<Search size={16} className="text-white" />} gradient="from-purple-400 to-indigo-500" />
          </div>

          {/* Desempenho real (Google Search Console) */}
          <Card className="overflow-hidden p-6">
            <CardHeader
              eyebrow="dados reais do google"
              title="Desempenho de busca (Search Console)"
              action={
                !gscAccount && gscOauthEnabled ? (
                  <a
                    href={`/api/seo/gsc/oauth/start?unit_id=${primaryUnit.id}`}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-black text-white"
                    style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
                  >
                    <Link2 size={13} /> Conectar Google Search Console
                  </a>
                ) : null
              }
            />
            {!gscOauthEnabled ? (
              <AlertBanner
                tone="warning"
                icon={<AlertTriangle size={16} className="text-white" />}
                title="Conexão com o Search Console não configurada"
                description="O time da Alizo ainda precisa configurar as credenciais do Google para este recurso ficar disponível."
              />
            ) : !gscAccount ? (
              <EmptyState
                icon={<TrendingUp size={22} className="text-white" />}
                title="Ainda não conectado"
                subtitle="Conecte a conta Google que já tem este site verificado no Search Console para ver cliques, impressões e posição média REAIS — dado oficial do Google, atualizado semanalmente."
              />
            ) : gscAccount.connection_status === 'error' ? (
              <AlertBanner
                tone="warning"
                icon={<AlertTriangle size={16} className="text-white" />}
                title="Erro na conexão com o Search Console"
                description={gscAccount.connection_error ?? 'Não foi possível renovar o acesso — reconecte pelo botão acima.'}
              />
            ) : !latestGscSnapshot ? (
              <EmptyState icon={<TrendingUp size={22} className="text-white" />} title="Conectado — dados chegam em breve" subtitle={`Propriedade: ${gscAccount.site_url}. A primeira coleta acontece no próximo ciclo do cron (diário).`} />
            ) : (
              <>
                <p className="mb-4 text-xs text-slate-500">
                  Propriedade: <span className="text-slate-300">{gscAccount.site_url}</span> · período: {new Date(latestGscSnapshot.period_start).toLocaleDateString('pt-BR')} a{' '}
                  {new Date(latestGscSnapshot.period_end).toLocaleDateString('pt-BR')} (últimos 28 dias, dado oficial do Google)
                </p>
                <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <KpiCard label="Cliques" value={latestGscSnapshot.total_clicks.toLocaleString('pt-BR')} sub="últimos 28 dias" icon={<MousePointerClick size={16} className="text-white" />} />
                  <KpiCard label="Impressões" value={latestGscSnapshot.total_impressions.toLocaleString('pt-BR')} sub="apareceu na busca" icon={<Search size={16} className="text-white" />} />
                  <KpiCard label="CTR médio" value={`${(latestGscSnapshot.avg_ctr * 100).toFixed(1)}%`} sub="cliques / impressões" icon={<TrendingUp size={16} className="text-white" />} gradient="from-purple-400 to-indigo-500" />
                  <KpiCard label="Posição média" value={latestGscSnapshot.avg_position.toFixed(1)} sub="quanto menor, melhor" icon={<Gauge size={16} className="text-white" />} gradient="from-amber-400 to-orange-500" />
                </div>
                {latestGscSnapshot.top_queries.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[520px] text-left text-sm">
                      <TableShell>
                        <Th>Termo de busca</Th>
                        <Th>Cliques</Th>
                        <Th>Impressões</Th>
                        <Th>CTR</Th>
                        <Th>Posição</Th>
                      </TableShell>
                      <tbody>
                        {latestGscSnapshot.top_queries.slice(0, 10).map((q) => (
                          <Tr key={q.query}>
                            <Td className="max-w-xs truncate text-slate-300">{q.query}</Td>
                            <Td className="text-slate-400">{q.clicks}</Td>
                            <Td className="text-slate-400">{q.impressions}</Td>
                            <Td className="text-slate-400">{(q.ctr * 100).toFixed(1)}%</Td>
                            <Td className="text-slate-400">{q.position.toFixed(1)}</Td>
                          </Tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Card>

          {/* Auditoria técnica */}
          <Card className="overflow-hidden p-6">
            <CardHeader eyebrow="auditoria técnica" title="Diagnóstico real do site" action={<SeoAuditRunButton unitId={primaryUnit.id} />} />
            <p className="mb-4 text-xs text-slate-500">
              Site auditado: <span className="text-slate-300">{siteUrl}</span>
              {latestAudit && <> · última auditoria em {new Date(latestAudit.created_at).toLocaleString('pt-BR')}</>}
            </p>
            {!latestAudit ? (
              <EmptyState icon={<Gauge size={22} className="text-white" />} title="Nenhuma auditoria rodada ainda" subtitle="Clique em 'Rodar auditoria agora' ou aguarde o ciclo diário automático." />
            ) : latestAudit.error_message ? (
              <AlertBanner tone="warning" title="Não foi possível acessar o site" description={latestAudit.error_message} icon={<AlertTriangle size={16} className="text-white" />} />
            ) : (
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {latestAudit.checks.map((c) => (
                  <div key={c.id} className="rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-slate-200">{c.label}</p>
                      <Badge variant={CHECK_STATUS_VARIANT[c.status] ?? 'slate'}>{CHECK_STATUS_LABEL[c.status] ?? c.status}</Badge>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">{c.message}</p>
                    {c.status !== 'pass' && <p className="mt-1 text-[11px] text-cyan-400">{c.recommendation}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Fila de aprovação de conteúdo */}
          <Card className="overflow-hidden">
            <div className="px-6 pt-5">
              <CardHeader eyebrow="fila de conteúdo" title="Blog, landing page e Google Business Profile aguardando sua decisão" />
            </div>
            {pending.length === 0 ? (
              <EmptyState icon={<Sparkles size={22} className="text-white" />} title="Nada pendente agora" subtitle="O motor gera conteúdo novo periodicamente, respeitando as palavras-chave aprendidas na entrevista." />
            ) : (
              <div className="flex flex-col">
                {pending.map((item) => (
                  <div key={item.id} className="flex flex-col gap-4 px-6 py-5 sm:flex-row sm:items-start" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex-shrink-0">
                      {item.image_url ? (
                        <img src={item.image_url} alt="Imagem gerada para o conteúdo" className="h-28 w-28 rounded-xl object-cover" style={{ border: '1px solid rgba(255,255,255,0.08)' }} />
                      ) : (
                        <div className="flex h-28 w-28 items-center justify-center rounded-xl" style={{ border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}>
                          <ImageOff size={18} className="text-slate-600" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={CONTENT_TYPE_VARIANT[item.content_type] ?? 'slate'}>{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Badge>
                        {item.target_keyword && <Badge variant="slate">{item.target_keyword}</Badge>}
                        <span className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString('pt-BR')}</span>
                      </div>
                      <p className="mt-2 text-sm font-bold text-slate-200">{item.title}</p>
                      {item.meta_description && <p className="mt-0.5 text-[11px] text-slate-500">{item.meta_description}</p>}
                      <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{item.body_markdown}</p>
                      {item.reasoning && <p className="mt-1.5 text-[11px] text-slate-500">{item.reasoning}</p>}
                    </div>
                    <div className="flex-shrink-0">
                      <SeoContentItemActions itemId={item.id} initialTitle={item.title} initialMetaDescription={item.meta_description} initialBody={item.body_markdown} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Histórico */}
          <Card className="overflow-hidden">
            <div className="px-6 pt-5">
              <CardHeader eyebrow="histórico" title="Conteúdo já decidido" />
            </div>
            {history.length === 0 ? (
              <EmptyState icon={<Sparkles size={22} className="text-white" />} title="Nenhum item ainda" subtitle="Assim que o funcionário gerar conteúdo, o histórico aprovado/rejeitado aparece aqui." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <TableShell>
                    <Th>Quando</Th>
                    <Th>Tipo</Th>
                    <Th>Título</Th>
                    <Th>Status</Th>
                  </TableShell>
                  <tbody>
                    {history.map((item) => (
                      <Tr key={item.id}>
                        <Td className="text-slate-400">{new Date(item.created_at).toLocaleString('pt-BR')}</Td>
                        <Td className="text-slate-400">{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Td>
                        <Td className="max-w-md truncate text-slate-300">{item.title}</Td>
                        <Td>
                          <Badge variant={CONTENT_STATUS_VARIANT[item.status] ?? 'slate'}>{CONTENT_STATUS_LABEL[item.status] ?? item.status}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Google Business Profile */}
          <Card className="overflow-hidden p-6">
            <CardHeader eyebrow="google business profile" title="Checklist guiado + textos prontos para colar" />
            <AlertBanner
              tone="info"
              icon={<MapPin size={16} className="text-white" />}
              title="Isto NÃO é automação"
              description="A Alizo não publica nada automaticamente no seu perfil do Google Business Profile (Google Meu Negócio) — abaixo estão o passo a passo e os textos prontos para você mesmo colar no seu perfil."
            />
            <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Checklist</p>
                <SeoGbpChecklist unitId={primaryUnit.id} items={GBP_CHECKLIST_ITEMS} doneKeys={checklistDoneKeys} />
              </div>
              <div>
                <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-slate-500">Textos gerados (aprove na fila acima para usar)</p>
                {gbpTexts.length === 0 ? (
                  <p className="text-xs text-slate-500">Nenhum texto de GBP gerado ainda.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {gbpTexts.slice(0, 5).map((item) => (
                      <div key={item.id} className="rounded-xl p-3" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant={CONTENT_TYPE_VARIANT[item.content_type] ?? 'slate'}>{CONTENT_TYPE_LABEL[item.content_type] ?? item.content_type}</Badge>
                          <Badge variant={CONTENT_STATUS_VARIANT[item.status] ?? 'slate'}>{CONTENT_STATUS_LABEL[item.status] ?? item.status}</Badge>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-slate-300">{item.body_markdown}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* Rank tracking */}
          <Card className="overflow-hidden p-6">
            <CardHeader eyebrow="acompanhamento de posição" title="Palavras-chave acompanhadas" />
            {!serpConfigured && (
              <AlertBanner
                tone="warning"
                icon={<AlertTriangle size={16} className="text-white" />}
                title="Checagem automática de posição não configurada"
                description="Nenhuma API de rank tracking está ligada neste projeto (variável SERP_API_KEY). Você já pode cadastrar as palavras-chave abaixo — assim que a chave for configurada, a checagem de posição passa a rodar automaticamente."
              />
            )}
            <div className="mt-4">
              <SeoKeywordTracker unitId={primaryUnit.id} orgId={primaryUnit.org_id ?? ''} keywords={trackedKeywords} />
            </div>
          </Card>

          <Card className="flex items-center justify-between gap-4 p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}>
                <Megaphone size={16} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">Tráfego pago (anúncios) é com outro funcionário</p>
                <p className="text-xs text-slate-500">O Gestor de Tráfego cuida de Meta Ads e Google Ads — este funcionário cuida só do tráfego orgânico/SEO.</p>
              </div>
            </div>
            <Link href="/dashboard/traffic" className="flex flex-shrink-0 items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-slate-200 transition-colors hover:bg-white/5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              Ver tráfego pago <ExternalLink size={11} />
            </Link>
          </Card>
        </>
      )}
    </div>
  )
}
