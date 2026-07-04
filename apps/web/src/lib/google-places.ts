const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place'

export type PlaceSearchResult = {
  place_id: string
  name: string
  formatted_address?: string
}

export type PlaceDetails = {
  formatted_phone_number?: string
  international_phone_number?: string
}

export function getGoogleMapsApiKey(): string | null {
  return process.env.GOOGLE_MAPS_API_KEY || null
}

export async function textSearch(query: string, apiKey: string): Promise<PlaceSearchResult[]> {
  const url = `${PLACES_BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${apiKey}`
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json()

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new Error(data.error_message ?? `Google Places retornou status ${data.status}`)
  }

  return (data.results ?? []) as PlaceSearchResult[]
}

export async function placeDetails(placeId: string, apiKey: string): Promise<PlaceDetails> {
  const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=formatted_phone_number,international_phone_number&key=${apiKey}`
  const response = await fetch(url, { cache: 'no-store' })
  const data = await response.json()

  if (data.status !== 'OK') {
    return {}
  }

  return (data.result ?? {}) as PlaceDetails
}
