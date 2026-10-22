import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeClientName, sameClientName } from './profile'

export type RenameResult = { ok: true; changed: boolean; customers: number; logins: number } | { ok: false; status: number; error: string }

/**
 * Renomeia um cliente em TODOS os lugares que usam o nome como vínculo: o cadastro do cliente, os cadastros por unidade (customers.client_company e o
 * próprio cadastro de mesmo nome) e os logins do portal do cliente (users.client_company). As ordens seguem o cliente porque apontam para o cadastro.
 * Compara os nomes em código (sem curinga de LIKE) para nunca pegar um cliente parecido. Se uma etapa falha, desfaz o nome do cadastro.
 * Usa a chave de serviço (os logins de cliente não têm empresa, então a RLS do usuário não os enxerga).
 */
export async function renameClientEverywhere(service: SupabaseClient, input: { profileId: string; orgId: string; oldName: string; newName: string }): Promise<RenameResult> {
  const newName = normalizeClientName(input.newName)
  const oldName = normalizeClientName(input.oldName)
  if (!newName) return { ok: false, status: 400, error: 'Informe o nome do cliente.' }
  if (newName === oldName) return { ok: true, changed: false, customers: 0, logins: 0 }

  const { data: others } = await service.from('client_company_profiles').select('id, name').eq('org_id', input.orgId)
  const clash = ((others ?? []) as { id: string; name: string }[]).some((p) => p.id !== input.profileId && sameClientName(p.name, newName))
  if (clash) return { ok: false, status: 409, error: 'Já existe um cliente com este nome.' }

  const { error: profileError } = await service.from('client_company_profiles').update({ name: newName }).eq('id', input.profileId).eq('org_id', input.orgId)
  if (profileError) return { ok: false, status: 500, error: 'Não foi possível renomear o cliente.' }

  const revert = async () => {
    await service.from('client_company_profiles').update({ name: oldName }).eq('id', input.profileId)
  }

  const { data: customers } = await service.from('customers').select('id, name, client_company').eq('org_id', input.orgId).not('client_company', 'is', null).limit(5000)
  const mine = ((customers ?? []) as { id: string; name: string | null; client_company: string | null }[]).filter((c) => sameClientName(c.client_company, oldName))
  for (const c of mine) {
    const patch: Record<string, string> = { client_company: newName }
    if (sameClientName(c.name, oldName)) patch.name = newName // o cadastro que tem o nome do próprio cliente acompanha
    const { error } = await service.from('customers').update(patch).eq('id', c.id)
    if (error) {
      await revert()
      return { ok: false, status: 500, error: 'Não foi possível atualizar as ordens do cliente. Nada foi alterado.' }
    }
  }

  const { data: logins } = await service.from('users').select('id, client_company').eq('role', 'client').not('client_company', 'is', null).limit(1000)
  const clientLogins = ((logins ?? []) as { id: string; client_company: string | null }[]).filter((u) => sameClientName(u.client_company, oldName))
  for (const u of clientLogins) {
    const { error } = await service.from('users').update({ client_company: newName }).eq('id', u.id)
    if (error) return { ok: false, status: 500, error: 'Cliente renomeado, mas um login do portal não foi atualizado. Recadastre o acesso dele.' }
  }
  return { ok: true, changed: true, customers: mine.length, logins: clientLogins.length }
}
