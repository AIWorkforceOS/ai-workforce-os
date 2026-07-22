'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Eye, EyeOff } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, brandGradient } from '@/components/ui/dashboard-ui'

/**
 * Formulário de credenciais por processadora. As credenciais ficam em
 * payment_gateway_settings (RLS: só super_admin) e permanecem VAZIAS
 * até o Vinicius escolher a processadora e colar as chaves — nada aqui
 * ativa cobrança sozinho; o checkout continua registrando a cobrança
 * como pendente até a integração ser ligada no código.
 */

export type GatewayRow = {
  id: string
  region: 'BR' | 'US'
  provider: string
  label: string | null
  credentials: Record<string, string>
  instructions: string | null
  notes: string | null
  is_active: boolean
}

type FieldDef = { key: string; label: string; secret?: boolean; placeholder?: string }

type ProviderDef = {
  id: string
  name: string
  fields: FieldDef[]
  /** campo de instruções mostradas ao cliente para métodos de recebimento manual */
  hasInstructions?: boolean
  hint?: string
}

const PROVIDERS: Record<'BR' | 'US', ProviderDef[]> = {
  BR: [
    {
      id: 'asaas',
      name: 'Asaas',
      fields: [{ key: 'api_key', label: 'API Key', secret: true, placeholder: '$aact_...' }],
      hint: 'PIX + boleto + cartão numa API só, com cobrança recorrente nativa.',
    },
    {
      id: 'mercado_pago',
      name: 'Mercado Pago',
      fields: [
        { key: 'public_key', label: 'Public Key', placeholder: 'APP_USR-...' },
        { key: 'access_token', label: 'Access Token', secret: true, placeholder: 'APP_USR-...' },
      ],
      hint: 'PIX + boleto + cartão; marca conhecida pelo cliente final.',
    },
    {
      id: 'pagarme',
      name: 'Pagar.me',
      fields: [
        { key: 'api_key', label: 'Secret Key', secret: true, placeholder: 'sk_...' },
        { key: 'public_key', label: 'Public Key', placeholder: 'pk_...' },
      ],
      hint: 'PIX + boleto + cartão; robusto para volume maior.',
    },
  ],
  US: [
    {
      id: 'stripe',
      name: 'Stripe (cartão)',
      fields: [
        { key: 'publishable_key', label: 'Publishable Key', placeholder: 'pk_live_...' },
        { key: 'secret_key', label: 'Secret Key', secret: true, placeholder: 'sk_live_...' },
        { key: 'webhook_secret', label: 'Webhook Signing Secret', secret: true, placeholder: 'whsec_...' },
      ],
      hint: 'Débito/crédito à vista e assinatura recorrente nos EUA.',
    },
  ],
}

export function PaymentGatewayForm({
  region,
  rows,
  tableMissing,
}: {
  region: 'BR' | 'US'
  rows: GatewayRow[]
  tableMissing: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {tableMissing && (
        <div className="rounded-xl px-4 py-3 text-xs text-amber-400"
          style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          A tabela <code>payment_gateway_settings</code> ainda não existe no Supabase — aplique a
          migration <code>20260714000009_pricing_and_payment_gateways.sql</code> para salvar credenciais.
        </div>
      )}
      {PROVIDERS[region].map((def) => (
        <ProviderCard
          key={def.id}
          region={region}
          def={def}
          row={rows.find((r) => r.provider === def.id) ?? null}
          disabled={tableMissing}
        />
      ))}
    </div>
  )
}

function ProviderCard({
  region,
  def,
  row,
  disabled,
}: {
  region: 'BR' | 'US'
  def: ProviderDef
  row: GatewayRow | null
  disabled: boolean
}) {
  const router = useRouter()
  const [values, setValues] = useState<Record<string, string>>(
    () => Object.fromEntries(def.fields.map((f) => [f.key, row?.credentials?.[f.key] ?? ''])),
  )
  const [instructions, setInstructions] = useState(row?.instructions ?? '')
  const [isActive, setIsActive] = useState(row?.is_active ?? false)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configured = def.fields.some((f) => (values[f.key] ?? '').trim() !== '')

  async function handleSave() {
    setBusy(true)
    setError(null)
    setSaved(false)
    const supabase = createClient()
    const credentials = Object.fromEntries(
      Object.entries(values).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v !== ''),
    )
    const { error: saveError } = await supabase
      .from('payment_gateway_settings')
      .upsert(
        {
          region,
          provider: def.id,
          label: def.name,
          credentials,
          instructions: instructions.trim() || null,
          is_active: isActive,
        },
        { onConflict: 'region,provider' },
      )
    setBusy(false)
    if (saveError) {
      setError(`Não foi possível salvar: ${saveError.message}`)
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-white">{def.name}</p>
          {def.hint && <p className="mt-0.5 text-xs text-slate-500">{def.hint}</p>}
        </div>
        <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={configured
            ? { background: 'rgba(34,197,94,0.12)', color: '#4ade80' }
            : { background: 'rgba(255,255,255,0.06)', color: '#94a3b8' }}>
          {configured ? 'Credenciais preenchidas' : 'Vazio — aguardando credenciais'}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {def.fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-[11px] font-bold text-slate-400">{f.label}</label>
            <div className="relative">
              <input
                type={f.secret && !reveal[f.key] ? 'password' : 'text'}
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                disabled={disabled}
                autoComplete="off"
                className="w-full rounded-lg px-3 py-2 pr-9 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/50 disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
              />
              {f.secret && (
                <button
                  type="button"
                  onClick={() => setReveal((r) => ({ ...r, [f.key]: !r[f.key] }))}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {reveal[f.key] ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {def.hasInstructions && (
        <div className="mt-3">
          <label className="mb-1 block text-[11px] font-bold text-slate-400">
            Instruções mostradas ao cliente (e-mail de cobrança)
          </label>
          <textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            disabled={disabled}
            rows={3}
            placeholder={'Ex.: Send your monthly payment to payments@alizo.com (Alizo Inc). Include your company name in the memo.'}
            className="w-full rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 outline-none focus:border-cyan-500/50 disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-400">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            disabled={disabled}
            className="h-3.5 w-3.5 accent-cyan-500"
          />
          Marcar como processadora ativa desta região
        </label>

        <div className="flex items-center gap-3">
          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {saved && !error && <p className="text-[11px] text-emerald-400">Salvo ✓</p>}
          <button
            onClick={handleSave}
            disabled={busy || disabled}
            className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            style={{ background: brandGradient, boxShadow: '0 4px 10px rgba(6,182,212,0.25)' }}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Salvar
          </button>
        </div>
      </div>
    </Card>
  )
}
