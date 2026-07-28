import { handleProspectingCron } from '@/lib/prospecting/cron-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Rodada da tarde da prospecção autônoma (ver prospecting-midday/route.ts para o porquê das 3 rotas). */
export async function GET(request: Request) {
  return handleProspectingCron(request)
}
