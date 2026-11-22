import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'

type HealthResult = { key: string; label: string; ok: boolean; detail: string }

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 6000): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' })
  } finally {
    clearTimeout(timer)
  }
}

async function check(
  key: string,
  label: string,
  configured: boolean,
  ping: () => Promise<Response>,
): Promise<HealthResult> {
  if (!configured) {
    return { key, label, ok: false, detail: 'Env var não configurada.' }
  }
  try {
    const response = await ping()
    if (response.ok) return { key, label, ok: true, detail: 'Respondendo normalmente.' }
    return { key, label, ok: false, detail: `API retornou status ${response.status}.` }
  } catch (err) {
    return {
      key,
      label,
      ok: false,
      detail: err instanceof Error && err.name === 'AbortError' ? 'Timeout (6s).' : 'Erro de conexão.',
    }
  }
}

async function checkGoogleMaps(apiKey: string | undefined): Promise<HealthResult> {
  if (!apiKey) return { key: 'google_maps', label: 'Google Maps', ok: false, detail: 'Env var não configurada.' }
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/place/autocomplete/json')
    url.searchParams.set('input', 'Alizo')
    url.searchParams.set('types', 'establishment')
    url.searchParams.set('key', apiKey)
    const response = await fetchWithTimeout(url.toString(), {})
    const body = await response.json().catch(() => null) as { status?: string; error_message?: string } | null
    const ok = response.ok && (body?.status === 'OK' || body?.status === 'ZERO_RESULTS')
    return {
      key: 'google_maps',
      label: 'Google Maps',
      ok,
      detail: ok ? 'Chave, API e faturamento respondendo normalmente.' : (body?.error_message || `Google retornou ${body?.status || response.status}.`),
    }
  } catch (err) {
    return { key: 'google_maps', label: 'Google Maps', ok: false, detail: err instanceof Error && err.name === 'AbortError' ? 'Timeout (6s).' : 'Erro de conexão.' }
  }
}

/**
 * Teste ao vivo das integrações externas. Restrito a super_admin —
 * dispara chamadas reais (baratas) às APIs para confirmar que as
 * chaves funcionam, não só que existem.
 */
export async function POST() {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode testar conexões.' }, { status: 403 })
  }

  const openaiKey = process.env.OPENAI_API_KEY
  const geminiKey = process.env.GEMINI_API_KEY
  const evolutionUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, '')
  const evolutionKey = process.env.EVOLUTION_API_KEY
  const resendKey = process.env.RESEND_API_KEY
  const googleMapsKey = process.env.GOOGLE_MAPS_API_KEY
  const metaWhatsappToken = process.env.META_WHATSAPP_ACCESS_TOKEN

  const results = await Promise.all([
    check('openai', 'OpenAI', Boolean(openaiKey), () =>
      fetchWithTimeout('https://api.openai.com/v1/models?limit=1', {
        headers: { Authorization: `Bearer ${openaiKey}` },
      }),
    ),
    check('gemini', 'Gemini (imagens e vídeos profissionais)', Boolean(geminiKey), () =>
      fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/models', {
        headers: { 'x-goog-api-key': geminiKey! },
      }),
    ),
    check('evolution', 'Evolution API', Boolean(evolutionUrl && evolutionKey), () =>
      fetchWithTimeout(`${evolutionUrl}/instance/fetchInstances`, {
        headers: { apikey: evolutionKey! },
      }),
    ),
    check('resend', 'Resend', Boolean(resendKey), () =>
      fetchWithTimeout('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${resendKey}` },
      }),
    ),
    checkGoogleMaps(googleMapsKey),
    check('meta_whatsapp', 'Meta WhatsApp oficial', Boolean(metaWhatsappToken), () =>
      fetchWithTimeout('https://graph.facebook.com/v25.0/me?fields=id', {
        headers: { Authorization: `Bearer ${metaWhatsappToken}` },
      }),
    ),
  ])

  return NextResponse.json({ results })
}
