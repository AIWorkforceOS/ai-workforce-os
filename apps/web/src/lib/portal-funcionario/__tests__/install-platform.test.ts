import { describe, expect, it } from 'vitest'
import { detectInstallPlatform } from '../install-platform'

describe('detectInstallPlatform', () => {
  it('Safari do iPhone', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1')).toBe('ios-safari')
  })
  it('navegador de dentro do WhatsApp/Instagram não instala (precisa abrir no Safari)', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0')).toBe('ios-inapp')
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 [FBAN/FBIOS;FBAV/400.0]')).toBe('ios-inapp')
  })
  it('Chrome no iPhone', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1')).toBe('ios-other')
  })
  it('Android e computador', () => {
    expect(detectInstallPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36')).toBe('android')
    expect(detectInstallPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36')).toBe('desktop')
  })
})
