'use client'

import { Download } from 'lucide-react'
import { downloadFile } from '@/lib/download-file'

export function DownloadOriginalButton({ url, filename }: { url: string; filename: string }) {
  return (
    <button
      type="button"
      onClick={() => downloadFile(url, filename)}
      className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200 transition-colors hover:text-white"
      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
    >
      <Download size={13} />
      Download original file
    </button>
  )
}
