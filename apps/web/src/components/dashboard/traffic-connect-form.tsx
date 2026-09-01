'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, CheckCircle2, MailQuestion, LogIn } from 'lucide-react'
import { Badge, Card, CardHeader, Input, Label, Select, brandGradient } from '@/components/ui/dashboard-ui'
import { MetaPartnerGuide } from '@/components/dashboard/meta-partner-guide'
import { TrafficOAuthBanner } from '@/components/dashboard/traffic-oauth-account-picker'
import type { AdAccount } from '@/lib/traffic/types'
import type { Unit } from '@/lib/types'

const META_PARTNER_STEPS = [
  'Clique no botão abaixo pra abrir "Parceiros" nas configurações do seu negócio no Facebook.',
  'Clique em "Adicionar" → "Dar a um parceiro acesso às suas contas" e cole o ID acima.',
  'Escolha a conta de anúncio que você quer conectar e marque a permissão "Gerenciar campanhas".',
  'Aguarde alguns minutos pra propagar — se o teste falhar na primeira tentativa, espere um pouco e clique em "Testar e conectar" de novo antes de desconfiar que algo deu errado.',
]

type Platform = 'meta' | 'google'

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

function platformLabel(platform: string): string {
  return platform === 'meta' ? 'Meta Ads' : 'Google Ads'
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

export function TrafficConnectForm({
  units,
  accounts,
  businessManagerId,
  oauthEnabled,
}: {
  units: Unit[]
  accounts: AdAccount[]
  businessManagerId: string | null
  /** true quando META_APP_ID + META_APP_SECRET + META_ADS_LOGIN_CONFIG_ID estão configurados — sem isso o login com Facebook não funciona. */
  oauthEnabled: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [platform, setPlatform] = useState<Platform>('meta')
  const [externalAccountId, setExternalAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [metaAdvancedOpen, setMetaAdvancedOpen] = useState(false)
  const [metaManualOpen, setMetaManualOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [developerToken, setDeveloperToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [inviteRequestBusy, setInviteRequestBusy] = useState(false)
  const [inviteRequested, setInviteRequested] = useState(false)

  const oauthError = searchParams.get('oauth_error')
  const oauthSuccess = searchParams.get('oauth_success')

  function resetPlatformFields() {
    setExternalAccountId('')
    setAccessToken('')
    setMetaAdvancedOpen(false)
    setRefreshToken('')
    setDeveloperToken('')
    setClientId('')
    setClientSecret('')
    setAdvancedOpen(false)
    setError(null)
    setSuccess(null)
  }

  async function handleSubmit() {
    if (!unitId) {
      setError('Selecione a unidade.')
      return
    }
    if (!externalAccountId.trim()) {
      setError(platform === 'meta' ? 'Informe o ID da conta de anúncio.' : 'Informe o Customer ID.')
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/traffic/accounts/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          platform,
          external_account_id: externalAccountId.trim(),
          ...(platform === 'meta'
            ? { access_token: accessToken.trim() || undefined }
            : {
                refresh_token: refreshToken.trim() || undefined,
                google_developer_token: developerToken.trim() || undefined,
                google_client_id: clientId.trim() || undefined,
                google_client_secret: clientSecret.trim() || undefined,
              }),
        }),
      })
      const data = await response.json() as { error?: string; label?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar a conta.')
        return
      }
      setSuccess(`Conectado com sucesso: ${data.label ?? externalAccountId}`)
      router.refresh()
    } catch {
      setError('Erro de rede ao testar a conexão. Tente novamente.')
    } finally {
      setBusy(false)
    }
  }

  async function handleRequestInvite() {
    setInviteRequestBusy(true)
    try {
      await fetch('/api/traffic/google-ads/request-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit_id: unitId, customer_id: externalAccountId.trim() }),
      })
      setInviteRequested(true)
    } catch {
      // best-effort — se falhar, o cliente pode tentar de novo ou chamar o suporte diretamente
    } finally {
      setInviteRequestBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <TrafficOAuthBanner success={oauthSuccess} error={oauthError} />

      <Card className="p-6">
        <CardHeader eyebrow="conectar conta" title="Nova conta de anúncio" />

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

          <div className="flex gap-2">
            <button
              onClick={() => { setPlatform('meta'); resetPlatformFields() }}
              className="flex-1 rounded-lg py-2.5 text-xs font-bold transition-colors"
              style={platform === 'meta' ? { background: brandGradient, color: '#fff' } : { background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Meta Ads
            </button>
            <button
              onClick={() => { setPlatform('google'); resetPlatformFields() }}
              className="flex-1 rounded-lg py-2.5 text-xs font-bold transition-colors"
              style={platform === 'google' ? { background: brandGradient, color: '#fff' } : { background: 'rgba(255,255,255,0.04)', color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              Google Ads
            </button>
          </div>

          {platform === 'meta' ? (
            <>
              <p className="text-xs text-slate-400">
                Clique no botão, faça login com a conta do Facebook da empresa e escolha a conta de anúncio — pronto,
                sem colar ID nem mexer no Business Manager.
              </p>

              <a
                href={unitId ? `/api/traffic/accounts/oauth/start?unit_id=${unitId}` : undefined}
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
                  O login com Facebook pra anúncios ainda está sendo liberado — enquanto isso, use o método manual abaixo.
                </p>
              )}

              <button
                type="button"
                onClick={() => setMetaManualOpen((v) => !v)}
                className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                {metaManualOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Prefiro o método manual (compartilhar como Parceiro)
              </button>

              {metaManualOpen && (
                <>
                  <MetaPartnerGuide
                    businessManagerId={businessManagerId}
                    assetLabel="a conta de anúncio"
                    steps={META_PARTNER_STEPS}
                    openUrl="https://business.facebook.com/settings/partners"
                    openLabel="Abrir Parceiros no Facebook"
                  />
                  <div className="rounded-xl p-3.5" style={{ border: '1px solid rgba(6,182,212,0.25)', background: 'rgba(6,182,212,0.05)' }}>
                    <Label htmlFor="meta-account">Passo 2 de 2 — cole aqui o ID da SUA conta de anúncio</Label>
                    <Input id="meta-account" className="mt-1" value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="act_1234567890 ou 1234567890" />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Não é o mesmo número do passo 1 (aquele é da Alizo). Pra achar o seu: abra o{' '}
                      <a href="https://adsmanager.facebook.com/adsmanager/manage/accounts" target="_blank" rel="noopener noreferrer" className="font-semibold text-cyan-400 hover:underline">
                        Gerenciador de Anúncios
                      </a>{' '}
                      — o ID aparece embaixo do nome da conta, no topo da página.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => setMetaAdvancedOpen((v) => !v)}
                    className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    {metaAdvancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                    Avançado: tenho meu próprio token de acesso
                  </button>

                  {metaAdvancedOpen && (
                    <div className="flex flex-col gap-3 rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                      <p className="text-[11px] text-slate-500">
                        Só preencha se você já tiver seu próprio token de usuário do sistema ou de página —
                        do contrário deixe em branco que usamos a conta técnica da Alizo (passo do compartilhamento acima).
                      </p>
                      <div>
                        <Label htmlFor="meta-token">Token de acesso</Label>
                        <div className="mt-1">
                          <SecretInput value={accessToken} onChange={setAccessToken} placeholder="EAAG..." />
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="google-account">Customer ID da conta</Label>
                <Input id="google-account" className="mt-1" value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="123-456-7890" />
                <p className="mt-1 text-[11px] text-slate-500">
                  Antes de testar, confirme que já aceitou o convite de vínculo com a Alizo em
                  Ferramentas e configurações → Acesso e segurança → Contas de gerenciador.
                </p>
                {inviteRequested ? (
                  <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                    <CheckCircle2 size={12} /> Pedido registrado — o time Alizo vai te enviar o convite em breve.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={handleRequestInvite}
                    disabled={inviteRequestBusy}
                    className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-400 hover:text-slate-200 disabled:opacity-60"
                  >
                    {inviteRequestBusy ? <Loader2 size={12} className="animate-spin" /> : <MailQuestion size={12} />}
                    Ainda não recebi o convite da Alizo
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1.5 self-start text-xs font-semibold text-slate-400 hover:text-slate-200"
              >
                {advancedOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                Avançado: tenho minha própria credencial da Google Ads API
              </button>

              {advancedOpen && (
                <div className="flex flex-col gap-3 rounded-xl p-3.5" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[11px] text-slate-500">
                    Só preencha se você tiver seu próprio developer token e app OAuth do Google Ads API —
                    do contrário deixe em branco que usamos a conta técnica da Alizo (passo do vínculo acima).
                  </p>
                  <div>
                    <Label htmlFor="google-refresh">Refresh token</Label>
                    <div className="mt-1"><SecretInput value={refreshToken} onChange={setRefreshToken} /></div>
                  </div>
                  <div>
                    <Label htmlFor="google-dev-token">Developer token</Label>
                    <div className="mt-1"><SecretInput value={developerToken} onChange={setDeveloperToken} /></div>
                  </div>
                  <div>
                    <Label htmlFor="google-client-id">Client ID</Label>
                    <Input id="google-client-id" className="mt-1" value={clientId} onChange={(e) => setClientId(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="google-client-secret">Client secret</Label>
                    <div className="mt-1"><SecretInput value={clientSecret} onChange={setClientSecret} /></div>
                  </div>
                </div>
              )}
            </>
          )}

          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 size={13} /> {success}
            </p>
          )}

          {(platform === 'google' || metaManualOpen) && (
            <button
              onClick={handleSubmit}
              disabled={busy}
              className="flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-black text-white disabled:opacity-60"
              style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.3)' }}
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {busy ? 'Testando conexão...' : 'Testar e conectar'}
            </button>
          )}
        </div>
      </Card>

      {accounts.length > 0 && (
        <Card className="p-6">
          <CardHeader eyebrow="já conectadas" title="Contas desta organização" />
          <div className="flex flex-col gap-2">
            {accounts.map((account) => (
              <div key={account.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">{account.name}</p>
                  <p className="text-[11px] text-slate-500">{platformLabel(account.platform)} · {account.external_account_id}</p>
                </div>
                <Badge variant={STATUS_VARIANT[account.connection_status] ?? 'slate'}>
                  {STATUS_LABEL[account.connection_status] ?? account.connection_status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
