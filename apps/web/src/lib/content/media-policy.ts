import type { SupabaseClient } from '@supabase/supabase-js'

export const VIDEO_MONTHLY_LIMITS = [2, 4, 8] as const
export type VideoMonthlyLimit = (typeof VIDEO_MONTHLY_LIMITS)[number]

export function videoMonthlyLimitFrom(profile: Record<string, unknown> | null | undefined): VideoMonthlyLimit {
  const value = Number(profile?.video_monthly_limit)
  return VIDEO_MONTHLY_LIMITS.includes(value as VideoMonthlyLimit) ? (value as VideoMonthlyLimit) : 2
}
export async function assertVideoQuota(params: {
  supabase: SupabaseClient
  unitId: string
  profile: Record<string, unknown> | null | undefined
  now?: Date
}): Promise<{ used: number; limit: VideoMonthlyLimit }> {
  const now = params.now ?? new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString()
  const limit = videoMonthlyLimitFrom(params.profile)
  const { count, error } = await params.supabase
    .from('content_posts')
    .select('id', { count: 'exact', head: true })
    .eq('unit_id', params.unitId)
    .eq('format', 'video')
    .gte('created_at', start)
    .lt('created_at', end)
    .in('status', ['draft', 'pending_approval', 'approved', 'scheduled', 'published'])
  if (error) throw new Error(`Não foi possível conferir a cota mensal de vídeos: ${error.message}`)
  const used = count ?? 0
  if (used >= limit) throw new Error(`Cota mensal de vídeos atingida (${used}/${limit}). O Admin Alizo precisa ampliar a autorização deste cliente.`)
  return { used, limit }
}
