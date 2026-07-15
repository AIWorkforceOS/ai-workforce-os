'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react'
import { Badge, Card, CardHeader, Input, Label, Select, brandGradient } from '@/components/ui/dashboard-ui'
import type { AdAccount } from '@/lib/traffic/types'
import type { Unit } from '@/lib/types'

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

export function TrafficConnectForm({ units, accounts }: { units: Unit[]; accounts: AdAccount[] }) {
  const router = useRouter()
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [platform, setPlatform] = useState<Platform>('meta')
  const [externalAccountId, setExternalAccountId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [developerToken, setDeveloperToken] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  function resetPlatformFields() {
    setExternalAccountId('')
    setAccessToken('')
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
    if (platform === 'meta' && !accessToken.trim()) {
      setError('Cole o token de acesso da conta.')
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
            ? { access_token: accessToken.trim() }
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

  return (
    <div className="flex flex-col gap-5">
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
              <div>
                <Label htmlFor="meta-account">ID da conta de anúncio</Label>
                <Input id="meta-account" className="mt-1" value={externalAccountId} onChange={(e) => setExternalAccountId(e.target.value)} placeholder="act_1234567890 ou 1234567890" />
              </div>
              <div>
                <Label htmlFor="meta-token">Token de acesso (usuário do sistema)</Label>
                <div className="mt-1">
                  <SecretInput value={accessToken} onChange={setAccessToken} placeholder="EAAG..." />
                </div>
              </div>
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
