import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { getBrandLogoUrl } from '@/lib/branding/server'
import { parseIconKey, PWA_ICON_SIZES, renderPwaIcon } from '@/lib/branding/pwa'

export const dynamic = 'force-dynamic'

const DEFAULT_ICON: Record<string, string> = { '180': '/pwa/apple-touch-icon.png', '192': '/pwa/icon-192.png', '512': '/pwa/icon-512.png', 'maskable-512': '/pwa/icon-maskable-512.png' }

/**
 * Ícone do app instalado / tela inicial com a logo DA EMPRESA do usuário logado. Sem sessão, sem logo própria ou qualquer falha: devolve o ícone do Alizo
 * (nunca quebra a instalação). A imagem é gerada de uma URL do nosso próprio bucket de marca, já validada no upload.
 */
export async function GET(request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params
  const key = parseIconKey(size)
  if (!key) return NextResponse.json({ error: 'Tamanho inválido.' }, { status: 404 })
  const fallback = () => NextResponse.redirect(new URL(DEFAULT_ICON[key]!, request.url), 307)

  try {
    const appUser = await getAppUser()
    const logoUrl = appUser ? await getBrandLogoUrl(appUser) : null
    if (!logoUrl) return fallback()
    const response = await fetch(logoUrl, { signal: AbortSignal.timeout(8000) })
    if (!response.ok) return fallback()
    const spec = PWA_ICON_SIZES[key]
    const png = await renderPwaIcon(Buffer.from(await response.arrayBuffer()), spec.size, spec.maskable)
    return new NextResponse(new Uint8Array(png), { status: 200, headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=3600' } })
  } catch {
    return fallback()
  }
}
