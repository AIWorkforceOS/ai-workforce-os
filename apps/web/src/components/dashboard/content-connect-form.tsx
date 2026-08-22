'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, CheckCircle2, LogIn } from 'lucide-react'
import { Badge, Card, CardHeader, Input, Label, Select, brandGradient } from '@/components/ui/dashboard-ui'
import { MetaPartnerGuide } from '@/components/dashboard/meta-partner-guide'
import { ContentOAuthBanner } from '@/components/dashboard/content-oauth-page-picker'
import type { SocialAccount } from '@/lib/content/types'
import type { Unit } from '@/lib/types'

const META_PAGE_PARTNER_STEPS = [
  'Clique no botão abaixo pra abrir as Páginas do seu negócio no Facebook, e escolha a Página certa.',
  'Abra Configurações → Acesso à Página (Nova experiência de Páginas).',
  'Em "Acesso de parceiros", clique em "Atribuir um novo parceiro" e cole o ID acima.',
  'Conceda acesso de conteúdo (publicar e gerenciar posts/anúncios) para essa Página.',
]

function SecretInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [reveal, setReveal] = useState(false)
  return (
    <div className="relative">
      <Input
        type={reveal ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-9"
      />
      <button type="button" onClick={() => setReveal((r) => !r)} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
        {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  )
}

const STATUS_VARIANT: Record<string, 'green' | 'amber' | 'red' | 'slate'> = {
  connected: 'green',
  pending_credentials: 'amber',
  error: 'red',
  disconnected: 'slate',
}
const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectada',
  pending_credentials: 'Aguardando credenciais',
  error: 'Erro',
  disconnected: 'Desconectada',
}

