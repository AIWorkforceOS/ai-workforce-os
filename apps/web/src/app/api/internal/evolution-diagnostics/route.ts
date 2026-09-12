import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Diagnóstico TEMPORÁRIO (2026-09-12): investigar por que a reconexão do
 * WhatsApp da Ana (unidade Smarter Matriz) está retornando "fetch failed"
 * — erro de rede, não de credencial. Testa se o servidor da Evolution API
 * (configurado em EVOLUTION_API_URL/EVOLUTION_API_KEY) está de fato
 * alcançável a partir da Vercel, sem nunca expor a URL ou a chave na
 * resposta. Rota protegida por um token fixo só pra essa investigação —
 * remover assim que o diagnóstico terminar.
 */
const DIAG_TOKEN = '7b32cd3e553a81d893753347f18a1cd0'

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (token !== DIAG_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = process.env.EVOLUTION_API_URL
  const key = process.env.EVOLUTION_API_KEY
  if (!url || !key) {
    return NextResponse.json({ configured: false })
  }

  const started = Date.now()
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/instance/fetchInstances`, {
      headers: { apikey: key },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    return NextResponse.json({
      configured: true,
      reachable: true,
      status: res.status,
      ms: Date.now() - started,
    })
  } catch (error) {
    return NextResponse.json({
      configured: true,
      reachable: false,
      errorName: error instanceof Error ? error.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      cause: error instanceof Error && error.cause ? String(error.cause) : null,
      ms: Date.now() - started,
    })
  }
}
