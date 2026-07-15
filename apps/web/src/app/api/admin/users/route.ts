import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { createServiceClient } from '@/lib/supabase/service'
import { sendWelcomeEmail } from '@/lib/email'

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://SEU-DOMINIO.vercel.app').replace(/\/+$/, '')
}

/**
 * Provisiona o acesso de um cliente à plataforma (apenas super_admin):
 *   1. cria o registro em public.users vinculado à org
 *   2. cria (ou reaproveita) a conta no Supabase Auth e gera um link de
 *      primeiro acesso (invite para conta nova, recovery para conta que já
 *      existia) — nunca uma senha em texto puro
 *   3. dispara e-mail de boas-vindas com o link (Resend); se o e-mail falhar,
 *      devolve o link na resposta para a equipe repassar manualmente
 *
 * Requer SUPABASE_SERVICE_ROLE_KEY.
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser?.isSuperAdmin) {
    return NextResponse.json({ error: 'Apenas super admin pode provisionar usuários.' }, { status: 403 })
  }

  const service = createServiceClient()
  if (!service) {
    return NextResponse.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY não configurada — crie o usuário manualmente no painel do Supabase.' },
      { status: 500 },
    )
  }

  const body = await request.json().catch(() => null)
  const email: string | undefined = body?.email?.trim().toLowerCase()
  const name: string | null = body?.name?.trim() || null
  const orgId: string | undefined = body?.org_id
  const role: string = body?.role === 'viewer' ? 'viewer' : 'admin'

  if (!email || !orgId) {
    return NextResponse.json({ error: 'email e org_id são obrigatórios.' }, { status: 400 })
  }

  const { data: org } = await service.from('organizations').select('id, name').eq('id', orgId).maybeSingle()
  if (!org) {
    return NextResponse.json({ error: 'Organização não encontrada.' }, { status: 404 })
  }

  // Registro de negócio (public.users) — upsert por e-mail
  const { data: existingUser } = await service.from('users').select('id').eq('email', email).maybeSingle()
  if (existingUser) {
    const { error: updateError } = await service
      .from('users')
      .update({ org_id: orgId, role, name: name ?? undefined, is_active: true })
      .eq('id', existingUser.id)
    if (updateError) {
      return NextResponse.json({ error: `Erro ao atualizar usuário: ${updateError.message}` }, { status: 500 })
    }
  } else {
    const { error: insertError } = await service
      .from('users')
      .insert({ email, name, org_id: orgId, role })
    if (insertError) {
      return NextResponse.json({ error: `Erro ao criar usuário: ${insertError.message}` }, { status: 500 })
    }
  }

  // Conta de login (Supabase Auth): link seguro de primeiro acesso em vez de
  // senha em texto puro. 'invite' cria a conta; se já existir, cai para
  // 'recovery' (reset de senha) na mesma conta.
  const redirectTo = `${siteUrl()}/auth/set-password`
  let actionLink: string | null = null
  let linkType: 'invite' | 'recovery' = 'invite'

  const invite = await service.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo } })
  if (invite.error) {
    const alreadyExists = /already|registered|exists/i.test(invite.error.message)
    if (!alreadyExists) {
      return NextResponse.json(
        { error: `Usuário vinculado à empresa, mas falha ao gerar link de acesso: ${invite.error.message}` },
        { status: 500 },
      )
    }
    linkType = 'recovery'
    const recovery = await service.auth.admin.generateLink({ type: 'recovery', email, options: { redirectTo } })
    if (recovery.error || !recovery.data.properties?.action_link) {
      return NextResponse.json({
        ok: true,
        email,
        emailSent: false,
        setupLink: null,
        note: 'Usuário vinculado à empresa. A conta de login já existia e não foi possível gerar um novo link — a senha atual continua valendo.',
      })
    }
    actionLink = recovery.data.properties.action_link
  } else {
    actionLink = invite.data.properties?.action_link ?? null
  }

  if (!actionLink) {
    return NextResponse.json(
      { error: 'Usuário vinculado à empresa, mas não foi possível gerar o link de acesso.' },
      { status: 500 },
    )
  }

  const emailResult = await sendWelcomeEmail({
    to: email,
    name,
    companyName: org.name,
    setPasswordUrl: actionLink,
  })

  return NextResponse.json({
    ok: true,
    email,
    emailSent: emailResult.ok,
    emailError: emailResult.ok ? null : emailResult.error,
    // Só volta pra tela se o e-mail não pôde ser enviado (ex.: RESEND_API_KEY
    // ausente) — nesse caso a equipe repassa o link por canal seguro.
    setupLink: emailResult.ok ? null : actionLink,
    linkType,
  })
}
