import { FileText, MapPin } from 'lucide-react'
import type { PortalAppointment } from '@/lib/portal-funcionario/data'

/** Cabeçalho da ordem (cliente, horário, endereço, descrição, arquivo original). Sem estado: usado na página do servidor E na casca offline. */
export function OrderHeader({ appointment, locale = 'pt-BR' }: { appointment: PortalAppointment; locale?: string }) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <p className="text-[11px] font-black uppercase tracking-[0.15em] text-cyan-300">
        Ordem de serviço {appointment.service_order_number ? `Nº ${appointment.service_order_number}` : ''}
      </p>
      <p className="mt-1 text-base font-bold text-white">
        {appointment.customers?.name ?? 'Cliente'} {appointment.services?.name ? `· ${appointment.services.name}` : ''}
      </p>
      <p className="mt-1 text-xs text-slate-400">
        {new Date(appointment.starts_at).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}
      </p>
      {appointment.address && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(appointment.address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-400 hover:underline"
          title="Abrir no Google Maps"
        >
          <MapPin size={12} />
          {appointment.address}
        </a>
      )}
      {appointment.service_order_summary_pt && <p className="mt-3 text-sm text-slate-300">{appointment.service_order_summary_pt}</p>}
      {appointment.service_order_scope_en && (
        <div className="mt-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Descrição original (inglês) — pra mostrar ao gerente</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{appointment.service_order_scope_en}</p>
        </div>
      )}
      {appointment.service_order_file_url && (
        <a
          href={appointment.service_order_file_url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-cyan-300 transition-colors hover:text-cyan-200"
          style={{ background: 'rgba(6,182,212,0.08)', border: '1px solid rgba(6,182,212,0.25)' }}
        >
          <FileText size={13} />
          {appointment.service_order_file_name || 'Ver arquivo original da ordem'}
        </a>
      )}
    </div>
  )
}
