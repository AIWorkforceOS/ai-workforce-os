import { handleProspectingCron } from '@/lib/prospecting/cron-handler'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Rodada do meio do dia da prospecção autônoma. Rota separada porque o
 * plano Hobby do Vercel só aceita cadência diária por cron job — três
 * jobs diários espalhados pelo dia dão o efeito de "trabalhar o dia
 * todo" sem quebrar o deploy (ver lib/prospecting/cron-handler.ts).
 */
export async function GET(request: Request) {
  return handleProspectingCron(request)
}
