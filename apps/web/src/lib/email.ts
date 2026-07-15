import { logResendUsage } from '@/lib/api-usage'

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY || null
}

function defaultFrom(): string | null {
  const domain = process.env.EMAIL_FROM_DOMAIN
  return domain ? `AI Workforce OS <alerts@${domain}>` : null
}

type SendResult = { ok: boolean; error?: string }

async function sendEmail(params: {
  to: string
  from: string
  subject: string
  html: string
}): Promise<SendResult> {
  const apiKey = getResendApiKey()
  if (!apiKey) {
    return { ok: false, error: 'RESEND_API_KEY não está configurada.' }
  }

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(params),
    })

    if (!response.ok) {
      const data = await response.json().catch(() => null)
      return { ok: false, error: data?.message ?? `Resend retornou status ${response.status}` }
    }

    await logResendUsage()

    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Erro ao enviar email.' }
  }
}

export async function sendEscalationEmail(params: {
  to: string
  unitName: string
  leadName: string
  leadPhone: string | null
  reason: string
  lastMessage: string
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({
    to: params.to,
    from,
    subject: `[${params.unitName}] Escalação: ${params.leadName}`,
    html: `
      <p>O AI Sales Representative da unidade <strong>${params.unitName}</strong> escalou uma conversa para atendimento humano.</p>
      <p><strong>Lead:</strong> ${params.leadName}${params.leadPhone ? ` (${params.leadPhone})` : ''}</p>
      <p><strong>Motivo:</strong> ${params.reason}</p>
      <p><strong>Última mensagem:</strong> ${params.lastMessage}</p>
    `,
  })
}

export async function sendTechnicalAlertEmail(params: {
  to: string
  unitName: string
  problem: string
  impact: string
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({
    to: params.to,
    from,
    subject: `[${params.unitName}] ⚠️ Falha técnica no agente IA`,
    html: `
      <p>O agente IA da unidade <strong>${params.unitName}</strong> encontrou uma falha técnica e pode ter deixado de responder um lead.</p>
      <p><strong>Problema:</strong> ${params.problem}</p>
      <p><strong>Impacto:</strong> ${params.impact}</p>
      <p>Verifique o painel (Dashboard → Saúde das integrações) para mais detalhes.</p>
    `,
  })
}

/**
 * E-mail genérico do Recruiter Employee (handoff, briefing de busca
 * externa, escalações de processo). Mesmo Resend/from dos demais.
 */
export async function sendRecruiterEmail(params: {
  to: string
  subject: string
  html: string
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({ to: params.to, from, subject: params.subject, html: params.html })
}

/**
 * E-mail de boas-vindas disparado ao final do cadastro de uma empresa
 * (admin Alizo cadastrando ou cliente se cadastrando no /checkout).
 *
 * Quando `setPasswordUrl` é informado, o e-mail traz um link seguro de
 * primeiro acesso (invite/recovery do Supabase Auth) em vez de senha em
 * texto puro. Sem `setPasswordUrl` (ex.: checkout, onde a pessoa já
 * escolheu a própria senha), o e-mail só confirma o cadastro e aponta
 * para o login.
 */
export async function sendWelcomeEmail(params: {
  to: string
  name: string | null
  companyName: string
  setPasswordUrl?: string | null
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://SEU-DOMINIO.vercel.app').replace(/\/+$/, '')
  const greeting = params.name ? `Olá, ${params.name}!` : 'Olá!'
  const cta = params.setPasswordUrl
    ? `<p><a href="${params.setPasswordUrl}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#06b6d4;color:#fff;text-decoration:none;font-weight:700;">Definir minha senha e entrar</a></p>
       <p style="font-size:12px;color:#64748b;">Esse link é pessoal e expira em breve. Se não funcionar, fale com a equipe Alizo.</p>`
    : `<p><a href="${appUrl}/login" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#06b6d4;color:#fff;text-decoration:none;font-weight:700;">Entrar no painel</a></p>
       <p style="font-size:12px;color:#64748b;">Use o e-mail e a senha que você criou no cadastro.</p>`

  return sendEmail({
    to: params.to,
    from,
    subject: `Bem-vindo à Alizo, ${params.companyName}!`,
    html: `
      <p>${greeting}</p>
      <p>A conta da <strong>${params.companyName}</strong> já está pronta na Alizo — seu funcionário digital está a poucos passos de começar a atender.</p>
      ${cta}
      <p>Qualquer dúvida, é só responder este e-mail.</p>
    `,
  })
}

export async function sendNewLeadEmail(params: {
  to: string
  unitName: string
  leadName: string
  leadPhone: string | null
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({
    to: params.to,
    from,
    subject: `[${params.unitName}] Novo lead prospectado: ${params.leadName}`,
    html: `
      <p>Um novo lead foi prospectado e o primeiro contato já foi enviado pelo AI Sales Representative da unidade <strong>${params.unitName}</strong>.</p>
      <p><strong>Empresa:</strong> ${params.leadName}${params.leadPhone ? ` (${params.leadPhone})` : ''}</p>
    `,
  })
}
