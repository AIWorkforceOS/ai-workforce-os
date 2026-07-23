import type { SupabaseClient } from '@supabase/supabase-js'
import type { EmployeeAttachment } from '@/lib/types'

/**
 * Anexos ativos da biblioteca de um funcionário (migration 036). Cada
 * agent_type tem sua própria lista dentro da unidade — ver comentário da
 * migration para o porquê de não ser compartilhada entre funcionários.
 */
export async function fetchActiveAttachments(
  supabase: SupabaseClient,
  unitId: string,
  agentType: string,
): Promise<EmployeeAttachment[]> {
  const { data } = await supabase
    .from('employee_attachments')
    .select('*')
    .eq('unit_id', unitId)
    .eq('agent_type', agentType)
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

  const list = attachments
    .map(
      (a) =>
        `id "${a.id}": "${a.title}" (${a.kind === 'pdf' ? 'PDF' : 'link'}) — quando usar: ${a.usage_instructions}`,
    )
    .join('; ')

  return [
    `MATERIAIS DISPONÍVEIS PARA ENVIAR: você pode enviar os seguintes materiais durante a conversa, SOMENTE quando fizer sentido pelo contexto descrito em cada um — nunca envie por padrão, nem em toda mensagem, nem mais de uma vez para o mesmo assunto: ${list}.`,
    'Para enviar um deles nesta resposta, retorne o campo "attachment_id" com o id EXATO da lista acima. Para não enviar nada nesta mensagem, retorne "attachment_id": null. Nunca invente um id que não esteja na lista, e nunca invente a existência de um material que não está nela.',
  ].join(' ')
}
