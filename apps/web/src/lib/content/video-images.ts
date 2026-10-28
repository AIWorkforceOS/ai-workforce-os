// Fotografias das cenas do vídeo: uma imagem realista vertical por cena (e uma para o fechamento), geradas a partir da descrição visual que o roteiro traz.
// Decisão do dono (2026-10-28): imagens geradas por IA podem mostrar técnicos e prédios comerciais, sem aviso no vídeo; vídeo profissional, 1 por semana,
// custo maior aceito. Continua proibido inventar cliente, depoimento, resultado, número ou garantia (isso é texto, não imagem).

import type { SupabaseClient } from '@supabase/supabase-js'
import { generateImage } from '@/lib/openai'
import { uploadGeneratedImage } from './generator'
import type { VideoContent } from './video'

/** Custo estimado por imagem em qualidade média (ver lib/api-usage.ts); o custo real também é registrado a cada geração. */
export const SCENE_IMAGE_COST_USD = 0.053
const CONCURRENCY = 4

const STYLE =
  'Photorealistic vertical photograph, commercial documentary photography, natural light, crisp detail, shallow depth of field, cinematic color grade with deep navy and clean white tones, 9:16 composition with clear empty space in the upper and lower thirds. Diverse, professional people. No text, no letters, no numbers, no logos, no watermarks, no captions.'

/** Cenas de reserva (quando o roteiro não trouxe a descrição visual de uma cena): variadas e do ramo de facilities. */
const FALLBACK_VISUALS = [
  'Two facility maintenance technicians in clean navy-blue work uniforms and safety gloves inspecting an electrical panel in a modern commercial building',
  'A facility manager in business casual walking through a bright, spotless commercial lobby, checking a tablet',
  'A cleaning and maintenance crew in matching navy uniforms working in a large modern office floor at golden hour, polished floors reflecting the light',
  'A technician in a navy uniform and hard hat servicing a rooftop HVAC unit above a city skyline at sunrise',
  'A maintenance supervisor reviewing a checklist with a technician in a clean commercial building corridor',
  'A team of professionals in navy uniforms standing confidently in front of a modern commercial building, friendly and professional',
]

export function scenePrompt(visual: string, setting?: string): string {
  const shared = setting ? ` Same shoot, same people and same place across all scenes: ${setting.trim().replace(/[.\s]+$/, '')}.` : ''
  return `${visual.trim().replace(/[.\s]+$/, '')}.${shared} ${STYLE}`
}

const BRANDING_RE = /\b(logos?|brand(ing|ed)?|texts?|signs?|signage|letter(s|ing)?|written|caption(s|ed)?|banners?|labels?|slogans?|wordmarks?)\b/i

/**
 * Tira da descrição o que o gerador de imagem desenharia errado: logo, texto, placas, marca e o nome da empresa (a IA inventa um logo falso). A logo real
 * entra depois, pela nossa camada de texto. Remove as cláusulas problemáticas; se sobrar pouco, a cena usa uma descrição de reserva.
 */
export function sanitizeVisual(visual: string, companyNames: string[] = ['Mawi']): string {
  const names = new RegExp(`\\b(${companyNames.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b\\s*`, 'gi')
  const clauses = visual.replace(names, '').split(/[,;.]\s*/).map((c) => c.trim()).filter((c) => c && !BRANDING_RE.test(c))
  return clauses.join(', ')
}

/** A descrição visual de cada cena e do fechamento, nesta ordem (cenas…, fechamento), já limpa e com reserva para as que vieram vazias ou ficaram curtas demais. */
export function visualsFor(content: Pick<VideoContent, 'scenes' | 'cta'>, companyNames?: string[]): string[] {
  const list = [...content.scenes.map((s) => s.visual), content.cta.visual]
  return list.map((v, i) => {
    const clean = v ? sanitizeVisual(v, companyNames) : ''
    return clean.length > 15 ? clean : FALLBACK_VISUALS[i % FALLBACK_VISUALS.length]!
  })
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++
        out[i] = await fn(items[i]!, i)
      }
    }),
  )
  return out
}

/**
 * Gera e sobe as imagens (cenas + fechamento). Uma que falhe vira `null` (a cena sai com fundo de cor); se falhar mais da metade, o vídeo inteiro falha com erro
 * claro — um vídeo "profissional" com a maioria das cenas sem imagem não serve.
 */
export async function generateSceneImageUrls(params: { supabase: SupabaseClient; apiKey: string; unitId: string; visuals: string[]; setting?: string }): Promise<(string | null)[]> {
  const results = await mapLimit(params.visuals, CONCURRENCY, async (visual) => {
    try {
      const image = await generateImage({ apiKey: params.apiKey, prompt: scenePrompt(visual, params.setting), size: '1024x1536', quality: 'medium' })
      return await uploadGeneratedImage({ supabase: params.supabase, unitId: params.unitId, base64Image: image.base64Image })
    } catch (error) {
      console.error('[content/video] falha ao gerar a imagem de uma cena:', error instanceof Error ? error.message : error)
      return null
    }
  })
  const failures = results.filter((r) => r === null).length
  if (failures > results.length / 2) throw new Error(`Não foi possível gerar as imagens do vídeo (${failures} de ${results.length} falharam). Tente de novo em instantes.`)
  return results
}

/** Aplica as URLs (cenas…, fechamento) ao roteiro, sem sobrescrever fundo que o dono já escolheu. */
export function applySceneImages(content: VideoContent, urls: (string | null)[]): VideoContent {
  return {
    ...content,
    scenes: content.scenes.map((s, i) => ({ ...s, background_url: s.background_url ?? urls[i] ?? null })),
    cta: { ...content.cta, background_url: content.cta.background_url ?? urls[content.scenes.length] ?? null },
  }
}
