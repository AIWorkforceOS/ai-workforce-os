import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { runDatabaseBackup } from '@/lib/backup'
import { logSystemEvent } from '@/lib/system-events'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * Backup diário dos dados de negócio (pedido do Vinicius, 2026-09-27):
 * "todas informações, valores, WOs, valores lançados precisa esta
 * sempre salvo nunca pode se perder, precisa ter backup diario ou
 * semanal". Roda todo dia (ver apps/web/vercel.json) — o botão "buscar
 * agora" não existe aqui de propósito, isso é rede de segurança, não
 * uma ação que alguém precisa lembrar de disparar.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization') ?? ''

  if (!cronSecret) {
    console.error('[cron/db-backup] CRON_SECRET não configurado — cron desabilitado.')
    return NextResponse.json({ error: 'CRON_SECRET não configurado.' }, { status: 500 })
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) {
    console.error('[cron/db-backup] SUPABASE_SERVICE_ROLE_KEY não configurada.')
    return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })
  }

  const result = await runDatabaseBackup(supabase)
  const failed = result.tables.filter((t) => t.error)
  const totalRows = result.tables.reduce((sum, t) => sum + t.rows, 0)

  await logSystemEvent(supabase, {
    level: failed.length > 0 ? 'error' : 'info',
    source: 'backup',
    eventType: 'daily_backup_run',
    message:
      failed.length > 0
        ? `Backup diário (${result.date}): ${totalRows} linha(s) salva(s), mas ${failed.length} tabela(s) falharam — ${failed
            .map((t) => `${t.table}: ${t.error}`)
            .join('; ')}`
        : `Backup diário (${result.date}) concluído: ${result.tables.length} tabela(s), ${totalRows} linha(s) no total.`,
    metadata: { date: result.date, tables: result.tables },
  })

  return NextResponse.json({ ok: failed.length === 0, ...result })
}
