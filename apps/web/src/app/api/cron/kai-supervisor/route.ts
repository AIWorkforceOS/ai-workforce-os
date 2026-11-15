import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runKaiSupervisor } from '@/lib/kai/supervisor'
import { logSystemEvent } from '@/lib/system-events'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }
  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  try {
    const result = await runKaiSupervisor(supabase)
    await logSystemEvent(supabase, {
      level: 'info', source: 'system', eventType: 'kai_supervisor_run',
      message: `Kai supervisionou ${result.scanned} eventos, encontrou ${result.uncertified} funcionário(s) sem certificação e criou ${result.created} tarefa(s).`,
      metadata: result,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    await logSystemEvent(supabase, {
      level: 'error', source: 'system', eventType: 'kai_supervisor_failed',
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json({ error: 'Falha ao executar supervisão.' }, { status: 500 })
  }
}
