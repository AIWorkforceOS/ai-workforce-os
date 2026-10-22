import Link from 'next/link'
import { Card, PageHeader } from '@/components/ui/dashboard-ui'

export const dynamic = 'force-dynamic'

export default function NoAccessPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="acesso" title="Sem acesso a esta área" subtitle="A sua função não inclui esta página. Peça ao administrador da empresa se precisar dela." />
      <Card className="p-5">
        <Link href="/dashboard" className="text-sm font-bold text-cyan-300 hover:text-cyan-200">
          Voltar ao início
        </Link>
      </Card>
    </div>
  )
}
