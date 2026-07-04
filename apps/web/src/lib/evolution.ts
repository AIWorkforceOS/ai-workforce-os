import type { Unit } from '@/lib/types'

export type EvolutionUnitConfig = {
  apiUrl: string
  apiKey: string
  instanceName: string
}

export function getEvolutionConfig(unit: Unit): EvolutionUnitConfig | null {
  if (!unit.evolution_api_url || !unit.evolution_api_key || !unit.evolution_instance_name) {
    return null
  }

  return {
    apiUrl: unit.evolution_api_url.replace(/\/+$/, ''),
    apiKey: unit.evolution_api_key,
    instanceName: unit.evolution_instance_name,
  }
}

async function evolutionFetch(
  config: EvolutionUnitConfig,
  path: string,
  init?: RequestInit,
) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: config.apiKey,
      ...init?.headers,
    },
    cache: 'no-store',
  })

  const text = await response.text()
  const data = text ? JSON.parse(text) : null

  if (!response.ok) {
    const message =
      (data && (data.message || data.error)) || `Evolution API retornou status ${response.status}`
    throw new Error(Array.isArray(message) ? message.join(', ') : message)
  }

  return data
}

export type WhatsAppStatus = 'open' | 'connecting' | 'close' | 'not_configured'

export async function getInstanceStatus(config: EvolutionUnitConfig): Promise<WhatsAppStatus> {
  const data = await evolutionFetch(config, `/instance/connectionState/${config.instanceName}`)
  const state = data?.instance?.state ?? data?.state
  if (state === 'open') return 'open'
  if (state === 'connecting') return 'connecting'
  return 'close'
}

export async function connectInstance(config: EvolutionUnitConfig) {
  try {
    return await evolutionFetch(config, `/instance/connect/${config.instanceName}`)
  } catch {
    await evolutionFetch(config, '/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName: config.instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS',
      }),
    })
    return evolutionFetch(config, `/instance/connect/${config.instanceName}`)
  }
}

export async function disconnectInstance(config: EvolutionUnitConfig) {
  return evolutionFetch(config, `/instance/logout/${config.instanceName}`, {
    method: 'DELETE',
  })
}

export async function sendWhatsAppMessage(config: EvolutionUnitConfig, phone: string, text: string) {
  return evolutionFetch(config, `/message/sendText/${config.instanceName}`, {
    method: 'POST',
    body: JSON.stringify({
      number: phone,
      text,
    }),
  })
}
