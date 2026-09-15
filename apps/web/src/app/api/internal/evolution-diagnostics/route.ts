import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * Diagnóstico TEMPORÁRIO (2026-09-14): a Evolution API está inalcançável
 * e ninguém lembra onde ela está hospedada — só devolve o HOSTNAME
 * configurado (nunca a URL completa nem a chave), pra identificar o
 * provedor de hospedagem sem expor nenhum segredo. Remover assim que o
 * diagnóstico terminar.
 */
const DIAG_TOKEN = '4f9a1c7e2b6d8034f56a9c1e7b2d4f80'

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  if (token !== DIAG_TOKEN) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const url = process.env.EVOLUTION_API_URL
  if (!url) {
    return NextResponse.json({ configured: false })
  }

  try {
    const parsed = new URL(url)
    return NextResponse.json({
      configured: true,
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || null,
      isIp: /^\d{1,3}(\.\d{1,3}){3}$/.test(parsed.hostname),
    })
  } catch {
    return NextResponse.json({ configured: true, parseError: true })
  }
}
