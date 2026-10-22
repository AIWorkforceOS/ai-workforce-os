import type { SupabaseClient } from '@supabase/supabase-js'
import { generateAccessLink } from './access-link'

/**
 * Cria o login (Supabase Auth) + o registro de negócio (public.users) de uma pessoa nova — funcionário, usuário do escritório ou cliente do portal.
 *
 * SEGURANÇA: nunca assume uma conta que já existe. Um e-mail que já tem registro em public.users (de qualquer empresa ou papel, inclusive super admin)
 * ou já tem login no Auth NÃO é reaproveitado com senha nova — antes, esse caminho trocava a senha e reescrevia o papel de quem fosse. A única exceção
 * é a redefinição de senha da MESMA conta (`resetUserId`), já checada pelo chamador.
 */
export type LoginMode = { kind: 'password'; password: string } | { kind: 'invite'; redirectTo: string }

export type UserRowInput = {
  name: string | null
  role: 'admin' | 'viewer' | 'employee' | 'client'
  org_id: string | null
  unit_id: string | null
  employee_id?: string | null
  client_company?: string | null
  job_role?: string | null
}

export type ProvisionResult = { ok: true; userId: string; setupLink: string | null } | { ok: false; status: number; error: string }

export const MIN_PASSWORD_LENGTH = 8

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
  if (password.length > 72) return 'A senha pode ter no máximo 72 caracteres.'
  return null
}

const EXISTS = /already|registered|exists/i

export async function provisionLogin(service: SupabaseClient, input: { email: string; mode: LoginMode; row: UserRowInput }): Promise<ProvisionResult> {
  const email = input.email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, status: 400, error: 'E-mail inválido.' }
  if (input.mode.kind === 'password') {
    const problem = validatePassword(input.mode.password)
    if (problem) return { ok: false, status: 400, error: problem }
  }

  const { data: existing } = await service.from('users').select('id').ilike('email', email).maybeSingle()
  if (existing) return { ok: false, status: 409, error: 'Este e-mail já tem acesso ao sistema. Use outro e-mail ou edite o acesso existente.' }

  let authUserId: string | null = null
  let setupLink: string | null = null
  if (input.mode.kind === 'password') {
    const created = await service.auth.admin.createUser({ email, password: input.mode.password, email_confirm: true })
    if (created.error || !created.data.user) {
      if (created.error && EXISTS.test(created.error.message)) return { ok: false, status: 409, error: 'Já existe um login com este e-mail. Use outro e-mail, ou envie um link de acesso em vez de definir a senha.' }
      return { ok: false, status: 500, error: 'Não foi possível criar o login. Tente de novo.' }
    }
    authUserId = created.data.user.id
  } else {
    const link = await generateAccessLink(service, email, input.mode.redirectTo)
    if (!link.ok) return { ok: false, status: 500, error: 'Não foi possível gerar o link de acesso.' }
    setupLink = link.link
  }

  const { data: inserted, error } = await service
    .from('users')
    .insert({ email, is_active: true, ...input.row })
    .select('id')
    .single()
  if (error || !inserted) {
    // não deixa um login órfão sem registro de negócio
    if (authUserId) await service.auth.admin.deleteUser(authUserId).catch(() => undefined)
    return { ok: false, status: 500, error: 'Não foi possível vincular o acesso. Nada foi criado.' }
  }
  return { ok: true, userId: (inserted as { id: string }).id, setupLink }
}

/** Redefine a senha de uma conta que já é do chamador gerenciar (o chamador confirma a posse antes). */
export async function resetLoginPassword(service: SupabaseClient, email: string, password: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const problem = validatePassword(password)
  if (problem) return { ok: false, status: 400, error: problem }
  const link = await service.auth.admin.generateLink({ type: 'recovery', email: email.trim().toLowerCase() })
  const authId = link.data?.user?.id
  if (link.error || !authId) return { ok: false, status: 404, error: 'Login não encontrado para redefinir a senha.' }
  const update = await service.auth.admin.updateUserById(authId, { password, email_confirm: true })
  if (update.error) return { ok: false, status: 500, error: 'Não foi possível redefinir a senha.' }
  return { ok: true }
}

/** Senha inicial aleatória legível (sem caracteres ambíguos), para o administrador entregar à pessoa. */
export function generateInitialPassword(length = 12, random: (n: number) => number = (n) => Math.floor(Math.random() * n)): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length }, () => alphabet[random(alphabet.length)]).join('')
}
