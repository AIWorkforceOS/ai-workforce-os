// Logo escura sobre transparente (a da Mawi: texto azul-marinho + símbolo verde) some em fundo escuro. Em vez de colocar uma placa branca atrás (a "faixa
// branca" que o dono não quer), clareamos só os pixels ESCUROS do desenho e mantemos as cores vivas (o verde continua verde) e a transparência.

import sharp from 'sharp'

const DARK_FULL = 0.15 // luminância até aqui: vira branco por inteiro (azul-marinho ~0,10)
const DARK_NONE = 0.35 // acima daqui: cor original — cores de marca vivas, como o verde (~0,45), não mudam; a transição entre os dois é suave, sem serrilhado

export async function lightenDarkPixels(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const out = Buffer.from(data)
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3]! === 0) continue
    const lum = (0.2126 * out[i]! + 0.7152 * out[i + 1]! + 0.0722 * out[i + 2]!) / 255
    const f = Math.min(1, Math.max(0, (DARK_NONE - lum) / (DARK_NONE - DARK_FULL)))
    if (f === 0) continue
    out[i] = Math.round(out[i]! + (255 - out[i]!) * f)
    out[i + 1] = Math.round(out[i + 1]! + (255 - out[i + 1]!) * f)
    out[i + 2] = Math.round(out[i + 2]! + (255 - out[i + 2]!) * f)
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer()
}
