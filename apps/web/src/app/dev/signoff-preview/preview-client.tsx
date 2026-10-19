'use client'

import { useEffect, useState } from 'react'
import { SignOffPdfActions } from '@/components/portal-funcionario/signoff-pdf-actions'

/** PDF mínimo válido (>1 KB) servido no lugar do endpoint real; `?mode=slow|error|html` simula PDF demorado, erro 500 e arquivo que não é PDF. */
function fakePdf(): Uint8Array {
  const text = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n' + '%'.repeat(1500)
  return new TextEncoder().encode(text)
}

export function PreviewClient() {
  const [ready, setReady] = useState(false)
  const [log, setLog] = useState<string[]>([])
  useEffect(() => {
    const mode = new URLSearchParams(location.search).get('mode')
    const original = window.fetch
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (!url.includes('/service-order/pdf')) return original(input, init)
      setLog((l) => [...l, `GET ${url} (${mode ?? 'ok'})`])
      if (mode === 'slow') await new Promise((r) => setTimeout(r, 7000))
      if (mode === 'error') return new Response('{}', { status: 500 })
      if (mode === 'html') return new Response('<html>erro</html>'.repeat(200), { status: 200 })
      return new Response(fakePdf() as BodyInit, { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="SignOff_PO-161088-02-2026-10-13.pdf"' } })
    }) as typeof fetch
    setReady(true)
    return () => {
      window.fetch = original
    }
  }, [])
  return (
    <div className="mx-auto flex max-w-md flex-col gap-4 p-4">
      <h1 className="text-lg font-bold text-white">Preview — Baixar Sign Off</h1>
      {ready && <SignOffPdfActions unitId="u1" appointmentId="a1" orderNumber="6224247" startsAt="2026-10-13T13:00:00.000Z" version="v1" />}
      <pre className="whitespace-pre-wrap break-all text-xs text-slate-400" data-testid="log">{log.join('\n')}</pre>
    </div>
  )
}
