'use client'

import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { brandGradient } from '@/components/ui/dashboard-ui'

// "Test Your AI Employee" pra quem não conversa com cliente simulado
// (Tráfego, Conteúdo, SEO — ver TestChat pros outros 3). Chama
// /api/agent/pre-activation-test, que roda a MESMA função real de
// produção (sem persistir nada) e nunca finge sucesso: quando a
// validação de verdade não é possível (sem conta conectada, sem site
// configurado), a mensagem diz isso explicitamente.

type AgentType = 'content_specialist' | 'seo_specialist' | 'traffic_specialist'

type TestResult = { ok: boolean; error?: string; preview?: Record<string, unknown> }

const RUN_LABEL: Record<AgentType, string> = {
  content_specialist: 'Gerar um post de teste',
  seo_specialist: 'Rodar auditoria de SEO real',
  traffic_specialist: 'Checar conexão com contas de anúncio',
}

function ContentPreview({ preview }: { preview: Record<string, unknown> }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Legenda gerada agora</p>
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{String(preview.caption ?? '')}</p>
      </div>
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Por que este post</p>
        <p className="mt-2 text-sm text-slate-400">{String(preview.reasoning ?? '')}</p>
      </div>
      <p className="text-xs text-slate-500">Só a legenda foi gerada agora (a imagem é gerada no post real). Nada foi publicado nem salvo.</p>
    </div>
  )
}

function SeoPreview({ preview }: { preview: Record<string, unknown> }) {
  const score = Number(preview.score ?? 0)
  const scoreColor = score >= 80 ? '#4ade80' : score >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Auditoria real de {String(preview.siteUrl ?? '')}</p>
        <p className="mt-2 text-2xl font-black" style={{ color: scoreColor }}>{score}/100</p>
        <p className="mt-1 text-xs text-slate-400">{String(preview.checksCount ?? 0)} verificações rodadas agora, direto no site.</p>
      </div>
      <p className="text-xs text-slate-500">Veja o detalhe completo no painel de SEO depois de ativar.</p>
    </div>
  )
}

function TrafficPreview({ preview }: { preview: Record<string, unknown> }) {
  const connected = Boolean(preview.connected)
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: connected ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.08)',
        border: `1px solid ${connected ? 'rgba(34,197,94,0.25)' : 'rgba(245,158,11,0.25)'}`,
      }}
    >
      <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: connected ? '#4ade80' : '#fbbf24' }}>
        {connected ? 'Conta conectada de verdade' : 'Ainda sem conexão real'}
      </p>
      <p className="mt-2 text-sm text-slate-300">{String(preview.message ?? '')}</p>
    </div>
  )
}

export function PreActivationTest({ configId: _configId, unitId, agentType }: { configId: string; unitId: string; agentType: AgentType }) {
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  async function runTest() {
    setRunning(true)
    setResult(null)
    try {
      const res = await fetch('/api/agent/pre-activation-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unitId, agentType }),
      })
      const data = (await res.json()) as TestResult
      setResult(data)
    } catch {
      setResult({ ok: false, error: 'Não foi possível rodar o teste agora. Tente de novo em instantes.' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <button
        onClick={runTest}
        disabled={running}
        className="flex items-center justify-center gap-2 self-start rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
        style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
      >
        {running ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
        {running ? 'Rodando teste real...' : RUN_LABEL[agentType]}
      </button>

      {result && !result.ok && (
        <div className="rounded-xl p-4 text-sm text-red-300" style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)' }}>
          {result.error}
        </div>
      )}

      {result?.ok && result.preview && agentType === 'content_specialist' && <ContentPreview preview={result.preview} />}
      {result?.ok && result.preview && agentType === 'seo_specialist' && <SeoPreview preview={result.preview} />}
      {result?.ok && result.preview && agentType === 'traffic_specialist' && <TrafficPreview preview={result.preview} />}
    </div>
  )
}
