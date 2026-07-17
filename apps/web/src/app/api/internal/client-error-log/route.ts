import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type ClientErrorPayload = {
  message?: unknown
  stack?: unknown
  digest?: unknown
  route?: unknown
  userAgent?: unknown
}

function truncate(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  return value.length > max ? `${value.slice(0, max)}…[truncated]` : value
}

/**
 * POST /api/internal/client-error-log — recebe as exceções capturadas
 * pelos error boundaries do client (error.tsx/global-error.tsx) e só
 * imprime nos runtime logs da Vercel. Diagnóstico pré-lançamento: sem
 * auth de propósito (o app já quebrou quando isso dispara, às vezes antes
 * de resolver quem é o usuário) e sem tabela no banco — é log mesmo, sem
 * dado sensível gravado além de mensagem/stack do erro.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ClientErrorPayload | null

  console.error(
    '[client-error]',
    JSON.stringify({
      message: truncate(body?.message, 2000) ?? 'unknown error',
      stack: truncate(body?.stack, 4000),
      digest: truncate(body?.digest, 200),
      route: truncate(body?.route, 300),
      userAgent: truncate(body?.userAgent, 300),
      receivedAt: new Date().toISOString(),
    }),
  )

  return NextResponse.json({ ok: true })
}
