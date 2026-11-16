import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { logSystemEvent } from '@/lib/system-events'
import { publishDueScheduledPosts } from '@/lib/content/publisher'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * Worker recorrente e independente da geração de conteúdo. Processa um lote
 * pequeno em paralelo; o que não couber volta automaticamente no próximo
 * ciclo, sem exigir nova aprovação humana.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 })
  }

  const supabase = createServiceClient()
  if (!supabase) return NextResponse.json({ error: 'Serviço não configurado.' }, { status: 500 })

  const outcome = await publishDueScheduledPosts(supabase, { maxPosts: 3 })
  await logSystemEvent(supabase, {
    level: outcome.errors > 0 ? 'warning' : 'info',
    source: 'cron',
    eventType: 'content_publish_run',
    message: `Publicação de conteúdo: ${outcome.published} publicado(s), ${outcome.errors} erro(s) ou nova(s) tentativa(s) pendente(s).`,
    metadata: outcome,
  })

  return NextResponse.json({ ok: true, ...outcome })
}
