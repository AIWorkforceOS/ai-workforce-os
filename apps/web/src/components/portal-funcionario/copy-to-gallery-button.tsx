'use client'

import { useState } from 'react'
import { Download } from 'lucide-react'
import { saveCopiesToDevice } from '@/lib/portal-funcionario/save-to-device'

/** Cópia de segurança na galeria do celular (folha de compartilhar do sistema; funciona sem internet). */
export function CopyToGalleryButton({ files }: { files: File[] }) {
  const [message, setMessage] = useState<string | null>(null)
  if (files.length === 0) return null

  async function copy() {
    const result = await saveCopiesToDevice(files)
    setMessage(
      result === 'shared'
        ? 'Escolha "Salvar imagem" para guardar na galeria.'
        : result === 'downloaded'
          ? 'Cópias baixadas no celular (pasta Downloads).'
          : result === 'unsupported'
            ? 'Este aparelho não permite salvar cópia daqui.'
            : null,
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={copy}
        className="flex w-fit items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold text-slate-200"
        style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)' }}
      >
        <Download size={13} /> Salvar cópia na galeria ({files.length})
      </button>
      {message && <p className="text-xs text-amber-300">{message}</p>}
    </div>
  )
}