export function ContentConnectForm({
  units,
  accounts,
  businessManagerId,
  oauthEnabled,
}: {
  units: Unit[]
  accounts: SocialAccount[]
  businessManagerId: string | null
  /** true quando META_APP_ID + META_APP_SECRET estão configurados — sem isso o login com Facebook não funciona. */
  oauthEnabled: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [pageId, setPageId] = useState('')
  const [pageAccessToken, setPageAccessToken] = useState('')
  const [manualOpen, setManualOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const oauthError = searchParams.get('oauth_error')
  const oauthSuccess = searchParams.get('oauth_success')

  async function handleSubmit() {
    if (!unitId) {
      setError('Selecione a unidade.')
      return
    }
    if (!pageId.trim()) {
      setError('Informe o ID da Página do Facebook.')
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/content/accounts/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          page_id: pageId.trim(),
          page_access_token: pageAccessToken.trim() || undefined,
        }),
      })
      const data = (await response.json()) as { error?: string; label?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar a Página.')
        return
      }
      setSuccess(`Conectado com sucesso: ${data.label ?? pageId}`)
      setPageId('')
      setPageAccessToken('')
      router.refresh()
    } catch {
      setError('Erro de rede ao testar a conexão. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <ContentOAuthBanner success={oauthSuccess} error={oauthError} />

      <Card className="p-6">
        <CardHeader eyebrow="conectar conta" title="Conectar Instagram e Facebook" />

        <div className="flex flex-col gap-4">
          {units.length > 1 && (
            <div>
              <Label htmlFor="unit">Unidade</Label>
              <Select id="unit" className="mt-1" value={unitId} onChange={(e) => setUnitId(e.target.value)}>
                {units.map((unit) => (
                  <option key={unit.id} value={unit.id}>{unit.name}</option>
                ))}
              </Select>
            </div>
          )}

          <p className="text-xs text-slate-400">
            Clique no botão, faça login com a conta do Facebook da sua empresa e escolha a Página — pronto, o Gestor
            de Conteúdo já consegue publicar. Nada de token pra copiar ou colar.
          </p>

          <a
            href={unitId ? `/api/content/accounts/oauth/start?unit_id=${unitId}` : undefined}
            aria-disabled={!unitId || !oauthEnabled}
            onClick={(e) => {
              if (!unitId || !oauthEnabled) e.preventDefault()
            }}
            className="flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-black text-white transition-all hover:scale-[1.01] aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:scale-100"
            style={{ background: 'linear-gradient(135deg, #1877F2, #0C63D4)', boxShadow: '0 4px 14px rgba(24,119,242,0.35)' }}
          >
            <LogIn size={16} />
            Conectar com Facebook
          </a>
          {!oauthEnabled && (
            <p className="text-[11px] text-amber-400">
              O login com Facebook ainda está sendo liberado pra sua conta — enquanto isso, use o método manual abaixo.
            </p>
          )}

          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 hover:text-slate-200"
          >
            {manualOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            Prefiro o método manual (compartilhar a Página como Parceira)
          </button>

          {manualOpen && (
            <div className="flex flex-col gap-4 rounded-xl p-4" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
              <MetaPartnerGuide
                businessManagerId={businessManagerId}
                assetLabel="a Página"
                steps={META_PAGE_PARTNER_STEPS}
                openUrl="https://business.facebook.com/settings/pages"
                openLabel="Abrir Páginas no Facebook"
              />

              <div className="rounded-xl p-3.5" style={{ border: '1px solid rgba(6,182,212,0.25)', background: 'rgba(6,182,212,0.05)' }}>
                <Label htmlFor="page-id">Passo 2 de 2 — cole aqui o ID da SUA Página</Label>
                <Input id="page-id" className="mt-1" value={pageId} onChange={(e) => setPageId(e.target.value)} placeholder="1234567890" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Não é o mesmo número do passo 1 (aquele é da Alizo). Pra achar o ID da sua Página: na tela que abriu
                  acima, clique nela → o ID aparece em Configurações → Sobre, ou na própria URL da Página. Se ela tem
                  uma conta do Instagram Business vinculada, ela é detectada automaticamente no teste de conexão.
                </p>
              </div>

              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Avançado: tenho meu próprio token de acesso da Página
              </button>

              {advancedOpen && (
                <div className="flex flex-col gap-3 rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[11px] text-slate-500">
                    Só preencha se você já tiver seu próprio token de Página de longa duração —
                    do contrário deixe em branco que usamos a conta técnica da Alizo (passo do compartilhamento acima).
                  </p>
                  <div>
                    <Label htmlFor="page-token">Token de acesso da Página (longa duração)</Label>
                    <div className="mt-1">
                      <SecretInput value={pageAccessToken} onChange={setPageAccessToken} placeholder="EAAG..." />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Gerado no Meta Business Suite / Graph API Explorer, com os escopos pages_manage_posts,
                      pages_read_engagement, instagram_basic e instagram_content_publish.
                    </p>
                  </div>
                </div>
              )}

              {error && <p className="text-xs text-red-400">{error}</p>}
              {success && (
                <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 size={13} /> {success}
                </p>
              )}

              <button
                onClick={handleSubmit}
                disabled={busy}
                className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white disabled:opacity-60"
                style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? 'Testando conexão...' : 'Testar e conectar'}
              </button>
            </div>
          )}
        </div>
      </Card>

      {accounts.length > 0 && (
        <Card className="p-6">
          <CardHeader eyebrow="já conectadas" title="Páginas desta organização" />
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <ConnectedAccountRow key={account.id} account={account} />
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function ConnectedAccountRow({ account }: { account: SocialAccount }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function toggleMode() {
    setBusy(true)
    const nextMode = account.publishing_mode === 'autonomous' ? 'suggestion' : 'autonomous'
    await fetch(`/api/content/accounts/${account.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publishing_mode: nextMode }),
    })
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-white">{account.page_name}</p>
        <p className="text-[11px] text-slate-500">
          Facebook{account.instagram_username ? ` + @${account.instagram_username}` : ' · sem Instagram vinculado'}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <Badge variant={STATUS_VARIANT[account.connection_status] ?? 'slate'}>
          {STATUS_LABEL[account.connection_status] ?? account.connection_status}
        </Badge>
        <button
          onClick={toggleMode}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50"
          style={
            account.publishing_mode === 'autonomous'
              ? { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' }
              : { background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }
          }
          title="Clique para trocar o modo de publicação"
        >
          {account.publishing_mode === 'autonomous' ? 'Autônomo' : 'Fila de aprovação'}
        </button>
      </div>
    </div>
  )
}
