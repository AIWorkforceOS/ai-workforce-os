import { logResendUsage } from '@/lib/api-usage'

export function getResendApiKey(): string | null {
  return process.env.RESEND_API_KEY || null
}

function defaultFrom(): string | null {
  const domain = process.env.EMAIL_FROM_DOMAIN
  return domain ? `AI Workforce OS <alerts@${domain}>` : null
}

type SendResult = { ok: boolean; error?: string }

type EmailAttachment = { filename: string; content: string }

async function sendEmail(params: {
  to: string
  from: string
  subject: string
  html: string
  replyTo?: string | null
  attachments?: EmailAttachment[]
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
      body: JSON.stringify({
        to: params.to,
        from: params.from,
        subject: params.subject,
        html: params.html,
        ...(params.replyTo ? { reply_to: params.replyTo } : {}),
        ...(params.attachments && params.attachments.length > 0 ? { attachments: params.attachments } : {}),
      }),
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
  /** Rótulo de quem está escalando, para o corpo do e-mail. Default preserva o texto histórico (SDR era o único emissor até o Receptionist ganhar canal real). */
  agentLabel?: string
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({
    to: params.to,
    from,
    subject: `[${params.unitName}] Escalação: ${params.leadName}`,
    html: `
      <p>O ${params.agentLabel ?? 'AI Sales Representative'} da unidade <strong>${params.unitName}</strong> escalou uma conversa para atendimento humano.</p>
      <p><strong>Lead:</strong> ${params.leadName}${params.leadPhone ? ` (${params.leadPhone})` : ''}</p>
      <p><strong>Motivo:</strong> ${params.reason}</p>
      <p><strong>Última mensagem:</strong> ${params.lastMessage}</p>
    `,
  })
}

/**
 * Aviso ao dono/admin da unidade quando o Sales Rep fecha um negócio que
 * NÃO é recrutamento (essa automação cria vaga sozinha — ver
 * lib/sales/deal-handoff.ts). Sem isso, o único registro do fechamento
 * era um system_event que ninguém olha proativamente: o dono só sabia se
 * entrasse no painel. Mesmo padrão de sendEscalationEmail — best-effort,
 * nunca lança.
 */
export async function sendDealWonEmail(params: {
  to: string
  unitName: string
  leadName: string
  leadPhone: string | null
  dealAction: string | null
  dealProfile: Record<string, unknown>
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  const profileRows = Object.entries(params.dealProfile)
    .filter(([, value]) => value !== null && value !== undefined && value !== '')
    .map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(String(value))}</li>`)
    .join('')

  return sendEmail({
    to: params.to,
    from,
    subject: `[${params.unitName}] Negócio fechado: ${params.leadName}`,
    html: `
      <p>O AI Sales Representative da unidade <strong>${params.unitName}</strong> fechou um negócio.</p>
      <p><strong>Cliente/lead:</strong> ${params.leadName}${params.leadPhone ? ` (${params.leadPhone})` : ''}</p>
      ${params.dealAction ? `<p><strong>Próximo passo ensinado para este momento:</strong> ${params.dealAction}</p>` : ''}
      ${profileRows ? `<p><strong>Dados coletados na conversa:</strong></p><ul>${profileRows}</ul>` : ''}
      <p>Nenhuma automação foi executada além deste aviso — encaminhe manualmente com os dados acima.</p>
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
  /** PDF da biblioteca de anexos (migration 036) a anexar de verdade neste e-mail via Resend — mesmo mecanismo de sendLeadEmail. */
  attachment?: { title: string; url: string; fileName?: string | null } | null
}): Promise<SendResult> {
  const from = defaultFrom()
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  let attachments: EmailAttachment[] | undefined
  if (params.attachment) {
    const content = await fetchAttachmentContent(params.attachment.url)
    if (content) attachments = [{ filename: attachmentFileName(params.attachment), content }]
  }

  return sendEmail({ to: params.to, from, subject: params.subject, html: params.html, attachments })
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * E-mail é sempre enviado pelo domínio da plataforma (EMAIL_FROM_DOMAIN,
 * verificado no Resend) — um domínio próprio do cliente não está
 * verificado ali, então usá-lo como `from` faria o Resend rejeitar o
 * envio. O nome de exibição do remetente já carrega a marca do cliente
 * (persona + unidade), e `replyTo` (units.email_reply_to) faz as
 * respostas do lead caírem na caixa de entrada real da empresa mesmo
 * com o endereço técnico sendo da plataforma.
 */
function salesFrom(displayName: string): string | null {
  const domain = process.env.EMAIL_FROM_DOMAIN
  return domain ? `${displayName} <sales@${domain}>` : null
}

/**
 * Template HTML genérico com a marca do cliente (logo, se configurada)
 * para as mensagens do Sales Rep por e-mail — item 4 do pedido do
 * produto: layout profissional, sem hardcode de tipo de negócio.
 * `bodyText` é a resposta em texto simples gerada pelo mesmo motor de
 * conversa usado no WhatsApp/SMS (lib/conversation-engine.ts); aqui só
 * viramos cada linha em um parágrafo.
 */
function buildBrandedEmailHtml(params: {
  unitName: string
  logoUrl: string | null
  bodyText: string
  /** Título do material da biblioteca de anexos (migration 036) anexado a este e-mail, se houver. */
  attachmentTitle?: string | null
}): string {
  const paragraphs = params.bodyText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1e293b;">${escapeHtml(line)}</p>`)
    .join('')

  const logoBlock = params.logoUrl
    ? `<img src="${escapeHtml(params.logoUrl)}" alt="${escapeHtml(params.unitName)}" style="max-height:40px;max-width:220px;height:auto;width:auto;" />`
    : `<span style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(params.unitName)}</span>`

  const attachmentBlock = params.attachmentTitle
    ? `<div style="margin-top:8px;padding:12px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;">
         <p style="margin:0;font-size:13px;color:#475569;">Anexo: <strong>${escapeHtml(params.attachmentTitle)}</strong></p>
       </div>`
    : ''

  return `
    <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
          ${logoBlock}
        </div>
        <div style="padding:32px;">
          ${paragraphs}
          ${attachmentBlock}
        </div>
        <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">Mensagem enviada por ${escapeHtml(params.unitName)}. Basta responder este e-mail para continuar a conversa.</p>
        </div>
      </div>
    </div>
  `
}

/**
 * Busca o arquivo público (Storage) do anexo e devolve em base64 pro
 * formato de attachments do Resend. Best-effort: se o fetch falhar
 * (arquivo removido, URL inválida, tamanho acima do aceito pelo Resend),
 * devolve null e quem chama segue o envio do e-mail sem o anexo em vez
 * de bloquear a conversa inteira por causa de um arquivo.
 */
export async function fetchAttachmentContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    return buffer.toString('base64')
  } catch {
    return null
  }
}

