'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react'
import { Card, CardHeader, Input, Label, Select, Badge, brandGradient } from '@/components/ui/dashboard-ui'
import type { Unit } from '@/lib/types'

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

export function MessagingConnectForm({ units }: { units: Unit[] }) {
  const router = useRouter()
  const [unitId, setUnitId] = useState(units[0]?.id ?? '')
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const connectedUnits = units.filter((u) => u.twilio_phone_number)

  async function handleSubmit() {
    if (!unitId) {
      setError('Selecione a unidade.')
      return
    }
    if (!accountSid.trim() || !authToken.trim() || !phoneNumber.trim()) {
      setError('Preencha Account SID, Auth Token e o número Twilio.')
      return
    }

    setBusy(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/messaging/twilio/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unitId,
          account_sid: accountSid.trim(),
          auth_token: authToken.trim(),
          phone_number: phoneNumber.trim(),
        }),
      })
      const data = await response.json() as { error?: string; label?: string }
      if (!response.ok) {
        setError(data.error ?? 'Não foi possível conectar a conta Twilio.')
        return
      }
      setSuccess(`Conectado com sucesso: ${data.label ?? phoneNumber}. Esta unidade agora usa SMS como canal.`)
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
        <CardHeader eyebrow="conectar Twilio" title="Credenciais SMS" />

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

          <div>
            <Label htmlFor="account-sid">Account SID</Label>
            <Input id="account-sid" className="mt-1" value={accountSid} onChange={(e) => setAccountSid(e.target.value)} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
          </div>

          <div>
            <Label htmlFor="auth-token">Auth Token</Label>
            <div className="mt-1">
              <SecretInput value={authToken} onChange={setAuthToken} placeholder="seu auth token" />
            </div>
          </div>

          <div>
            <Label htmlFor="phone-number">Número Twilio</Label>
            <Input id="phone-number" className="mt-1" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} placeholder="+15551234567" />
            <p className="mt-1 text-[11px] text-slate-500">
              Formato internacional (E.164), com o + na frente. É o número que envia e recebe os SMS.
            </p>
          </div>

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

      {connectedUnits.length > 0 && (
        <Card className="p-6">
          <CardHeader eyebrow="já conectadas" title="Unidades com SMS ativo" />
          <div className="flex flex-col gap-2">
            {connectedUnits.map((unit) => (
              <div key={unit.id} className="flex items-center justify-between gap-3 rounded-xl px-3.5 py-2.5" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">{unit.name}</p>
                  <p className="text-[11px] text-slate-500">{unit.twilio_phone_number}</p>
                </div>
                <Badge variant={unit.messaging_channel === 'sms' ? 'green' : 'slate'}>
                  {unit.messaging_channel === 'sms' ? 'SMS ativo' : 'WhatsApp ativo'}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
