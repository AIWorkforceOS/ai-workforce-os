import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { Card, TableCard, TableShell, Td, Th, Tr } from '@/components/ui/dashboard-ui'
import type { Candidate, JobCandidate, JobOpening } from '@/lib/recruiter/types'

export const dynamic = 'force-dynamic'

// Apresentação da shortlist (§7.6): página autenticada que a empresa
// (usuária da org) recebe por link — capa com a vaga e o perfil ideal,
// 1 card por candidato com o relatório completo e tabela comparativa.

type Row = JobCandidate & { candidates: Candidate | null }

const RISK_COLOR: Record<string, string> = { baixo: '#4ade80', medio: '#fbbf24', alto: '#f87171' }

export default async function ShortlistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: jobData }, { data: jcData }] = await Promise.all([
    supabase.from('job_openings').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('job_candidates')
      .select('*, candidates(*)')
      .eq('job_id', id)
      .in('stage', ['shortlisted', 'presented', 'approved', 'not_selected'])
      .order('ai_score', { ascending: false, nullsFirst: false }),
  ])

  if (!jobData) notFound()
  const job = jobData as JobOpening
  const rows = ((jcData as Row[] | null) ?? []).filter((row) => row.candidates)

  return (
    <div className="flex flex-col gap-6">
      {/* Capa */}
      <Card className="p-6">
        <Link href={`/dashboard/recruiter/jobs/${job.id}`} className="text-xs font-bold text-slate-500 hover:text-cyan-400">
          ← Detalhes da vaga
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">
          Shortlist — {job.title}
        </h1>
        {job.profile.ideal_profile_summary && (
          <p className="mt-2 max-w-2xl text-sm text-slate-300">{job.profile.ideal_profile_summary}</p>
        )}
        <p className="mt-3 text-xs text-slate-500">
          {rows.length} candidato(s) triado(s) e avaliado(s) pelo Recruiter IA. Notas de 0 a 100 com
          rubrica fixa e justificativa — pontos fracos incluídos por princípio de transparência.
        </p>
      </Card>

      {rows.length === 0 && (
        <Card className="p-6 text-sm text-slate-400">
          A shortlist ainda não está pronta — os candidatos aparecem aqui quando a triagem termina.
        </Card>
      )}

      {/* Tabela comparativa */}
      {rows.length > 1 && (
        <TableCard>
          <TableShell>
            <Th>Candidato</Th>
            <Th>Curso</Th>
            <Th>Nota</Th>
            <Th>Compatibilidade</Th>
            <Th>Risco</Th>
            <Th>Disponibilidade</Th>
          </TableShell>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.id}>
                <Td className="font-semibold text-white">
                  {row.candidates!.name}
                  {row.stage === 'approved' && <span className="ml-2 text-emerald-400">✓</span>}
                </Td>
                <Td className="text-slate-400">{row.candidates!.course ?? '—'}</Td>
                <Td className="font-black text-white">{row.ai_score ?? '—'}</Td>
                <Td className="text-slate-300">{row.report?.compatibility_pct ?? '—'}%</Td>
                <Td className="font-bold">
                  <span style={{ color: RISK_COLOR[row.report?.risk ?? ''] ?? '#94a3b8' }}>{row.report?.risk ?? '—'}</span>
                </Td>
                <Td className="text-slate-400">{row.report?.availability || '—'}</Td>
              </Tr>
            ))}
          </tbody>
        </TableCard>
      )}

      {/* 1 card por candidato */}
      {rows.map((row, index) => {
        const candidate = row.candidates!
        const report = row.report
        return (
          <Card key={row.id} className="p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black text-white">
                  {index + 1}. {candidate.name}
                  {row.stage === 'approved' && <span className="ml-2 text-sm text-emerald-400">✓ escolhido</span>}
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  {[candidate.course && `${candidate.course}${candidate.semester ? ` (${candidate.semester}º sem.)` : ''}`, candidate.institution, candidate.city]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                  {candidate.disc_profile ? ` · DISC ${candidate.disc_profile}` : ''}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase text-slate-500">Nota da triagem</p>
                <p className="text-3xl font-black text-white">{row.ai_score ?? '—'}</p>
              </div>
            </div>

            {report ? (
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="text-sm text-slate-300">{report.summary}</p>
                  <div className="mt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-400">Pontos fortes</p>
                    <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                      {report.strengths.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                  <div className="mt-3">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-amber-400">Pontos de atenção</p>
                    <ul className="mt-1 list-inside list-disc text-sm text-slate-300">
                      {report.weaknesses.map((item, i) => <li key={i}>{item}</li>)}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-col gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Risco</p>
                    <p className="text-sm" style={{ color: RISK_COLOR[report.risk] ?? '#cbd5e1' }}>
                      <span className="font-bold">{report.risk}</span>{report.risk_reason ? ` — ${report.risk_reason}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Disponibilidade</p>
                    <p className="text-sm text-slate-300">{report.availability || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Expectativas (bolsa / início)</p>
                    <p className="text-sm text-slate-300">{report.expectations || '—'}</p>
                  </div>
                  {row.score_breakdown.dimensions && (
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Rubrica</p>
                      <div className="mt-1 flex flex-col gap-1">
                        {Object.entries(row.score_breakdown.dimensions).map(([key, dim]) => (
                          <div key={key} className="flex items-center justify-between gap-2 text-xs">
                            <span className="text-slate-400">{key}</span>
                            <span className="font-bold text-slate-200">{dim.score}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Relatório em produção.</p>
            )}
          </Card>
        )
      })}

      {/* Próximos passos */}
      {rows.length > 0 && (
        <Card className="p-5 text-sm text-slate-400">
          <p className="font-bold text-slate-300">Próximos passos</p>
          <p className="mt-1">
            Responda no WhatsApp com o candidato escolhido (ou marque na página da vaga). Precisa de um
            perfil diferente? Diga o ajuste — o Recruiter refaz a busca com o novo direcionamento.
          </p>
        </Card>
      )}
    </div>
  )
}
