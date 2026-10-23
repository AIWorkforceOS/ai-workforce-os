import { logoEdgeStyle } from '@/lib/branding/render'

/**
 * Logo no cabeçalho/menu. Sem logo própria: a marca do Alizo, exatamente como era. Com logo da empresa: ela substitui a do Alizo (ícone + nome) e aparece
 * SÓ a imagem — sem caixa nem faixa em volta. Logo transparente mostra só o desenho; logo com fundo próprio mostra o próprio fundo. Se o desenho for
 * escuro sobre transparente, um brilho claro fino (logoEdgeStyle) garante que apareça no painel escuro.
 */
export function HeaderBrand({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="Logo da empresa" className="h-7 max-w-[160px] w-auto rounded-md object-contain" style={logoEdgeStyle(logoUrl)} />
    )
  }
  return (
    <>
      <img src="/branding/alizo-icon.png" alt="Alizo" className="h-6 w-auto" />
      <p className="text-[14px] font-black tracking-tight text-white">alizo</p>
    </>
  )
}

export function SidebarBrand({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <img src={logoUrl} alt="Logo da empresa" className="h-11 max-w-[190px] w-auto rounded-lg object-contain" style={logoEdgeStyle(logoUrl)} />
    )
  }
  return <img src="/branding/alizo-logo.png" alt="Alizo" className="h-8 w-auto" />
}
