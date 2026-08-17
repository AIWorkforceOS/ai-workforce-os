'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Unit } from '@/lib/types'
import { FormSection, Input, Label, Textarea } from '@/components/ui/dashboard-ui'

const DEFAULT_ACCENT = '#0f172a'
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i

/**
 * Edição do wrapper visual do e-mail de prospecção (item pedido em
 * 2026-08-17: Vinicius queria ver como o lead recebe o e-mail e poder
 * ajustar). O TEXTO do e-mail continua sendo gerado pela IA por lead —
 * aqui só se edita o que É fixo: cor de destaque e uma nota de rodapé.
 * Salva direto em units (mesmo padrão do UnitSettingsForm) e qualquer
 * envio seguinte já sai com o ajuste, sem precisar de deploy.
 */
export function EmailBrandingForm({ unit }: { unit: Unit }) {
  const router = useRouter()
  const [accentColor, setAccentColor] = useState(unit.email_accent_color ?? DEFAULT_ACCENT)
  const [footerNote, setFooterNote] = useState(unit.email_footer_note ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    setSaved(false)

    if (accentColor && !HEX_COLOR_RE.test(accentColor.trim())) {
      setError('Cor inválida — use o formato hexadecimal, ex: #0f172a.')
      return
    }

    setSaving(true)
    const supabase = createClient()
    const { error: saveError } = await supabase
      .from('units')
      .update({
        email_accent_color: accentColor.trim() || null,
        email_footer_note: footerNote.trim() || null,
      })
      .eq('id', unit.id)
    setSaving(false)

    if (saveError) {
      setError('Não foi possível salvar as alterações.')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit}>
      <FormSection title="Layout do e-mail">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="accentColor">Cor de destaque</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={HEX_COLOR_RE.test(accentColor.trim()) ? accentColor.trim() : DEFAULT_ACCENT}
                onChange={(event) => setAccentColor(event.target.value)}
                className="h-10 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent"
                aria-label="Selecionar cor de destaque"
              />
              <Input
                id="accentColor"
                value={accentColor}
                onChange={(event) => setAccentColor(event.target.value)}
                placeholder={DEFAULT_ACCENT}
              />
            </div>
            <p className="text-[11px] text-slate-500">Usada na faixa superior e no nome da unidade quando não há logo.</p>
          </div>

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor="footerNote">Nota extra no rodapé (opcional)</Label>
            <Textarea
              id="footerNote"
              rows={2}
              value={footerNote}
              onChange={(event) => setFooterNote(event.target.value)}
              placeholder="Ex.: Razão social, endereço, ou aviso legal."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {saving ? 'Salvando…' : 'Salvar e aplicar aos próximos envios'}
          </button>
          {saved && <span className="text-xs font-semibold text-green-400">Salvo — a próxima mensagem já sai com o ajuste.</span>}
          {error && <span className="text-xs font-semibold text-red-400">{error}</span>}
        </div>
      </FormSection>
    </form>
  )
}
