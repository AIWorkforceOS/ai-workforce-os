import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getGoogleMapsApiKey, placeDetails, textSearch, type PlaceDetails } from '@/lib/google-places'
import type { Lead } from '@/lib/types'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }

  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) {
    return NextResponse.json(
      { error: 'GOOGLE_MAPS_API_KEY não está configurada. Adicione a variável de ambiente para usar a prospecção.' },
      { status: 400 },
    )
  }

  const { data: unit } = await supabase.from('units').select('id').eq('id', id).single()
  if (!unit) {
    return NextResponse.json({ error: 'Unidade não encontrada.' }, { status: 404 })
  }

  const body = await request.json().catch(() => null)
  const city: string | undefined = body?.city
  const state: string | undefined = body?.state
  const sectors: string[] = Array.isArray(body?.sectors) ? body.sectors : []

  if (!city || !state || sectors.length === 0) {
    return NextResponse.json(
      { error: 'Informe cidade, estado e pelo menos um setor.' },
      { status: 400 },
    )
  }

  const { data: job, error: jobError } = await supabase
    .from('prospecting_jobs')
    .insert({
      unit_id: id,
      city,
      state,
      keywords: sectors,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (jobError || !job) {
    return NextResponse.json({ error: 'Não foi possível criar o job de prospecção.' }, { status: 500 })
  }

  try {
    const found: { placeId: string; name: string; sector: string }[] = []

    for (const sector of sectors) {
      const results = await textSearch(`${sector} em ${city}, ${state}`, apiKey)
      for (const result of results) {
        found.push({ placeId: result.place_id, name: result.name, sector })
      }
    }

    const uniqueByPlaceId = new Map(found.map((item) => [item.placeId, item]))
    const placeIds = Array.from(uniqueByPlaceId.keys())

    const { data: existingLeads } = await supabase
      .from('leads')
      .select('google_place_id')
      .eq('unit_id', id)
      .in('google_place_id', placeIds.length > 0 ? placeIds : ['__none__'])

    const existingPlaceIds = new Set(
      ((existingLeads as Pick<Lead, 'google_place_id'>[] | null) ?? []).map((l) => l.google_place_id),
    )

    const newItems = Array.from(uniqueByPlaceId.values()).filter(
      (item) => !existingPlaceIds.has(item.placeId),
    )

    const details = await Promise.all(
      newItems.map((item): Promise<PlaceDetails> => placeDetails(item.placeId, apiKey).catch(() => ({}))),
    )

    const rows = newItems.map((item, index) => ({
      unit_id: id,
      company_name: item.name,
      phone: details[index]?.international_phone_number ?? details[index]?.formatted_phone_number ?? null,
      sector: item.sector,
      city,
      state,
      source: 'google_maps',
      status: 'new',
      google_place_id: item.placeId,
    }))

    if (rows.length > 0) {
      await supabase.from('leads').insert(rows)
    }

    await supabase
      .from('prospecting_jobs')
      .update({
        status: 'done',
        total_found: uniqueByPlaceId.size,
        total_new: rows.length,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({ jobId: job.id, totalFound: uniqueByPlaceId.size, totalNew: rows.length })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido na prospecção.'
    await supabase
      .from('prospecting_jobs')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', job.id)

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
