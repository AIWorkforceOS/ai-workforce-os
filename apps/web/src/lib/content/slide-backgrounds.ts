// Imagens de fundo dos slides do carrossel, quando a instrução do dono pede ("sempre com imagens de fundo"). Ordem de preferência: fotos REAIS da biblioteca
// da empresa (materiais de imagem que não sejam a logo) → imagens de fundo geradas por IA, desfocadas e sem texto/pessoas/logo (qualidade baixa, custo registrado).
// Nada aqui afirma nada sobre a empresa: são só pano de fundo, sempre com véu escuro por cima (ver carousel-render.tsx).

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchActiveAttachments } from '@/lib/attachments'
import { generateImage, generateStructuredReply } from '@/lib/openai'
import type { Unit } from '@/lib/types'
import type { CarouselContent } from './carousel'
import type { ContentInstruction } from './instructions'
import { uploadGeneratedImage } from './generator'

const BACKGROUND_RE = /(imagens?|fotos?|images?|photos?|pictures?)\s+(de|do|as|for|as a)?\s*(fundo|background)|background\s+(images?|photos?|pictures?)/i
const NEGATION_NEAR = /(\bsem\b|\bn[ãa]o\b|\bnunca\b|\bwithout\b|\bno\b|\bnot\b)\s+(\S+\s+){0,2}$/i

/** O dono pediu imagens de fundo? Campo estruturado primeiro; instruções antigas (sem o campo) são lidas pelo texto, com cuidado para "sem imagens de fundo". */
export function wantsSlideBackgrounds(instruction: Pick<ContentInstruction, 'interpretation' | 'original_text'> | null): boolean {
  if (!instruction) return false
  if (instruction.interpretation.slide_backgrounds === true) return true
  const text = `${instruction.original_text}\n${instruction.interpretation.restrictions.join('\n')}`
  const match = BACKGROUND_RE.exec(text)
  if (!match) return false
  return !NEGATION_NEAR.test(text.slice(Math.max(0, match.index - 24), match.index))
}

/** Aplica as URLs aos slides sem repetir em sequência: capa e fechamento usam a primeira; o conteúdo reveza as demais. Não sobrescreve fundo que o dono já escolheu. */
export function applyBackgrounds(content: CarouselContent, urls: string[]): CarouselContent {
  if (urls.length === 0) return content
  const rest = urls.length > 1 ? urls.slice(1) : urls
  return {
    ...content,
    cover: { ...content.cover, background_url: content.cover.background_url ?? urls[0]! },
    slides: content.slides.map((s, i) => ({ ...s, background_url: s.background_url ?? rest[i % rest.length]! })),
    cta: { ...content.cta, background_url: content.cta.background_url ?? urls[0]! },
  }
}

const NOT_PHOTO_RE = /logo|identidade|brand|marca/i

/** Fotos reais da biblioteca (material de imagem ativo para o Gestor de Conteúdo, exceto logo/identidade visual). */
export async function libraryPhotoUrls(supabase: SupabaseClient, unit: Pick<Unit, 'id' | 'org_id'>, max = 4): Promise<string[]> {
  const items = await fetchActiveAttachments(supabase, unit, 'content_specialist')
  return items
    .filter((a) => a.kind === 'image' && a.file_url && !NOT_PHOTO_RE.test(`${a.title ?? ''} ${a.usage_instructions ?? ''}`))
    .slice(0, max)
    .map((a) => a.file_url as string)
}

const DEFAULT_SCENES = [
  'a bright, modern commercial office lobby with a polished floor',
  'a tidy facility maintenance room with tools neatly arranged on a workbench',
  'a spotless commercial hallway with large windows and natural light',
]

/** 3 cenas de fundo sob medida para o negócio (uma chamada barata de texto). Falhou? usa cenas genéricas de facilities. */
async function planScenes(apiKey: string, companyContext: string | null, objective: string): Promise<string[]> {
  try {
    const out = await generateStructuredReply<{ scenes?: unknown }>({
      apiKey,
      systemPrompt: [
        'Você escolhe 3 cenas de FUNDO (pano de fundo desfocado) para slides de redes sociais de uma empresa.',
        companyContext ? `Empresa (dado): ${companyContext.slice(0, 1200)}` : '',
        `Objetivo da campanha: ${objective}.`,
        'Cada cena: UMA frase curta em inglês, descrevendo um ambiente ou objeto genérico e plausível do ramo (sem pessoas, sem rostos, sem texto, sem marcas, sem afirmar nada sobre trabalhos reais da empresa).',
        'Responda SOMENTE JSON: {"scenes": ["...", "...", "..."]}',
      ].filter(Boolean).join(' '),
      history: [{ role: 'user', content: 'Escolha as 3 cenas.' }],
      maxTokens: 250,
      temperature: 0.6,
    })
    const scenes = (Array.isArray(out.scenes) ? out.scenes : []).filter((x): x is string => typeof x === 'string' && x.trim().length > 5).map((x) => x.trim().slice(0, 160))
    return scenes.length >= 3 ? scenes.slice(0, 3) : DEFAULT_SCENES
  } catch {
    return DEFAULT_SCENES
  }
}

export function backdropPrompt(scene: string): string {
  return `Soft-focus photographic background image for a social media slide. Scene: ${scene}. Calm, professional, muted tones, deep navy and clean white color feel, shallow depth of field, lots of empty negative space. No text, no letters, no numbers, no logos, no watermarks, no people, no faces.`
}

/** Gera 3 imagens de fundo (qualidade baixa: ficam sob véu escuro) e sobe no Storage. Erro de qualquer uma = falha clara, nenhum carrossel sem fundo é entregue. */
export async function generateBackdropUrls(params: { supabase: SupabaseClient; apiKey: string; unitId: string; companyContext: string | null; objective: string }): Promise<string[]> {
  const scenes = await planScenes(params.apiKey, params.companyContext, params.objective)
  const images = await Promise.all(scenes.map((scene) => generateImage({ apiKey: params.apiKey, prompt: backdropPrompt(scene), size: '1024x1536', quality: 'low' })))
  return Promise.all(images.map((img) => uploadGeneratedImage({ supabase: params.supabase, unitId: params.unitId, base64Image: img.base64Image })))
}
