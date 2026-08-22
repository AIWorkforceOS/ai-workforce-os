import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOpenAIApiKey } from '@/lib/openai'
import { formatTranscript, summarizeConversation } from '@/lib/leads/conversation-summary'
import type { Conversation } from '@/lib/types'

/**
 * POST /api/conversations/[lead_id]/summarize — "Gerar resumo" na Caixa de
 * Entrada (Fase 4). Deliberadamente SÓ SOB DEMANDA: nunca dispara sozinho
 * ao abrir a tela — cada clique é um custo de API explícito e visível pro
 * usuário, decisão tomada com o Vinicius em 2026-08-20 (ver
 * docs/ux-audit-fase1-2026-08-19.md). Não persiste em banco — regenera a
 * cada clique, de propósito, pra não precisar de migration nesta etapa.
 */
export async function POST(request: Request, { params }: { params: Promise<{ lead_id: string }> }) {
  const { lead_id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const apiKey = getOpenAIApiKey()
  if (!apiKey) {
    return NextResponse.json({ error: 'not_configured', message: 'Integração com IA não configurada nesta conta.' }, { status: 503 })
  }

  const { data: messages } = await supabase
    .from('conversations')
    .select('direction, content')
    .eq('lead_id', lead_id)
    .order('sent_at', { ascending: true })

  const rows = (messages as Pick<Conversation, 'direction' | 'content'>[] | null) ?? []
  if (rows.length === 0) {
    return NextResponse.json({ error: 'no_messages', message: 'Ainda não há mensagens nesta conversa pra resumir.' }, { status: 422 })
  }

  try {
    const result = await summarizeConversation({ apiKey, transcript: formatTranscript(rows) })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json(
      { error: 'summarize_failed', message: err instanceof Error ? err.message : 'Falha ao gerar resumo.' },
      { status: 502 },
    )
  }
}
