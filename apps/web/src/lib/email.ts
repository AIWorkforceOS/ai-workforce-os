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
      <p>O agente SDR da unidade <strong>${params.unitName}</strong> escalou uma conversa para atendimento humano.</p>
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
      <p>Um novo lead foi prospectado e o primeiro contato já foi enviado pelo agente SDR da unidade <strong>${params.unitName}</strong>.</p>
      <p><strong>Empresa:</strong> ${params.leadName}${params.leadPhone ? ` (${params.leadPhone})` : ''}</p>
    `,
  })
}
