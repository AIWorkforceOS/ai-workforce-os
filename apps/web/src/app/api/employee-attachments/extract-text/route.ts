import { NextResponse } from 'next/server'
import { getAppUser } from '@/lib/app-user'
import { extractAttachmentPdfText } from '@/lib/attachments'

export const dynamic = 'force-dynamic'

/**
 * POST /api/employee-attachments/extract-text — item 5 do pedido de
 * 2026-08-14. O upload da biblioteca de materiais (AttachmentLibraryManager)
 * roda inteiramente no cliente (insert direto no Supabase via RLS), mas a
 * extração de texto precisa da OPENAI_API_KEY, que é secreta — por isso
 * esta rota server-side: o cliente sobe o PDF no Storage, chama esta rota
 * com a URL pública, e só então grava a linha em employee_attachments já
 * com `extracted_text` preenchido. Mesmo padrão de
 * /api/units/[id]/service-order/extract (extrai antes de gravar, no
 * cliente).
 */
export async function POST(request: Request) {
  const appUser = await getAppUser()
  if (!appUser) {
    return NextResponse.json({ error: 'Não autenticado.' }, { status: 401 })
  }
  if (!appUser.isSuperAdmin && appUser.role !== 'admin') {
    return NextResponse.json({ error: 'Sem permissão para extrair texto de materiais.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const fileUrl = (body as { fileUrl?: unknown } | null)?.fileUrl
  const fileName = (body as { fileName?: unknown } | null)?.fileName
  if (typeof fileUrl !== 'string' || !fileUrl || typeof fileName !== 'string' || !fileName) {
    return NextResponse.json({ error: 'Informe a URL e o nome do arquivo.' }, { status: 400 })
  }

  const text = await extractAttachmentPdfText(fileUrl, fileName)

  return NextResponse.json({ text, failed: text === null })
}