export function attachmentFileName(attachment: { title: string; url: string; fileName?: string | null }): string {
  if (attachment.fileName) return attachment.fileName
  const fromUrl = attachment.url.split('/').pop()?.split('?')[0]
  return fromUrl && fromUrl.includes('.') ? fromUrl : `${attachment.title}.pdf`
}

/**
 * `from` do e-mail de campanha (newsletter em massa) — mesmo raciocínio de
 * salesFrom: domínio sempre da plataforma (verificado no Resend), nome de
 * exibição carrega a marca da unidade. Subdomínio próprio (news@) para não
 * misturar reputação de envio com o 1:1 do Sales Rep (sales@) nem com
 * transacional (billing@/alerts@).
 */
function marketingFrom(unitName: string): string | null {
  const domain = process.env.EMAIL_FROM_DOMAIN
  return domain ? `${unitName} <news@${domain}>` : null
}

/**
 * Template HTML da campanha de e-mail marketing em massa (migration 043) —
 * mesma marca (logo/nome da unidade) do template transacional
 * (buildBrandedEmailHtml/sendInvoiceEmail), mas com um rodapé de
 * descadastro OBRIGATÓRIO: e-mail em massa sem opt-out é risco de
 * reputação/spam e má prática, então o link nunca fica a critério da IA
 * ou de quem aprova a campanha — é sempre montado aqui, por destinatário.
 */
