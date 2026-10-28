import { describe, expect, it } from 'vitest'
import {
  TRANSITIONS,
  buildFilterGraph,
  buildFrameSpecs,
  fitDurations,
  normalizeVideo,
  normalizeVideoEdit,
  planTimeline,
  videoDuration,
  videoPublishingEnabled,
  type VideoContent,
} from '../video'
import { MAX_VIDEOS_PER_RUN, pickPostFormat } from '../carousel'

const raw = (over: Record<string, unknown> = {}) => ({
  script: 'Gancho, dicas e chamada.',
  scenes: [
    { headline: 'Seu espaço está pronto?', text: 'Limpeza começa antes de abrir.', seconds: 4 },
    { headline: 'Planeje a rotina', text: 'Horários que não atrapalham.', seconds: 5 },
    { headline: 'Um só contato', text: 'Ordens e relatórios num lugar.', seconds: 5 },
    { headline: 'Resposta rápida', text: 'Chamados viram ordens.', seconds: 5 },
  ],
  cta_title: 'Peça uma proposta',
  cta_body: 'Fale com a MAWI.',
  cta_seconds: 4,
  hashtags: ['limpeza', '#facilities'],
  ...over,
})
const ok = (r: ReturnType<typeof normalizeVideo>): VideoContent => {
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('normalizeVideo (roteiro da IA)', () => {
  it('aceita um roteiro completo, com transições em rodízio e duração de 15–30 s', () => {
    const v = ok(normalizeVideo(raw()))
    expect(v.scenes).toHaveLength(4)
    expect(v.scenes.map((s) => s.transition)).toEqual([TRANSITIONS[0], TRANSITIONS[1], TRANSITIONS[2], TRANSITIONS[3]])
    expect(videoDuration(v)).toBe(23)
    expect(v.hashtags).toEqual(['#limpeza', '#facilities'])
  })
  it('corrige sozinho duração fora de 15–30 s (a IA erra conta)', () => {
    const curto = ok(normalizeVideo(raw({ scenes: raw().scenes.map((s) => ({ ...s, seconds: 2 })), cta_seconds: 3 })))
    expect(videoDuration(curto)).toBeGreaterThanOrEqual(15)
    const longo = ok(normalizeVideo(raw({ scenes: raw().scenes.map((s) => ({ ...s, seconds: 6 })), cta_seconds: 5 })))
    expect(videoDuration(longo)).toBeLessThanOrEqual(30)
  })
  it('recusa sem cenas suficientes, sem CTA ou vazio', () => {
    expect(normalizeVideo(raw({ scenes: raw().scenes.slice(0, 2) })).ok).toBe(false)
    expect(normalizeVideo(raw({ cta_title: '' })).ok).toBe(false)
    expect(normalizeVideo(null).ok).toBe(false)
  })
  it('guarda a descrição visual de cada cena e do fechamento', () => {
    const v = ok(normalizeVideo(raw({ scenes: raw().scenes.map((s) => ({ ...s, visual: 'Two technicians inspecting a panel' })), cta_visual: 'A team in front of a building' })))
    expect(v.scenes[0]!.visual).toBe('Two technicians inspecting a panel')
    expect(v.cta.visual).toBe('A team in front of a building')
  })
  it('limita cenas e tamanho dos textos', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ headline: `H${i}`.repeat(40), text: 'x'.repeat(400), seconds: 4 }))
    const v = ok(normalizeVideo(raw({ scenes: many })))
    expect(v.scenes).toHaveLength(6)
    expect(v.scenes[0]!.headline.length).toBe(60)
    expect(v.scenes[0]!.text.length).toBe(140)
  })
})

describe('fitDurations', () => {
  it('reescala para a meta respeitando mínimos e máximos', () => {
    const v = ok(normalizeVideo(raw()))
    const fitted = fitDurations({ ...v, scenes: v.scenes.map((s) => ({ ...s, seconds: 6 })), cta: { ...v.cta, seconds: 5 } }, 20)
    expect(Math.abs(videoDuration(fitted) - 20)).toBeLessThan(3)
    expect(fitted.scenes.every((s) => s.seconds >= 2 && s.seconds <= 6)).toBe(true)
  })
})

