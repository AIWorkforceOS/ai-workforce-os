/**
 * Logo no cabeçalho/menu. Sem logo própria: a marca do Alizo, exatamente como era. Com logo da empresa: ela substitui a do Alizo
 * (ícone + nome) e fica sobre um fundo claro, para aparecer bem mesmo se a logo tiver letras escuras num painel escuro.
 */
export function HeaderBrand({ logoUrl }: { logoUrl: string | null }) {
  if (logoUrl) {
    return (
      <span className="inline-flex items-center rounded-md px-2 py-1" style={{ background: 'rgba(255,255,255,0.96)' }}>
        <img src={logoUrl} alt="Logo da empresa" className="h-6 max-w-[150px] w-auto object-contain" />
      </span>
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
      <span className="inline-flex items-center rounded-lg px-3 py-2" style={{ background: 'rgba(255,255,255,0.96)' }}>
        <img src={logoUrl} alt="Logo da empresa" className="h-9 max-w-[180px] w-auto object-contain" />
      </span>
    )
  }
  return <img src="/branding/alizo-logo.png" alt="Alizo" className="h-8 w-auto" />
}
