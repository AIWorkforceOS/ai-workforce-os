import { type NextRequest, NextResponse } from 'next/server'
import { generateChatReply, getOpenAIApiKey, type ChatMessage } from '@/lib/openai'

// ─── AI Sales Agent (Kai) — powered by OpenAI ───────────────────────────────
// Set OPENAI_API_KEY in your Vercel environment variables

const SYSTEM_PROMPT_SALES = `Você é Kai, o consultor de vendas virtual do AI Workforce OS.
Sua missão: tirar dúvidas, quebrar objeções e ajudar o visitante a tomar a decisão certa agora.

SOBRE O PRODUTO:
- AI Workforce OS é uma plataforma que cria funcionários de IA para empresas e redes de franquias
- Os agentes IA trabalham 24/7 via WhatsApp, qualificando leads e respondendo clientes
- Planos: Starter (1 unidade), Pro (5 unidades), Enterprise (ilimitado)
- Acesso imediato após pagamento, onboarding guiado incluído
- Garantia de 7 dias com reembolso total
- Aceita cartão, PIX, boleto (Brasil) e cartão/Zelle (EUA)

SEU ESTILO:
- Seja direto, empático e consultivo — não robótico
- Use técnicas de PNL: espelhamento, pergunta poderosa, urgência sutil
- Se o usuário hesitar por preço, mostre o ROI (ex: R$297/mês vs R$3.800 de um funcionário CLT)
- Se mencionar concorrente, destaque: disponibilidade 24/7, configuração em 10 min, suporte em português
- Termine respostas com uma pergunta ou chamada para ação quando apropriado
- Máximo 3 parágrafos por resposta — seja conciso

LINGUAGEM: Responda no mesmo idioma do visitante (PT ou EN). Se PT, use tom profissional mas amigável.`

const SYSTEM_PROMPT_SUPPORT = `Você é Kai, o assistente de suporte e configuração do AI Workforce OS.
Sua missão: ajudar o cliente a configurar seu funcionário IA e resolver dúvidas técnicas.

CONHECIMENTO TÉCNICO:
- Conexão WhatsApp: o cliente conecta via QR Code no painel > Unidades > Conectar WhatsApp
- Configuração do agente: painel > Agentes IA > Nova configuração
- Para trocar senha: painel > Configurações > Segurança
- Para adicionar unidade: painel > Unidades > Nova unidade
- Suporte prioritário: suporte@aiworkforce.com.br

SEU ESTILO:
- Seja paciente, claro e passo a passo
- Se o problema for técnico complexo, ofereça agendar uma chamada
- Responda no idioma do cliente (PT ou EN)
- Máximo 3 parágrafos, use lista numerada quando for passo a passo`

export async function POST(req: NextRequest) {
  try {
    const { messages, mode = 'sales' } = await req.json() as {
      messages: ChatMessage[]
      mode?: 'sales' | 'support'
    }

    const apiKey = getOpenAIApiKey()
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OPENAI_API_KEY not configured' },
        { status: 503 }
      )
    }

    const systemPrompt = mode === 'support' ? SYSTEM_PROMPT_SUPPORT : SYSTEM_PROMPT_SALES

    let reply: string
    try {
      reply = await generateChatReply({
        apiKey,
        systemPrompt,
        history: messages.slice(-10), // keep last 10 messages for context
      })
    } catch (err) {
      console.error('OpenAI API error:', err instanceof Error ? err.message : err)
      return NextResponse.json({ error: 'AI unavailable' }, { status: 502 })
    }

    return NextResponse.json({ reply })
  } catch (err) {
    console.error('Chat API error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
