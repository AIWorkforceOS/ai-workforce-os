'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Sparkles } from 'lucide-react'
import { FormSection, Input, Label, Select, Textarea } from '@/components/ui/dashboard-ui'
import type { Unit } from '@/lib/types'

type ContentPostOption = { id: string; unit_id: string; caption: string }
type SeoContentItemOption = { id: string; unit_id: string; title: string; content_type: string }

const LEAD_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'new', label: 'Novo' },
  { value: 'contacted', label: 'Contatado' },
  { value: 'replied', label: 'Respondeu' },
  { value: 'negotiating', label: 'Negociando' },
  { value: 'won', label: 'Fechado (ganho)' },
  { value: 'lost', label: 'Perdido' },
  { value: 'paused', label: 'Pausado' },
]
const DEFAULT_LEAD_STATUSES = ['new', 'contacted', 'replied', 'negotiating']

type SourceChoice = 'objective' | `content_post:${string}` | `seo_content_item:${string}`

export function EmailCampaignForm({
  units,
  contentPosts,
  seoContentItems,
}: {
  units: Unit[]
  contentPosts: ContentPostOption[]
  seoContentItems: SeoContentItemOption[]
}) {
  const router = useRouter()
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [source, setSource] = useState<SourceChoice>('objective')
  const [objective, setObjective] = useState('')
  const [audienceType, setAudienceType] = useState<'leads' | 'customers' | 'both'>('leads')
  const [leadStatuses, setLeadStatuses] = useState<string[]>(DEFAULT_LEAD_STATUSES)
  const [staleDays, setStaleDays] = useState('')
  const [customerStatus, setCustomerStatus] = useState<'active' | 'inactive' | 'all'>('active')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const postsForUnit = useMemo(() => contentPosts.filter((p) => p.unit_id === unitId), [contentPosts, unitId])
  const seoItemsForUnit = useMemo(() => seoContentItems.filter((s) => s.unit_id === unitId), [seoContentItems, unitId])

  const needsLeads = audienceType === 'leads' || audienceType === 'both'
  const needsCustomers = audienceType === 'customers' || audienceType === 'both'
  const isFromScratch = source === 'objective'

  function toggleLeadStatus(value: string) {
    setLeadStatuses((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]))
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)

    if (isFromScratch && !objective.trim()) {
      setError('Descreva o objetivo da campanha.')
      return
    }

    const [sourceType, sourceId] = source === 'objective' ? ['objective', undefined] : source.split(':')

    setBusy(true)
    try {
      const response = await fetch('/api/marketing-email/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          audience_type: audienceType,
          audience_filter: {
            ...(needsLeads ? { lead_statuses: leadStatuses, stale_days: staleDays ? Number(staleDays) : null } : {}),
            ...(needsCustomers ? { customer_status: customerStatus } : {}),
          },
          objective: objective.trim(),
          source_type: sourceType,
          source_id: sourceId,
        }),
      })
      const data = await response.json()
      if (!response.ok) {
        setError(data.error ?? 'Falha ao gerar a campanha.')
        return
      }
      router.push('/dashboard/email-marketing')
      router.refresh()
    } catch {
      setError('Erro de rede ao gerar a campanha.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormSection title="1. Unidade e conteúdo">
        <div>
          <Label>Unidade</Label>
          <Select className="mt-1.5 w-full" value={unitId} onChange={(e) => { setUnitId(e.target.value); setSource('objective') }}>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>{unit.name}</option>
            ))}
          </Select>
        </div>

        <div>
          <Label>Base da campanha</Label>
          <Select className="mt-1.5 w-full" value={source} onChange={(e) => setSource(e.target.value as SourceChoice)}>
            <option value="objective">Escrever do zero (descrever o objetivo)</option>
            {seoItemsForUnit.length > 0 && (
              <optgroup label="Conteúdo já aprovado do SEO">
                {seoItemsForUnit.map((item) => (
                  <option key={item.id} value={`seo_content_item:${item.id}`}>{item.title || `Item de ${item.content_type}`}</option>
                ))}
              </optgroup>
            )}
            {postsForUnit.length > 0 && (
              <optgroup label="Posts já publicados do Conteúdo/Social">
                {postsForUnit.map((post) => (
                  <option key={post.id} value={`content_post:${post.id}`}>{post.caption.slice(0, 60)}{post.caption.length > 60 ? '…' : ''}</option>
                ))}
              </optgroup>
            )}
          </Select>
        </div>

        <div>
          <Label>{isFromScratch ? 'Objetivo da campanha' : 'Instrução extra (opcional)'}</Label>
          <Textarea
            className="mt-1.5 w-full"
            rows={3}
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder={
              isFromScratch
                ? 'Ex.: avisar sobre a promoção de inverno, reengajar leads frios, contar uma novidade...'
                : 'Ex.: foque no CTA de agendamento, deixe mais curto...'
            }
          />
        </div>
      </FormSection>

      <FormSection title="2. Para quem enviar">
        <div>
          <Label>Público</Label>
          <Select className="mt-1.5 w-full" value={audienceType} onChange={(e) => setAudienceType(e.target.value as typeof audienceType)}>
            <option value="leads">Leads (contatos que ainda não fecharam)</option>
            <option value="customers">Clientes cadastrados</option>
            <option value="both">Leads e clientes</option>
          </Select>
        </div>

        {needsLeads && (
          <div className="flex flex-col gap-3 rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <div>
              <Label>Status do lead incluídos</Label>
              <div className="mt-2 flex flex-wrap gap-3">
                {LEAD_STATUS_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-1.5 text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={leadStatuses.includes(opt.value)}
                      onChange={() => toggleLeadStatus(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label>Só quem está sem contato há pelo menos (dias)</Label>
              <Input
                className="mt-1.5 w-full"
                type="number"
                min={0}
                value={staleDays}
                onChange={(e) => setStaleDays(e.target.value)}
                placeholder="Deixe em branco para não filtrar por tempo"
              />
            </div>
          </div>
        )}

        {needsCustomers && (
          <div className="rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <Label>Status do cliente</Label>
            <Select className="mt-1.5 w-full" value={customerStatus} onChange={(e) => setCustomerStatus(e.target.value as typeof customerStatus)}>
              <option value="active">Ativos</option>
              <option value="inactive">Inativos</option>
              <option value="all">Todos</option>
            </Select>
          </div>
        )}
      </FormSection>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={busy || !unitId}
        className="flex items-center justify-center gap-2 self-start rounded-xl px-5 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
        {busy ? 'Gerando rascunho…' : 'Gerar rascunho com IA'}
      </button>
    </form>
  )
}
