'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Locale } from '@/lib/i18n/config'
import { FormSection, Input, Label, Select } from '@/components/ui/dashboard-ui'

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

type OrgOption = { id: string; name: string }

export function NewUnitForm({
  organizations,
  defaultOrgId,
  suggestedLanguage = 'pt',
}: {
  /** Lista de empresas para escolher (só super admin) — null para admin de empresa (org fixa). */
  organizations: OrgOption[] | null
  defaultOrgId: string
  /** Sugestão automática pelo país do IP de quem está criando a unidade — editável. */
  suggestedLanguage?: Locale
}) {
  const router = useRouter()
  const [orgId, setOrgId] = useState(defaultOrgId)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [messagingChannel, setMessagingChannel] = useState<'whatsapp' | 'sms'>('whatsapp')
  const [language, setLanguage] = useState<Locale>(suggestedLanguage)
  const [evolutionApiUrl, setEvolutionApiUrl] = useState('')
  const [evolutionApiKey, setEvolutionApiKey] = useState('')
  const [evolutionInstanceName, setEvolutionInstanceName] = useState('')
  const [crmIntegrationMode, setCrmIntegrationMode] = useState<'native' | 'smarter'>('native')
  const [smarterCrmPartnerToken, setSmarterCrmPartnerToken] = useState('')
  const [recruitingIntegrationMode, setRecruitingIntegrationMode] = useState<'native' | 'smarter'>('native')
  const [smarterRecruitingPartnerToken, setSmarterRecruitingPartnerToken] = useState('')
  const [smarterRecruitingCompanyId, setSmarterRecruitingCompanyId] = useState('')
  const [createOwnerAccess, setCreateOwnerAccess] = useState(false)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleNameChange(value: string) {
    setName(value)
    if (!slugTouched) {
      setSlug(slugify(value))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!orgId) {
      setError('Selecione a empresa.')
      return
    }
    if (createOwnerAccess && !ownerEmail.trim()) {
      setError('Informe o e-mail do responsável para enviar o acesso.')
      return
    }

    setLoading(true)
    const supabase = createClient()

    const { data: unit, error: insertError } = await supabase
      .from('units')
      .insert({
        org_id: orgId,
        name,
        slug,
        region_city: city || null,
        region_state: state || null,
        whatsapp_phone: whatsapp || null,
        email_from: emailFrom || null,
        messaging_channel: messagingChannel,
        default_conversation_language: language,
        evolution_api_url: evolutionApiUrl || null,
        evolution_api_key: evolutionApiKey || null,
        evolution_instance_name: evolutionInstanceName || null,
        crm_integration_mode: crmIntegrationMode,
        smarter_crm_partner_token: smarterCrmPartnerToken || null,
        recruiting_integration_mode: recruitingIntegrationMode,
        smarter_recruiting_partner_token: smarterRecruitingPartnerToken || null,
        smarter_recruiting_company_id: smarterRecruitingCompanyId || null,
      })
      .select('id')
      .single()

    if (insertError || !unit) {
      setLoading(false)
      setError('Não foi possível criar a unidade. Verifique se o slug já está em uso.')
      return
    }

    let welcomeStatus: 'sent' | 'failed' | null = null
    if (createOwnerAccess) {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: ownerEmail.trim(),
          name: ownerName.trim() || null,
          org_id: orgId,
          unit_id: unit.id,
        }),
      })
      welcomeStatus = res.ok ? 'sent' : 'failed'
    }

    setLoading(false)
    router.push(`/dashboard/units/${unit.id}${welcomeStatus ? `?welcome=${welcomeStatus}` : ''}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl">
      <FormSection title="Dados da unidade">
        {organizations && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="orgId">Empresa</Label>
            <Select id="orgId" required value={orgId} onChange={(e) => setOrgId(e.target.value)}>
              <option value="" disabled>Selecione a empresa</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </Select>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" required value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Alizo Campinas" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slug">Slug</Label>
          <Input
            id="slug"
            required
            value={slug}
            onChange={(e) => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
            placeholder="alizo-campinas"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="city">Cidade</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Campinas" />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="state">Estado</Label>
            <Input id="state" value={state} onChange={(e) => setState(e.target.value)} placeholder="SP" />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <Input id="whatsapp" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="+55 19 99999-9999" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="emailFrom">Email de envio</Label>
          <Input
            id="emailFrom"
            type="email"
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="campinas@alizo.com.br"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="messagingChannel">Canal de mensagens</Label>
          <Select
            id="messagingChannel"
            value={messagingChannel}
            onChange={(e) => setMessagingChannel(e.target.value as 'whatsapp' | 'sms')}
          >
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS (Twilio)</option>
          </Select>
          <p className="text-xs text-slate-500">
            Sugestão: Brasil → WhatsApp, EUA → SMS (fora do Brasil o WhatsApp costuma não ser o canal
            dominante). Escolha manualmente conforme o mercado da unidade — para SMS, as credenciais Twilio
            se conectam depois em Canal de mensagens (SMS).
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="language">Idioma padrão de atendimento</Label>
          <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as Locale)}>
            <option value="pt">Português</option>
            <option value="en">Inglês (EUA)</option>
          </Select>
          <p className="text-xs text-slate-500">
            Sugestão pelo seu país de acesso: EUA → Inglês, Brasil → Português. É o idioma padrão em que o
            funcionário digital conduz a entrevista de contratação e atende leads/candidatos — ele muda de
            idioma automaticamente se a pessoa pedir ou escrever em outro idioma.
          </p>
        </div>

        <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-sm font-medium text-slate-300">Evolution API (WhatsApp)</span>
          <p className="text-xs text-slate-500">Opcional. Preencha para conectar o WhatsApp desta unidade.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="evolutionApiUrl">URL da instância</Label>
          <Input id="evolutionApiUrl" value={evolutionApiUrl} onChange={(e) => setEvolutionApiUrl(e.target.value)} placeholder="https://evolution.suaempresa.com" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="evolutionApiKey">API key</Label>
          <Input id="evolutionApiKey" type="password" value={evolutionApiKey} onChange={(e) => setEvolutionApiKey(e.target.value)} placeholder="sua_api_key" />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="evolutionInstanceName">Nome da instância</Label>
          <Input id="evolutionInstanceName" value={evolutionInstanceName} onChange={(e) => setEvolutionInstanceName(e.target.value)} placeholder="alizo-campinas" />
        </div>

        <div className="flex flex-col gap-1 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <span className="text-sm font-medium text-slate-300">Integração com a Smarter</span>
          <p className="text-xs text-slate-500">
            Opcional na criação — pode deixar em nativo e configurar depois na tela da unidade. Vincula esta
            unidade a uma empresa/unidade real do Sistema Smarter. Os tokens de parceiro são gerados pela
            equipe da Smarter e colados aqui, não pelo Alizo.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="crmIntegrationMode">CRM de vendas (Sales Rep)</Label>
          <Select
            id="crmIntegrationMode"
            value={crmIntegrationMode}
            onChange={(e) => setCrmIntegrationMode(e.target.value as 'native' | 'smarter')}
          >
            <option value="native">Nativo (CRM próprio do Alizo)</option>
            <option value="smarter">Espelhar no CRM da Smarter</option>
          </Select>
        </div>

        {crmIntegrationMode === 'smarter' && (
          <div className="flex flex-col gap-1.5 pl-4" style={{ borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
            <Label htmlFor="smarterCrmPartnerToken">Token de parceiro — CRM da Smarter</Label>
            <Input
              id="smarterCrmPartnerToken"
              type="password"
              value={smarterCrmPartnerToken}
              onChange={(e) => setSmarterCrmPartnerToken(e.target.value)}
              placeholder="token Bearer gerado no lado da Smarter para esta unidade"
            />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="recruitingIntegrationMode">Recrutamento (Recruiter)</Label>
          <Select
            id="recruitingIntegrationMode"
            value={recruitingIntegrationMode}
            onChange={(e) => setRecruitingIntegrationMode(e.target.value as 'native' | 'smarter')}
          >
            <option value="native">Nativo (pipeline próprio do Alizo)</option>
            <option value="smarter">Publicar no sistema de vagas da Smarter</option>
          </Select>
        </div>

        {recruitingIntegrationMode === 'smarter' && (
          <div className="flex flex-col gap-4 pl-4" style={{ borderLeft: '2px solid rgba(255,255,255,0.06)' }}>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smarterRecruitingPartnerToken">Token de parceiro — vagas/candidatos da Smarter</Label>
              <Input
                id="smarterRecruitingPartnerToken"
                type="password"
                value={smarterRecruitingPartnerToken}
                onChange={(e) => setSmarterRecruitingPartnerToken(e.target.value)}
                placeholder="token Bearer gerado no lado da Smarter para esta unidade"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="smarterRecruitingCompanyId">ID da empresa/franquia na Smarter</Label>
              <Input
                id="smarterRecruitingCompanyId"
                value={smarterRecruitingCompanyId}
                onChange={(e) => setSmarterRecruitingCompanyId(e.target.value)}
                placeholder="companyId desta unidade no Sistema Smarter"
              />
              <p className="text-xs text-slate-500">
                Obrigatório para publicar vaga — sem ele a integração fica incompleta mesmo com token válido.
              </p>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <label className="flex items-start gap-2.5 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={createOwnerAccess}
              onChange={(e) => setCreateOwnerAccess(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-white/20 bg-transparent accent-cyan-500"
            />
            <span>
              Criar acesso e enviar e-mail de boas-vindas para o responsável desta unidade
              <span className="mt-0.5 block text-xs text-slate-500">
                Deixe desmarcado se esta unidade não deve ter login na plataforma (ex.: unidades que operam só
                pela integração com o sistema da Smarter).
              </span>
            </span>
          </label>

          {createOwnerAccess && (
            <div className="grid grid-cols-2 gap-4 pl-6">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ownerEmail">E-mail do responsável</Label>
                <Input
                  id="ownerEmail"
                  type="email"
                  required={createOwnerAccess}
                  value={ownerEmail}
                  onChange={(e) => setOwnerEmail(e.target.value)}
                  placeholder="responsavel@empresa.com"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ownerName">Nome do responsável</Label>
                <Input id="ownerName" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="Nome" />
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 self-start rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
        >
          {loading ? 'Salvando...' : 'Salvar unidade'}
        </button>
      </FormSection>
    </form>
  )
}
