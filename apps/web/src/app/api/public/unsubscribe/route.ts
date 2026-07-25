import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * Descadastro de e-mail marketing em massa (migration 043) — link no
 * rodapé de todo e-mail de campanha (lib/email.ts:buildMarketingEmailHtml).
 *
 * Rota pública (sem sessão): usa service role pra gravar
 * marketing_opt_out=true, mesmo princípio de risco baixo do
 * public_lead_intake_token — o token é um uuid aleatório específico do
 * lead/customer (leads.unsubscribe_token/customers.unsubscribe_token), se
 * vazar o pior caso é aquele contato ser descadastrado de campanhas.
 *
 * GET (não POST) de propósito: é o link clicado direto no cliente de
 * e-mail, sem formulário/JS — padrão do mercado para unsubscribe.
 * Idempotente (marcar true de novo não tem efeito colateral).
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get('type')
  const token = url.searchParams.get('token')

  if ((type !== 'lead' && type !== 'customer') || !token) {
    return htmlResponse('Link de descadastro inválido.', 400)
  }

  const supabase = createServiceClient()
  if (!supabase) {
    return htmlResponse('Serviço indisponível no momento. Tente novamente mais tarde.', 500)
  }

  const table = type === 'lead' ? 'leads' : 'customers'
  const { data, error } = await supabase
    .from(table)
    .update({ marketing_opt_out: true })
    .eq('unsubscribe_token', token)
    .select('id')
    .maybeSingle()

  if (error) return htmlResponse('Não foi possível processar seu descadastro agora. Tente novamente mais tarde.', 500)
  if (!data) return htmlResponse('Link de descadastro inválido ou já processado.', 404)

  return htmlResponse('Você foi descadastrado(a) com sucesso e não receberá mais e-mails de campanha desta empresa.', 200)
}

function htmlResponse(message: string, status: number): NextResponse {
  const html = `<!doctype html>
<html lang="pt-BR">
<head><meta charset="utf-8" /><title>Descadastro</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#f1f5f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;">
  <div style="max-width:420px;margin:16px;padding:32px;background:#fff;border-radius:16px;border:1px solid #e2e8f0;text-align:center;">
    <p style="font-size:15px;line-height:1.6;color:#1e293b;">${message}</p>
  </div>
</body>
</html>`
  return new NextResponse(html, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}
