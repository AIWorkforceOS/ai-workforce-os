import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/dashboard-ui'
import { AttachmentLibraryManager } from '@/components/dashboard/attachment-library-manager'
import type { AgentConfig, EmployeeAttachment, Unit } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Biblioteca de anexos do funcionário (migration 036, sub-etapa única):
// o cliente sobe PDFs prontos e/ou cadastra links, escreve a instrução de
// quando usar cada um, e o funcionário decide sozinho na conversa
// (ver lib/attachments.ts e lib/conversation-engine.ts). Hoje só o AI
// Sales Representative (agent_type 'sdr') age sobre essa decisão.
export default async function EmployeeAttachmentsPage({ params }: { params: { configId: string } }) {
  const supabase = await createClient()

  const { data: config } = await supabase
    .from('agent_configs')
    .select('*')
    .eq('id', params.configId)
    .maybeSingle()

  const configRow = config as AgentConfig | null
  if (!configRow) notFound()

  const { data: unit } = await supabase
    .from('units')
    .select('*')
    .eq('id', configRow.unit_id)
    .maybeSingle()
  const unitRow = unit as Unit | null
  if (!unitRow || !unitRow.org_id) notFound()

  const { data: attachments } = await supabase
    .from('employee_attachments')
    .select('*')
    .eq('unit_id', unitRow.id)
    .eq('agent_type', configRow.agent_type)
    .order('created_at', { ascending: false })

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <Link
          href="/dashboard/equipe-digital"
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={12} /> Voltar pra equipe digital
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          Biblioteca de anexos — {configRow.persona_name}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Suba PDFs (contrato modelo, apresentação, tabela de preços) ou cadastre links que {configRow.persona_name}{' '}
          pode enviar durante a conversa. A instrução de &quot;quando usar&quot; que você escrever em cada um é o que
          ensina o momento certo — {configRow.persona_name} nunca envia nada fora do que você descrever ali.
        </p>
      </div>

      <Card className="p-5">
        <AttachmentLibraryManager
          unitId={unitRow.id}
          orgId={unitRow.org_id}
          agentType={configRow.agent_type}
          personaName={configRow.persona_name}
          initialAttachments={(attachments ?? []) as EmployeeAttachment[]}
        />
      </Card>
    </div>
  )
}
