'use client'

import Link from 'next/link'
import { ArrowRight, Briefcase, Bot, Headset, Sparkles } from 'lucide-react'
import { Card } from '@/components/ui/dashboard-ui'
import { FIRST_EMPLOYEE_RECOMMENDATIONS } from '@/lib/first-employee-recommendation'

const ICONS = { receptionist: Headset, sdr: Bot, recruiter: Briefcase }

export function FirstEmployeeRecommendation({ companyName }: { companyName: string }) {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.16em] text-cyan-400">primeiro resultado</p>
        <h1 className="mt-1 text-2xl font-black text-white">O que você mais precisa resolver agora?</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          A {companyName} não precisa começar por Vendas obrigatoriamente. Escolha a dor principal e o Alizo indica o funcionário certo.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {FIRST_EMPLOYEE_RECOMMENDATIONS.map((item) => {
          const Icon = ICONS[item.agentType]
          return (
            <Card key={item.need} className="flex flex-col p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300">
                <Icon size={20} />
              </div>
              <h2 className="mt-4 text-sm font-black text-white">{item.title}</h2>
              <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-400">{item.description}</p>
              <p className="mt-4 flex items-center gap-1.5 text-xs font-bold text-emerald-400"><Sparkles size={12} /> {item.result}</p>
              <Link
                href={`/dashboard/equipe-digital/contratar/${item.agentType}?from=onboarding`}
                className="mt-4 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black text-white"
                style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}
              >
                Escolher este caminho <ArrowRight size={13} />
              </Link>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
