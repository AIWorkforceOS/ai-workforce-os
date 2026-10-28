// Teste real de publicação (carrossel e vídeo) numa página de TESTE da Meta — nunca num perfil real. Este módulo é a trava: só passa se o nome da
// página disser que é de teste e quem pede digitar esse nome exato. Conteúdo é fixo e marcado como teste (sem IA, sem custo, sem texto de cliente).

import type { CarouselContent } from './carousel'
import type { VideoContent } from './video'

export type TestRequestCheck = { ok: true } | { ok: false; error: string }

/** Nome de página de teste: a palavra "teste", "test" ou "sandbox" inteira (não "Contestação", nem "Latest"). */
export function isTestPageName(name: string | null | undefined): boolean {
  return /(^|[^\p{L}])(teste|test|sandbox)([^\p{L}]|$)/iu.test(name ?? '')
}

export function checkTestPublishRequest(params: { pageName: string | null | undefined; confirm: unknown; isSuperAdmin: boolean }): TestRequestCheck {
  if (!params.isSuperAdmin) return { ok: false, error: 'Somente o super admin roda o teste de publicação.' }
  if (!isTestPageName(params.pageName)) {
    return { ok: false, error: 'Esta conta NÃO parece uma página de teste (o nome precisa conter "teste", "test" ou "sandbox"). Nada foi publicado.' }
  }
  if (typeof params.confirm !== 'string' || params.confirm.trim() !== (params.pageName ?? '').trim()) {
    return { ok: false, error: 'Confirmação inválida: digite exatamente o nome da página de teste.' }
  }
  return { ok: true }
}

const TEST_TAG = 'TESTE — conteúdo de validação técnica, não é um post real'

export const TEST_CAROUSEL: CarouselContent = {
  cover: { title: 'TESTE de carrossel', subtitle: TEST_TAG },
  slides: [
    { title: 'Slide de teste 1', body: 'Verificando o desenho dos slides e a ordem das imagens.' },
    { title: 'Slide de teste 2', body: 'Verificando o contêiner filho do Instagram.' },
    { title: 'Slide de teste 3', body: 'Verificando o post com várias fotos no Facebook.' },
  ],
  cta: { title: 'Fim do teste', body: 'Pode apagar este post.' },
  hashtags: [],
}

export const TEST_VIDEO: VideoContent = {
  script: TEST_TAG,
  scenes: [
    { headline: 'TESTE de vídeo', text: TEST_TAG, seconds: 5, transition: 'fade' },
    { headline: 'Cena de teste 2', text: 'Verificando renderização e transições.', seconds: 5, transition: 'slideleft' },
    { headline: 'Cena de teste 3', text: 'Verificando o envio como Reels.', seconds: 5, transition: 'wipeleft' },
  ],
  cta: { headline: 'Fim do teste', text: 'Pode apagar este post.', seconds: 3 },
  hashtags: [],
}

export const TEST_CAPTION = `${TEST_TAG}. Pode apagar.`