export function buildMarketingEmailHtml(params: {
  unitName: string
  logoUrl: string | null
  bodyText: string
  unsubscribeUrl: string
}): string {
  const paragraphs = params.bodyText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#1e293b;">${escapeHtml(line)}</p>`)
    .join('')

  const logoBlock = params.logoUrl
    ? `<img src="${escapeHtml(params.logoUrl)}" alt="${escapeHtml(params.unitName)}" style="max-height:40px;max-width:220px;height:auto;width:auto;" />`
    : `<span style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(params.unitName)}</span>`

  return `
    <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
          ${logoBlock}
        </div>
        <div style="padding:32px;">
          ${paragraphs}
        </div>
        <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0 0 6px;font-size:12px;color:#94a3b8;">Você recebeu este e-mail porque tem contato com ${escapeHtml(params.unitName)}.</p>
          <p style="margin:0;font-size:12px;color:#94a3b8;"><a href="${escapeHtml(params.unsubscribeUrl)}" style="color:#64748b;text-decoration:underline;">Não quero mais receber estes e-mails</a></p>
        </div>
      </div>
    </div>
  `
}

/**
 * Envia UM e-mail de uma campanha em massa (migration 043) para um único
 * destinatário — quem chama (lib/marketing-email/sender.ts) itera a lista
 * de destinatários e monta a URL de descadastro por pessoa (token único).
 */
export async function sendMarketingCampaignEmail(params: {
  to: string
  unitName: string
  logoUrl: string | null
  subject: string
  bodyText: string
  unsubscribeUrl: string
}): Promise<SendResult> {
  const from = marketingFrom(params.unitName)
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  return sendEmail({
    to: params.to,
    from,
    subject: params.subject,
    html: buildMarketingEmailHtml({
      unitName: params.unitName,
      logoUrl: params.logoUrl,
      bodyText: params.bodyText,
      unsubscribeUrl: params.unsubscribeUrl,
    }),
  })
}

/**
 * Fatura/recibo de serviço prestado, enviada ao cliente final da empresa
 * (migration 030 — tabela invoices). Sem gateway de pagamento nesta fase:
 * o e-mail registra o valor e traz as instruções de pagamento que a
 * empresa escreveu em `paymentNotes` (Zelle, PIX, link, etc). Bilíngue
 * pelo idioma da unidade (unitDefaultLocale), como as mensagens da agenda.
 */
