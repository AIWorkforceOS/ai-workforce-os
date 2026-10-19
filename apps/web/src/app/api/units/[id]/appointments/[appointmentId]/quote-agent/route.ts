import { NextResponse } from 'next/server'
import { buildAgentState, loadAgentContext } from '@/lib/quote-team/agent/server'

export const dynamic = 'force-dynamic'

/** Estado da cotação com IA desta WO (andamento, conversa, versão atual). Técnico: só a camada técnica; admin: também custos e comercial. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; appointmentId: string }> }) {
  const { id, appointmentId } = await params
  const loaded = await loadAgentContext(id, appointmentId)
  if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
  return NextResponse.json(await buildAgentState(loaded.ctx), { headers: { 'Cache-Control': 'no-store' } })
}
