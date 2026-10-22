'use client'

import { Input } from '@/components/ui/dashboard-ui'
import { generateInitialPassword } from '@/lib/auth/provision-login'

export type LoginChoice = { kind: 'password' | 'invite'; password: string }

/** Escolha de como a pessoa recebe o acesso: senha definida agora (com botão Gerar) ou link para ela criar a própria senha. */
export function LoginFields({ value, onChange }: { value: LoginChoice; onChange: (v: LoginChoice) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2 text-xs font-bold">
        <button type="button" onClick={() => onChange({ ...value, kind: 'password' })} className={`rounded-lg px-3 py-1.5 ${value.kind === 'password' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
          Definir a senha agora
        </button>
        <button type="button" onClick={() => onChange({ ...value, kind: 'invite' })} className={`rounded-lg px-3 py-1.5 ${value.kind === 'invite' ? 'bg-white/10 text-white' : 'text-slate-400'}`}>
          Gerar link para a pessoa criar a senha
        </button>
      </div>
      {value.kind === 'password' && (
        <div className="flex gap-2">
          <Input value={value.password} onChange={(e) => onChange({ ...value, password: e.target.value })} placeholder="Mínimo 8 caracteres" autoComplete="new-password" />
          <button type="button" onClick={() => onChange({ ...value, password: generateInitialPassword() })} className="shrink-0 rounded-lg px-3 text-xs font-bold text-cyan-300" style={{ border: '1px solid rgba(6,182,212,0.3)' }}>
            Gerar
          </button>
        </div>
      )}
    </div>
  )
}

/** Mostra o acesso criado UMA vez (a senha não fica guardada em lugar nenhum). */
export function AccessCreatedNotice({ email, password, setupLink }: { email: string; password: string | null; setupLink: string | null }) {
  return (
    <div className="rounded-xl p-3 text-xs text-slate-200" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)' }}>
      <p className="font-bold text-emerald-300">Acesso criado</p>
      <p className="mt-1">
        Login: <span className="font-mono font-bold text-white">{email}</span>
      </p>
      {password && (
        <p>
          Senha inicial: <span className="font-mono font-bold text-white">{password}</span>
        </p>
      )}
      {setupLink && <p className="mt-1 break-all">Link para criar a senha: <span className="font-mono text-white">{setupLink}</span></p>}
      <p className="mt-1 text-amber-300">{password ? 'Anote e entregue agora: a senha não fica guardada e não aparece de novo. A pessoa pode trocá-la em Configurações.' : 'Envie o link por um canal seguro (WhatsApp, e-mail).'}</p>
    </div>
  )
}
