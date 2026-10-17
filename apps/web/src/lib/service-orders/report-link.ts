/** Endereço público (sem login) do relatório fotográfico de uma ordem. */
export function reportDownloadUrl(origin: string, token: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  const isInternal = /localhost|127\.0\.0\.1|\.vercel\.app$/i.test(new URL(origin).hostname)
  const base = (configured && configured.trim()) || (isInternal ? 'https://www.alizoai.com' : origin)
  return `${base.replace(/\/+$/, '')}/relatorio/${token}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isReportToken(value: string): boolean {
  return UUID.test(value)
}
