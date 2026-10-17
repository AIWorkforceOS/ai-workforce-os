export type SaveCopyResult = 'shared' | 'downloaded' | 'cancelled' | 'unsupported'

/**
 * Cópia de segurança no celular. Navegador NÃO pode escrever na galeria
 * sozinho (nem Chrome/Android, nem Safari/iPhone): o único caminho legítimo
 * é a folha de compartilhar do sistema ("Salvar imagens"/"Salvar vídeo"),
 * que exige um toque do usuário e funciona sem internet. Fallback: download
 * (Android grava na pasta Downloads).
 */
export async function saveCopiesToDevice(files: File[]): Promise<SaveCopyResult> {
  if (files.length === 0) return 'unsupported'
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav && typeof nav.share === 'function' && typeof nav.canShare === 'function' && nav.canShare({ files })) {
    try {
      await nav.share({ files })
      return 'shared'
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError') return 'cancelled'
      // outro erro: cai pro download
    }
  }
  if (typeof document === 'undefined') return 'unsupported'
  for (const file of files) {
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = file.name
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  }
  return 'downloaded'
}
