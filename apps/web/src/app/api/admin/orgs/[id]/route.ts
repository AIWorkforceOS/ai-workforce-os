import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * PATCH /api/admin/orgs/[id] — ativa/desativa uma empresa cliente
 * (apenas super_admin; a escrita passa pelo RLS da sessão).
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode alterar empresas.' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  if (typeof body?.is_active !== 'boolean') {
    return NextResponse.json({ error: 'is_active (boolean) é obrigatório.' }, { status: 400 })
  }

  const supabase = await createClient()
  // Desativar = cancelamento (grava o timestamp que alimenta as métricas
  // de churn e o cálculo de reembolso da garantia de 7 dias); reativar limpa.
  const update: Record<string, unknown> = body.is_active
    ? { is_active: true, cancelled_at: null, cancellation_reason: null }
    : { is_active: false, cancelled_at: new Date().toISOString(), cancellation_reason: body.reason ?? null }
  let { error } = await supabase.from('organizations').update(update).eq('id', id)
  // cancelled_at existe a partir da migration 20260714000010; se ela ainda
  // não tiver sido aplicada, mantém o comportamento antigo (só is_active).
  if (error && /cancelled_at|cancellation_reason/.test(error.message)) {
    ;({ error } = await supabase.from('organizations').update({ is_active: body.is_active }).eq('id', id))
  }
  if (error) {
    return NextResponse.json({ error: `Erro ao atualizar: ${error.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/admin/orgs/[id] — hard delete de uma empresa cliente e tudo
 * que depende dela (unidades, leads, conversas, candidatos, vagas, contas
 * de anúncio, decisões etc. — ver migration 20260716000021). Ação
 * irreversível, restrita a super_admin; exige digitar o nome exato da
 * organização como confirmação.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode excluir empresas.' }, { status: 403 })
  }

  const { id } = await params
  const body = await request.json().catch(() => null)
  const confirmName: string | undefined = body?.confirmName

  const supabase = await createClient()
  const { data: org, error: orgError } = await supabase.from('organizations').select('id, name').eq('id', id).maybeSingle()
  if (orgError) {
    return NextResponse.json({ error: `Erro ao buscar empresa: ${orgError.message}` }, { status: 500 })
  }
  if (!org) {
    return NextResponse.json({ error: 'Empresa não encontrada.' }, { status: 404 })
  }
  if (confirmName !== org.name) {
    return NextResponse.json({ error: 'Nome de confirmação não confere.' }, { status: 400 })
  }

  // Precisa dos e-mails ANTES de apagar (as linhas de public.users somem no cascade).
  const { data: orgUsers } = await supabase.from('users').select('email').eq('org_id', id)
  const emails = (orgUsers ?? []).map((u) => u.email.toLowerCase())

  const { data: counts, error: deleteError } = await supabase.rpc('admin_delete_organization', { target_org_id: id })
  if (deleteError) {
    return NextResponse.json({ error: `Erro ao excluir: ${deleteError.message}` }, { status: 500 })
  }

  // Remove as contas de login (Supabase Auth) — melhor esforço, não bloqueia
  // a resposta: os dados do banco já foram apagados de forma atômica acima.
  const authErrors: string[] = []
  let authDeletedCount = 0
  const service = createServiceClient()
  if (service && emails.length > 0) {
    const { data: list, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (listError) {
      authErrors.push(`Não foi possível listar contas de login: ${listError.message}`)
    } else {
      for (const email of emails) {
        const authUser = list.users.find((u) => u.email?.toLowerCase() === email)
        if (!authUser) continue
        const { error: delAuthError } = await service.auth.admin.deleteUser(authUser.id)
        if (delAuthError) {
          authErrors.push(`${email}: ${delAuthError.message}`)
        } else {
          authDeletedCount += 1
        }
      }
    }
  } else if (emails.length > 0 && !service) {
    authErrors.push('SUPABASE_SERVICE_ROLE_KEY não configurada — contas de login não foram removidas.')
  }

  return NextResponse.json({ ok: true, counts, authDeletedCount, authErrors })
}
