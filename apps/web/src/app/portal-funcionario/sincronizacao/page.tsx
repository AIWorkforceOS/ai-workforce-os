import Link from 'next/link'
import { SyncStatusPanel } from '@/components/portal-funcionario/sync-status-panel'

export const dynamic = 'force-dynamic'

export default function SyncStatusPage() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 pb-4">
      <Link href="/portal-funcionario" className="flex w-fit items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-200">
        ← Voltar para a agenda
      </Link>
      <div>
        <h1 className="text-xl font-black text-white">Sincronização</h1>
        <p className="mt-1 text-sm text-slate-400">
          Tudo que você salva fica primeiro neste aparelho e só some daqui depois que o servidor confirma. Se aparecer algo pendente, não feche nem limpe os dados do navegador.
        </p>
      </div>
      <SyncStatusPanel />
    </div>
  )
}
