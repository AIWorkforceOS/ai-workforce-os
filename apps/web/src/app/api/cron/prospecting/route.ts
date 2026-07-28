import { handleProspectingCron } from '@/lib/prospecting/cron-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rodada da manhã da prospecção autônoma (ver lib/prospecting/cron-handler.ts). */
export async function GET(request: Request) {
  return handleProspectingCron(request)
}
