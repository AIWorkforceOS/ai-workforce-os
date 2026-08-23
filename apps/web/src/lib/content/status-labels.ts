// Labels/cores de status compartilhados entre a página principal e a
// visão semanal do Gestor de Conteúdo (evita duplicar o mapeamento).
import type { BadgeVariant } from '@/components/ui/dashboard-ui'

export const CONTENT_STATUS_VARIANT: Record<string, BadgeVariant> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'blue',
  scheduled: 'blue',
  published: 'green',
  rejected: 'slate',
  failed: 'red',
}

export const CONTENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  pending_approval: 'Aguardando aprovação',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  published: 'Publicado',
  rejected: 'Rejeitado',
  failed: 'Falhou',
}
