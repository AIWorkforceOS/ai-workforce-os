/** Marca da empresa (logo): bucket público de leitura; escrita só pelo servidor, depois de validar e normalizar a imagem. */
export const BRANDING_BUCKET = 'org-branding'
export const MAX_LOGO_BYTES = 2 * 1024 * 1024
/** SVG NÃO é aceito: servido de um bucket público, um SVG pode carregar script. Só imagens rasterizadas, que o servidor reprocessa. */
export const ALLOWED_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const LOGO_MAX_WIDTH = 800
export const LOGO_MAX_HEIGHT = 400
export const LOGO_MIN_SIDE = 32
