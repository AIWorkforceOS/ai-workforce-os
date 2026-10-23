import { notFound } from 'next/navigation'
import { HeaderBrand, SidebarBrand } from '@/components/brand/brand-logo'

/** Pré-visualização SOMENTE DE DESENVOLVIMENTO da marca no cabeçalho e no menu (logo da Mawi de exemplo, nenhum banco). Em produção responde 404. */
const MAWI = 'https://rvzvxotmpdffvmycgdfk.supabase.co/storage/v1/object/public/org-branding/465fc182-e2a5-47d0-9694-0c6b1f9b619e/logo-fadb81d7e915.png'

export default function BrandPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  return (
    <div className="flex min-h-screen flex-col gap-8 p-8" style={{ background: '#0a0f1e' }}>
      <div className="flex items-center gap-4 rounded-xl p-4" style={{ background: 'rgba(10,15,30,0.9)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-xs text-slate-500">Cabeçalho:</span>
        <HeaderBrand logoUrl={MAWI} />
      </div>
      <div className="w-64 rounded-xl p-4" style={{ background: '#0b0f1a', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="mb-3 text-xs text-slate-500">Menu lateral:</p>
        <SidebarBrand logoUrl={MAWI} />
      </div>
      <div className="flex items-center gap-4 rounded-xl p-4" style={{ background: 'rgba(10,15,30,0.9)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="text-xs text-slate-500">Sem logo própria (Alizo):</span>
        <HeaderBrand logoUrl={null} />
      </div>
    </div>
  )
}
