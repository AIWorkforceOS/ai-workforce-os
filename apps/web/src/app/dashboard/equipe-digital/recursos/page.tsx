import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAppUser } from '@/lib/app-user'
import { Card } from '@/components/ui/dashboard-ui'
import { AttachmentLibraryManager } from '@/components/dashboard/attachment-library-manager'
import type { EmployeeAttachment, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Biblioteca de materiais da organização (migration 036, generalizada na
// 062): o cliente sobe PDFs/imagens prontos e/ou cadastra links, escreve
// a instrução de quando usar cada um e escolhe quais funcionários têm
// acesso — cada funcionário decide sozinho na conversa (ver
// lib/attachments.ts) se e quando manda aquele material, e o envio sai
// como mídia real no WhatsApp ou anexo no e-mail (ver
// lib/channels/messaging-channel.ts). Central única pra organização
// inteira: um material pode valer para uma unidade só ou pra todas, e
// para um ou vários funcionários ao mesmo tempo.
export default async function EmployeeResourcesPage({
  searchParams,
}: {
  searchParams: { unit?: string; employee?: string }
}) {
  const supabase = await createClient()
  const appUser = await getAppUser()
  const orgId = appUser?.orgId
  if (!orgId) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="p-5 text-sm text-slate-400">Nenhuma organização encontrada para este usuário.</Card>
      </div>
    )
  }

  const [{ data: units }, { data: attachments }] = await Promise.all([
    supabase.from('units').select('id, name').order('created_at', { ascending: true }),
    supabase.from('employee_attachments').select('*').order('created_at', { ascending: false }),
  ])

  const unitRows = (units ?? []) as Pick<Unit, 'id' | 'name'>[]

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/equipe-digital"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={12} /> Voltar pra equipe digital
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">Materiais dos funcionários</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Suba PDFs, imagens ou cadastre links (contrato modelo, tabela de preços, catálogo, apresentação) que os
          funcionários de IA podem enviar durante a conversa. A instrução de &quot;quando usar&quot; que você
          escrever é o que ensina o momento certo — nenhum funcionário envia nada fora do que você descrever ali.
        </p>
      </div>

      <Card className="p-5">
        <AttachmentLibraryManager
          orgId={orgId}
          units={unitRows}
          initialAttachments={(attachments ?? []) as EmployeeAttachment[]}
          defaultUnitId={searchParams.unit ?? ''}
          defaultEmployee={searchParams.employee ?? null}
        />
      </Card>
    </div>
  )
}