export async function sendInvoiceEmail(params: {
  to: string
  unitName: string
  logoUrl: string | null
  customerName: string
  invoiceNumber: string
  description: string
  amount: number
  currency: string
  dueDate: string | null
  paymentNotes: string | null
  locale: 'pt' | 'en'
  replyTo?: string | null
  /** faturas originais somadas nesta (migration 045) — detalhamento exibido por transparência */
  consolidatedItems?: { description: string; amount: number; due_date: string | null }[] | null
  /** PDF da fatura (migration 048) já gerado em memória — base64, pronto pro payload do Resend. */
  attachment?: { filename: string; content: string } | null
}): Promise<SendResult> {
  const domain = process.env.EMAIL_FROM_DOMAIN
  if (!domain) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }
  const from = `${params.unitName} <billing@${domain}>`

  const isEn = params.locale === 'en'
  const intlLocale = isEn ? 'en-US' : 'pt-BR'
  const amountLabel = params.amount.toLocaleString(intlLocale, { style: 'currency', currency: params.currency })
  const dueLabel = params.dueDate
    ? new Date(`${params.dueDate}T00:00:00`).toLocaleDateString(intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric' })
    : null

  const t = isEn
    ? {
        subject: `Invoice ${params.invoiceNumber} — ${params.unitName}`,
        greeting: `Hi ${params.customerName},`,
        intro: `Here is your invoice from ${params.unitName}.`,
        invoice: 'Invoice',
        service: 'Service',
        amount: 'Amount',
        dueDate: 'Due date',
        payment: 'Payment instructions',
        includes: 'Includes',
        footer: `Invoice sent by ${params.unitName}. Reply to this email if you have any questions.`,
      }
    : {
        subject: `Fatura ${params.invoiceNumber} — ${params.unitName}`,
        greeting: `Olá, ${params.customerName}!`,
        intro: `Segue a sua fatura de ${params.unitName}.`,
        invoice: 'Fatura',
        service: 'Serviço',
        amount: 'Valor',
        dueDate: 'Vencimento',
        payment: 'Como pagar',
        includes: 'Inclui',
        footer: `Fatura enviada por ${params.unitName}. Responda este e-mail em caso de dúvidas.`,
      }

  const logoBlock = params.logoUrl
    ? `<img src="${escapeHtml(params.logoUrl)}" alt="${escapeHtml(params.unitName)}" style="max-height:40px;max-width:220px;height:auto;width:auto;" />`
    : `<span style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(params.unitName)}</span>`

  const row = (label: string, value: string, highlight = false) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:13px;color:#64748b;">${label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #e2e8f0;font-size:${highlight ? '18px' : '14px'};font-weight:${highlight ? '800' : '600'};color:#0f172a;text-align:right;">${value}</td>
    </tr>`

  const paymentBlock = params.paymentNotes
    ? `<div style="margin-top:24px;padding:16px;border-radius:12px;background:#f8fafc;border:1px solid #e2e8f0;">
         <p style="margin:0 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">${t.payment}</p>
         <p style="margin:0;font-size:14px;line-height:1.6;color:#1e293b;white-space:pre-line;">${escapeHtml(params.paymentNotes)}</p>
       </div>`
    : ''

  const itemsBlock =
    params.consolidatedItems && params.consolidatedItems.length > 0
      ? `<div style="margin-top:16px;">
           <p style="margin:0 0 8px;font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;">${t.includes}</p>
           <table style="width:100%;border-collapse:collapse;">
             ${params.consolidatedItems
               .map(
                 (item) => `
               <tr>
                 <td style="padding:6px 0;font-size:13px;color:#475569;">${escapeHtml(item.description)}</td>
                 <td style="padding:6px 0;font-size:13px;font-weight:600;color:#334155;text-align:right;">${escapeHtml(
                   item.amount.toLocaleString(intlLocale, { style: 'currency', currency: params.currency }),
                 )}</td>
               </tr>`,
               )
               .join('')}
           </table>
         </div>`
      : ''

  const html = `
    <div style="background:#f1f5f9;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
        <div style="padding:24px 32px;border-bottom:1px solid #e2e8f0;">
          ${logoBlock}
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#1e293b;">${escapeHtml(t.greeting)}</p>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#1e293b;">${escapeHtml(t.intro)}</p>
          <table style="width:100%;border-collapse:collapse;">
            ${row(t.invoice, escapeHtml(params.invoiceNumber))}
            ${row(t.service, escapeHtml(params.description))}
            ${dueLabel ? row(t.dueDate, dueLabel) : ''}
            ${row(t.amount, escapeHtml(amountLabel), true)}
          </table>
          ${itemsBlock}
          ${paymentBlock}
        </div>
        <div style="padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;">
          <p style="margin:0;font-size:12px;color:#94a3b8;">${escapeHtml(t.footer)}</p>
        </div>
      </div>
    </div>
  `

  return sendEmail({
    to: params.to,
    from,
    subject: t.subject,
    html,
    replyTo: params.replyTo,
    attachments: params.attachment ? [params.attachment] : undefined,
  })
}

/**
 * E-mail de prospecção/acompanhamento do Sales Rep (item 1 do pedido:
 * e-mail como canal adicional, em paralelo ao WhatsApp/SMS). Usado por
 * lib/channels/messaging-channel.ts (EmailChannel) — mesma persona,
 * mesmo texto que sairia por WhatsApp, só embrulhado no template com a
 * marca da unidade.
 */
export async function sendLeadEmail(params: {
  to: string
  unitName: string
  personaName: string
  logoUrl: string | null
  subject: string
  bodyText: string
  replyTo?: string | null
  /** PDF da biblioteca de anexos (migration 036) a anexar de verdade neste e-mail via Resend. */
  attachment?: { title: string; url: string; fileName?: string | null } | null
}): Promise<SendResult> {
  const from = salesFrom(`${params.personaName} · ${params.unitName}`)
  if (!from) return { ok: false, error: 'EMAIL_FROM_DOMAIN não está configurada.' }

  let attachments: EmailAttachment[] | undefined
  if (params.attachment) {
    const content = await fetchAttachmentContent(params.attachment.url)
    if (content) attachments = [{ filename: attachmentFileName(params.attachment), content }]
  }

  return sendEmail({
    to: params.to,
    from,
    subject: params.subject,
    html: buildBrandedEmailHtml({
      unitName: params.unitName,
      logoUrl: params.logoUrl,
      bodyText: params.bodyText,
      attachmentTitle: params.attachment?.title ?? null,
    }),
    replyTo: params.replyTo,
    attachments,
  })
}