describe('normalizeVideoEdit (o que o navegador manda)', () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    script: 'r',
    scenes: [
      { headline: 'a', text: '', seconds: 5, transition: 'fade' },
      { headline: 'b', text: '', seconds: 5, transition: 'slideleft' },
      { headline: 'c', text: '', seconds: 5, transition: 'nao-existe', background_url: 'javascript:x' },
    ],
    cta: { headline: 'Fale conosco', text: '', seconds: 4 },
    hashtags: [],
    ...over,
  })
  it('aceita, troca transição inválida por uma válida e só mantém fundo https', () => {
    const r = normalizeVideoEdit(edit())
    expect(r.ok && r.value.scenes[2]!.transition).toBe(TRANSITIONS[2])
    expect(r.ok && r.value.scenes[2]!.background_url).toBeNull()
  })
  it('duração fora de 15–30 s é ERRO (o dono decide), não correção silenciosa', () => {
    const r = normalizeVideoEdit(edit({ cta: { headline: 'x', seconds: 3 }, scenes: edit().scenes.map((s) => ({ ...s, seconds: 2 })) }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/entre 15 e 30/)
  })
  it('exige CTA e 3 a 6 cenas', () => {
    expect(normalizeVideoEdit(edit({ cta: { headline: '' } })).ok).toBe(false)
    expect(normalizeVideoEdit(edit({ scenes: edit().scenes.slice(0, 2) })).ok).toBe(false)
    expect(normalizeVideoEdit(edit({ scenes: Array.from({ length: 7 }, () => ({ headline: 't', seconds: 3 })) })).ok).toBe(false)
  })
})

describe('linha do tempo e filtro do ffmpeg', () => {
  const v = ok(normalizeVideo(raw()))
  const specs = buildFrameSpecs(v)
  it('quadros: cenas + fechamento, numerados', () => {
    expect(specs.map((s) => s.kind)).toEqual(['scene', 'scene', 'scene', 'scene', 'cta'])
    expect(specs.map((s) => `${s.index}/${s.total}`)).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5'])
  })
  it('as transições começam quando a cena termina e a duração total é a soma dos segundos', () => {
    const plan = planTimeline(specs)
    expect(plan.map((p) => p.offsetOut)).toEqual([4, 9, 14, 19, null])
    expect(plan.map((p) => p.inputSeconds)).toEqual([4.5, 5.5, 5.5, 5.5, 4])
    // clipes somados menos as sobreposições = soma dos segundos
    const clips = plan.reduce((a, p) => a + p.inputSeconds, 0)
    expect(clips - 0.5 * (plan.length - 1)).toBe(videoDuration(v))
  })
  it('o filtro encadeia xfade com a transição da cena que entra e termina em [vout]', () => {
    const { filter, outLabel } = buildFilterGraph(specs, { width: 1080, height: 1920 })
    expect(outLabel).toBe('vout')
    expect(filter.match(/zoompan/g)).toHaveLength(5)
    expect(filter.match(/overlay=/g)).toHaveLength(5) // um texto por cena, por cima do fundo
    expect(filter).toContain('[5:v]format=yuva420p,fade=t=in:st=0.1:d=0.6:alpha=1[o0]') // textos são as entradas n..2n-1
    expect(filter).toContain("zoompan=z='min(") // cena 1 aproxima
    expect(filter).toContain("zoompan=z='max(") // cena 2 afasta
    expect(filter).toContain('[v0][v1]xfade=transition=slideleft:duration=0.5:offset=4[x1]')
    expect(filter).toContain('[x3][v4]xfade=transition=')
    expect(filter.endsWith('[vout]')).toBe(true)
    expect(filter).toContain('s=1080x1920')
  })
})

describe('pickPostFormat com vídeo', () => {
  const inst = (formats: string[], avoid: string[] = []) => ({ interpretation: { formats, avoid_formats: avoid } }) as never
  it('só vídeo: sempre vídeo; vídeo proibido ou sem permissão: cai fora da roda', () => {
    expect(pickPostFormat(inst(['vídeo curto']), [])).toBe('video')
    expect(pickPostFormat(inst(['vídeo curto'], ['vídeo']), [])).toBe('image')
    expect(pickPostFormat(inst(['reels']), [], { allowVideo: false })).toBe('image')
  })
  it('carrossel + vídeo revezam; os três formatos giram em ordem', () => {
    expect(pickPostFormat(inst(['carrossel', 'vídeo']), [])).toBe('carousel')
    expect(pickPostFormat(inst(['carrossel', 'vídeo']), ['carousel'])).toBe('video')
    expect(pickPostFormat(inst(['carrossel', 'imagem única', 'vídeo']), ['carousel', 'image'])).toBe('video')
    expect(pickPostFormat(inst(['carrossel', 'imagem única', 'vídeo']), ['video'])).toBe('carousel')
  })
  it('sem vídeo liberado numa rodada, carrossel + vídeo vira só carrossel', () => {
    expect(pickPostFormat(inst(['carrossel', 'vídeo']), ['carousel'], { allowVideo: false })).toBe('carousel')
    expect(MAX_VIDEOS_PER_RUN).toBe(1)
  })
})

describe('trava de publicação de vídeo', () => {
  it('desligada por padrão; só "on" liga', () => {
    expect(videoPublishingEnabled({})).toBe(false)
    expect(videoPublishingEnabled({ CONTENT_VIDEO_PUBLISH: '1' })).toBe(false)
    expect(videoPublishingEnabled({ CONTENT_VIDEO_PUBLISH: 'on' })).toBe(true)
  })
})
