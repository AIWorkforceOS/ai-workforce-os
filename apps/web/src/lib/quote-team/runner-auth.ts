import { createHash, timingSafeEqual } from 'node:crypto'

const digest = (value: string) => createHash('sha256').update(value).digest()

/**
 * Chamada servidor-a-servidor (cron da Vercel ou disparo imediato após salvar): cabeçalho `Authorization: Bearer <CRON_SECRET>`.
 * Comparação em tempo constante; sem CRON_SECRET configurado ninguém passa (nunca "aberto por padrão").
 */
export function isRunnerAuthorized(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`))
}
