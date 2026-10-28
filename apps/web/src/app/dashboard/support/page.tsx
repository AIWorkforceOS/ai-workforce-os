import { redirect } from 'next/navigation'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { AuthorizeRepairButton, RepairProposalForm } from './support-case-actions'

type SupportCase = {
  id: string
  protocol: string
  title: string
  description: string
  diagnosis: string | null
  status: string
  repair_proposal: string | null
  reporter_email: string | null
  created_at: string
}

export default async function SupportPage() {
  const user = await getAppUser()
  if (!user) redirect('/login')
  const supabase = await createClient()
  let query = supabase.from('support_cases').select('*').order('created_at', { ascending: false }).limit(100)
  if (!user.isSuperAdmin && user.orgId) query = query.eq('org_id', user.orgId)
  const { data } = await query
  const cases = (data as SupportCase[] | null) ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white">Suporte TI</h1>
        <p className="mt-1 text-sm text-slate-400">Acompanhe diagnósticos e autorize qualquer reparo antes de uma alteração.</p>
      </div>
      {cases.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-sm text-slate-400">Nenhum chamado aberto.</div>
      ) : (
        <div className="space-y-4">
          {cases.map((supportCase) => (
            <article key={supportCase.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold text-cyan-300">{supportCase.protocol}</span>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] uppercase text-slate-300">{supportCase.status.replaceAll('_', ' ')}</span>
              </div>
              <h2 className="mt-3 font-bold text-white">{supportCase.title}</h2>
              <p className="mt-1 text-sm text-slate-300">{supportCase.description}</p>
              {supportCase.diagnosis && <p className="mt-3 rounded-lg bg-slate-950/60 p-3 text-xs text-slate-400"><strong>Diagnóstico:</strong> {supportCase.diagnosis}</p>}
              {supportCase.repair_proposal && <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-sm text-amber-100"><strong>Reparo proposto:</strong> {supportCase.repair_proposal}</p>}
              {user.isSuperAdmin && supportCase.status !== 'resolved' && supportCase.status !== 'closed' && <RepairProposalForm caseId={supportCase.id} />}
              {!user.isSuperAdmin && user.role === 'admin' && supportCase.status === 'awaiting_authorization' && <AuthorizeRepairButton caseId={supportCase.id} />}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
