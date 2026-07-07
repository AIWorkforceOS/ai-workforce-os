import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getEvolutionConfig, getInstanceStatus } from '@/lib/evolution'
import type { Unit } from '@/lib/types'

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = createServiceClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Serviço indisponível.' }, { status: 503 })
  }

  const { data: unit } = await supabase.from('units').select('*').eq('id', id).single()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const config = getEvolutionConfig(unit as Unit)
  if (!config) {
    return NextResponse.json({ status: 'not_configured' })
  }

  try {
    const status = await getInstanceStatus(config)

    // When connected, save the phone number if not already saved
    if (status === 'open' && !unit.whatsapp_phone) {
      try {
        const res = await fetch(`${config.apiUrl}/instance/fetchInstances`, {
          headers: { apikey: config.apiKey },
          cache: 'no-store',
        })
        const instances = await res.json()
        const instance = Array.isArray(instances)
          ? instances.find((i: { instance?: { instanceName?: string } }) => i.instance?.instanceName === config.instanceName)
          : null
        const phone = instance?.instance?.owner?.split('@')[0] ?? null
        if (phone) {
          await supabase.from('units').update({ whatsapp_phone: phone }).eq('id', id)
        }
      } catch {
        // Non-critical — don't fail the status check
      }
    }

    return NextResponse.json({ status })
  } catch (error) {
    return NextResponse.json(
      { status: 'error', error: error instanceof Error ? error.message : 'Erro desconhecido' },
      { status: 502 },
    )
  }
}
