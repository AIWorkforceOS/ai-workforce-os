'use client'

/**
 * Força o download de um arquivo (foto, PDF) mesmo quando a URL é de
 * outra origem (bucket público do Supabase Storage) — um <a download>
 * comum é ignorado pelo navegador em links cross-origin e só abre o
 * arquivo numa aba nova. Busca o conteúdo, gera um blob local e clica
 * num link temporário nele; se o fetch falhar (CORS, rede), cai de
 * volta pra abrir numa aba nova, que ainda deixa o admin salvar
 * manualmente.
 */
export async function downloadFile(url: string, filename: string): Promise<void> {
  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error('download falhou')
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(objectUrl)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
