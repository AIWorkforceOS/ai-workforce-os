import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmployeeAttachment, Unit } from '@/lib/types'

/**
 * Materiais ativos da biblioteca da organização visíveis para um
 * funcionário nesta unidade (migration 036, generalizada na 062): inclui
 * tanto materiais cadastrados especificamente para `unit` quanto os
 * cadastrados para a organização inteira (unit_id null), filtrados pelos
 * que têm `agentType` em `applicable_employees` — um mesmo material pode
 * valer para vários funcionários ao mesmo tempo.
 */
export async function fetchActiveAttachments(
  supabase: SupabaseClient,
  unit: Pick<Unit, 'id' | 'org_id'>,
  agentType: string,
): Promise<EmployeeAttachment[]> {
  if (!unit.org_id) return []

  const { data } = await supabase
    .from('employee_attachments')
    .select('*')
    .eq('org_id', unit.org_id)
    .or(`unit_id.eq.${unit.id},unit_id.is.null`)
    .overlaps('applicable_employees', [agentType])
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  return (data as EmployeeAttachment[] | null) ?? []
}

/**
 * Texto injetado no system prompt (buildSystemPrompt em
 * lib/conversation-engine.ts) com a lista de materiais disponíveis e a
 * instrução de quando usar cada um — é essa instrução, escrita pelo
 * próprio cliente na UI, que funciona como "treinamento" da decisão.
 * Vazio quando não há nenhum anexo ativo (nenhum contexto extra, sem
 * mudar o comportamento de quem nunca configurou nada).
 */
export function buildAttachmentsContext(attachments: EmployeeAttachment[]): string {
  if (attachments.length === 0) return ''

  const kindLabel = (kind: EmployeeAttachment['kind']) =>
    kind === 'pdf' ? 'PDF' : kind === 'image' ? 'imagem' : 'link'

  const list = attachments
    .map((a) => `id "${a.id}": "${a.title}" (${kindLabel(a.kind)}) — quando usar: ${a.usage_instructions}`)
    .join('; ')

  return [
    `MATERIAIS DISPONÍVEIS PARA ENVIAR: você pode enviar os seguintes materiais durante a conversa, SOMENTE quando fizer sentido pelo contexto descrito em cada um — nunca envie por padrão, nem em toda mensagem, nem mais de uma vez para o mesmo assunto: ${list}.`,
    'Para enviar um deles nesta resposta, retorne o campo "attachment_id" com o id EXATO da lista acima. Para não enviar nada nesta mensagem, retorne "attachment_id": null. Nunca invente um id que não esteja na lista, e nunca invente a existência de um material que não está nela.',
  ].join(' ')
}
