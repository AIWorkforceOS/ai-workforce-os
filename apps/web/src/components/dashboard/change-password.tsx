'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, ShieldCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Card, Input, Label } from '@/components/ui/dashboard-ui'

export function ChangePasswordCard() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setDone(false)
    if (password.length < 8) {
      setError('A nova senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não conferem.')
      return
    }
    setBusy(true)
    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(
        /same password/i.test(updateError.message)
          ? 'A nova senha precisa ser diferente da atual.'
          : 'Não foi possível trocar a senha agora. Tente novamente.',
      )
      return
    }
    setPassword('')
    setConfirm('')
    setDone(true)
  }

  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <div
          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-purple-500"
          style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
        >
          <ShieldCheck size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">Trocar senha</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">
            Recebeu uma senha temporária? Troque aqui por uma só sua.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="newPassword">Nova senha</Label>
          <Input
            id="newPassword"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Mín. 8 caracteres"
            autoComplete="new-password"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Repita a nova senha</Label>
          <Input
            id="confirmPassword"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Igual à de cima"
            autoComplete="new-password"
          />
        </div>

        <div className="sm:col-span-2">
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          {done && <p className="mb-2 text-sm text-emerald-400">Senha trocada com sucesso!</p>}
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            {busy ? 'Trocando...' : 'Trocar senha'}
          </button>
        </div>
      </form>
    </Card>
  )
}
