// Leitura das instruções confirmadas e campos de "Instrução aplicada" gravados em cada post. A leitura é graciosa: se a
// tabela ainda não existe (migration 110 pendente) ou o banco falhar, o agente segue como antes — sem instrução —
// e o erro fica no log, nunca derruba o cron nem o planejamento.

import type { SupabaseClient } from '@supabase/supabase-js'
import { activeInstructionsOn, dateKeyIn, type ContentInstruction } from './instructions'

export async function fetchConfirmedInstructions(supabase: SupabaseClient, unitId: string): Promise<ContentInstruction[]> {
  try {
    const { data, error } = await supabase
      .from('content_instructions')
      .select('*')
      .eq('unit_id', unitId)
      .is('superseded_by', null)
      .eq('paused', false)
    if (error) {
      console.error('[content/instructions] falha ao ler instruções:', error.message)
      return []
    }
    return (data ?? []) as ContentInstruction[]
  } catch (error) {
    console.error('[content/instructions] erro inesperado ao ler instruções:', error)
    return []
  }
}

/** A instrução que vale no dia do calendário `dayKey` (AAAA-MM-DD), ou null. */
export function instructionForDay(list: ContentInstruction[], dayKey: string): ContentInstruction | null {
  return activeInstructionsOn(list, dayKey)[0] ?? null
}

/** Dia de calendário de "agora" no fuso da unidade (o dia que o dono enxerga). */
export function todayKeyFor(timeZone: string, now: Date = new Date()): string {
  return dateKeyIn(now, timeZone)
}

export type AppliedInstructionFields = {
  instruction_id?: string
  instruction_objective?: string
  instruction_format_reason?: string | null
  instruction_cta?: string | null
}

/** Colunas extras de content_posts. Sem instrução = objeto vazio, o insert fica idêntico ao de antes. */
export function appliedInstructionFields(
  instruction: ContentInstruction | null,
  content: { instructionFormatReason?: string; instructionCta?: string },
): AppliedInstructionFields {
  if (!instruction) return {}
  return {
    instruction_id: instruction.id,
    instruction_objective: instruction.objective,
    instruction_format_reason: content.instructionFormatReason ?? null,
    instruction_cta: content.instructionCta ?? null,
  }
}
