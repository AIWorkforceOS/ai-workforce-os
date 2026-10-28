// Rotação de TEMA dos vídeos, definida pelo dono na ficha do agente (business_profile.video_rotacao): ex. ["manutenção","manutenção","manutenção","limpeza"]
// = 3 vídeos de manutenção e 1 de limpeza a cada 4. O tema é derivado de quantos vídeos a unidade já criou no mês (nada fica gravado que possa defasar).

import type { SupabaseClient } from '@supabase/supabase-js'

const MAX_THEMES = 12
const THEME_MAX = 80

/** Lê a rotação da ficha; qualquer coisa fora do formato (lista de textos curtos) é ignorada. */
export function videoRotationFrom(profile: Record<string, unknown> | null | undefined): string[] {
  const raw = profile?.video_rotacao
  if (!Array.isArray(raw)) return []
  return raw
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.replace(/\s+/g, ' ').trim().slice(0, THEME_MAX))
    .filter(Boolean)
    .slice(0, MAX_THEMES)
}

/** Tema do próximo vídeo: o N-ésimo do mês (0-based) cai na posição N da rotação, repetindo o ciclo. Sem rotação = null (vídeo livre, como antes). */
export function videoThemeFor(rotation: string[], videosThisMonth: number): string | null {
  if (rotation.length === 0) return null
  return rotation[Math.max(0, videosThisMonth) % rotation.length] ?? null
}

/** Primeiro dia do mês corrente no fuso da unidade, como instante UTC (aproximado ao dia: basta para contar vídeos do mês). */
export function monthStartIso(now: Date, timeZone: string): string {
  const key = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  return `${key.slice(0, 7)}-01T00:00:00.000Z`
}

/** Vídeos que contam para a rotação no mês: os que não falharam nem foram rejeitados. Erro de leitura = 0 (o vídeo sai livre, não quebra). */
export async function countVideosThisMonth(supabase: SupabaseClient, unitId: string, timeZone: string, now: Date = new Date()): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('content_posts')
      .select('id', { count: 'exact', head: true })
      .eq('unit_id', unitId)
      .eq('format', 'video')
      .not('status', 'in', '(failed,rejected)')
      .gte('created_at', monthStartIso(now, timeZone))
    if (error) {
      console.error('[content/video] não consegui contar os vídeos do mês:', error.message)
      return 0
    }
    return count ?? 0
  } catch (error) {
    console.error('[content/video] erro ao contar os vídeos do mês:', error)
    return 0
  }
}
