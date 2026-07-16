'use client'

import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { MessagingChannelType, Unit } from '@/lib/types'
import type { Locale } from '@/lib/i18n/config'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'

const LOGO_MAX_BYTES = 2 * 1024 * 1024

export function UnitSettingsForm({ unit, showAdvanced = false }: { unit: Unit; showAdvanced?: boolean }) {
  const router = useRouter()
  const [whatsapp, setWhatsapp] = useState(unit.whatsapp_phone ?? '')
  const [emailFrom, setEmailFrom] = useState(unit.email_from ?? '')
  const [emailReplyTo, setEmailReplyTo] = useState(unit.email_reply_to ?? '')
  const [logoUrl, setLogoUrl] = useState(unit.logo_url ?? '')
  const [logoUploading, setLogoUploading] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [messagingChannel, setMessagingChannel] = useState<MessagingChannelType>(
    unit.messaging_channel === 'sms' ? 'sms' : 'whatsapp',
  )
  const [language, setLanguage] = useState<Locale>(unit.default_conversation_language === 'en' ? 'en' : 'pt')
  const [evolutionApiUrl, setEvolutionApiUrl] = useState(unit.evolution_api_url ?? '')
  const [evolutionApiKey, setEvolutionApiKey] = useState(unit.evolution_api_key ?? '')
  const [evolutionInstanceName, setEvolutionInstanceName] = useState(
    unit.evolution_instance_name ?? '',
  )
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setLogoError(null)

    if (!file.type.startsWith('image/')) {
      setLogoError('Envie um arquivo de imagem (PNG, JPG ou SVG).')
      return
    }
    if (file.size > LOGO_MAX_BYTES) {
      setLogoError('A imagem deve ter no máximo 2MB.')
      return
    }

    setLogoUploading(true)
    const supabase = createClient()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'png'
    const path = `${unit.id}/logo-${Date.now()}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from('unit-logos')
      .upload(path, file, { upsert: true, contentType: file.type })

    setLogoUploading(false)

    if (uploadError) {
      setLogoError('Não foi possível enviar a imagem.')
      return
    }

    const { data } = supabase.storage.from('unit-logos').getPublicUrl(path)
    setLogoUrl(data.publicUrl)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setLoading(true)

    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('units')
      .update({
        whatsapp_phone: whatsapp || null,
        email_from: emailFrom || null,
        email_reply_to: emailReplyTo || null,
        logo_url: logoUrl || null,
        messaging_channel: messagingChannel,
        default_conversation_language: language,
        // Campos técnicos: só o painel interno (equipe Alizo) mexe neles.
        // Sem eles a unidade usa o servidor central de WhatsApp da Alizo.
        ...(showAdvanced
          ? {
              evolution_api_url: evolutionApiUrl || null,
              evolution_api_key: evolutionApiKey || null,
              evolution_instance_name: evolutionInstanceName || null,
            }
          : {}),
      })
      .eq('id', unit.id)

    setLoading(false)

    if (saveError) {
      setError('Não foi possível salvar as alterações.')
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormSection title="Dados da unidade">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="whatsapp">WhatsApp</Label>
            <Input
              id="whatsapp"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+55 19 99999-9999"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emailFrom">Email de envio</Label>
            <Input
              id="emailFrom"
              type="email"
              value={emailFrom}
              onChange={(e) => setEmailFrom(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emailReplyTo">E-mail de resposta (reply-to)</Label>
            <Input
              id="emailReplyTo"
              type="email"
              value={emailReplyTo}
              onChange={(e) => setEmailReplyTo(e.target.value)}
              placeholder="contato@suaempresa.com"
            />
            <p className="text-xs text-slate-500">
              Quando o Sales Rep manda e-mail pro lead (canal adicional ao WhatsApp/SMS), as respostas do lead
              caem aqui.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="logo">Logo da empresa</Label>
          <div className="flex items-center gap-3">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo"
                className="h-12 w-12 flex-shrink-0 rounded-lg object-contain"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              />
            ) : (
              <div
                className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg text-[10px] text-slate-500"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
              >
                sem logo
              </div>
            )}
            <div className="flex flex-col gap-1">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                disabled={logoUploading}
                className="self-start rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-colors disabled:opacity-50"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
              >
                {logoUploading ? 'Enviando...' : logoUrl ? 'Trocar imagem' : 'Enviar imagem'}
              </button>
              <input
                ref={logoInputRef}
                id="logo"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleLogoChange}
              />
              {logoError && <p className="text-xs text-red-400">{logoError}</p>}
            </div>
          </div>
          <p className="text-xs text-slate-500">
            Usada no template de e-mail do Sales Rep e em outros pontos com a marca da empresa. PNG, JPG ou SVG,
            até 2MB.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="messagingChannel">Canal de mensagens</Label>
          <Select
            id="messagingChannel"
            value={messagingChannel}
            onChange={(e) => setMessagingChannel(e.target.value as MessagingChannelType)}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS (Twilio)</option>
          </Select>
          <p className="text-xs text-slate-500">
            Sugestão: Brasil → WhatsApp, EUA → SMS. Para usar SMS, conecte antes as credenciais Twilio em{' '}
            <a href="/dashboard/messaging/connect" className="underline">Canal de mensagens (SMS)</a>.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="language">Idioma padrão de atendimento</Label>
          <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as Locale)}>
            <option value="pt">Português</option>
            <option value="en">Inglês (EUA)</option>
          </Select>
          <p className="text-xs text-slate-500">
            Sugestão: Brasil → Português, EUA → Inglês. É o idioma padrão da entrevista de contratação e do
            atendimento a leads/candidatos — o funcionário digital muda de idioma automaticamente se a pessoa
            pedir ou escrever em outro idioma.
          </p>
        </div>

        {showAdvanced && (
          <>
            <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span className="text-sm font-medium text-slate-300">Evolution API (interno Alizo)</span>
              <p className="text-xs text-slate-500">
                Deixe em branco para usar o servidor central de WhatsApp da Alizo. Preencha só para
                apontar esta unidade pra uma instância dedicada.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="evolutionApiUrl">URL da instância</Label>
                <Input
                  id="evolutionApiUrl"
                  value={evolutionApiUrl}
                  onChange={(e) => setEvolutionApiUrl(e.target.value)}
                  placeholder="https://evolution.suaempresa.com"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="evolutionInstanceName">Nome da instância</Label>
                <Input
                  id="evolutionInstanceName"
                  value={evolutionInstanceName}
                  onChange={(e) => setEvolutionInstanceName(e.target.value)}
                  placeholder="alizo-campinas"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="evolutionApiKey">API key</Label>
              <Input
                id="evolutionApiKey"
                type="password"
                value={evolutionApiKey}
                onChange={(e) => setEvolutionApiKey(e.target.value)}
                placeholder="sua_api_key"
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && !error && <p className="text-sm text-emerald-400">Alterações salvas.</p>}

        <button
          type="submit"
          disabled={loading}
          className="self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {loading ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </FormSection>
    </form>
  )
}
