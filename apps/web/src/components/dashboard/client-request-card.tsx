import { parseClientRequest } from '@/lib/portal-360/data'
import { formatUsd } from '@/lib/portal-360/dashboard'

/** O que o cliente informou ao criar a ordem pelo portal: descrição, prioridade, valor e tempo já aprovados e as fotos dele. Só leitura para o escritório. */
export function ClientRequestCard({ customFields, priority }: { customFields: Record<string, unknown> | null | undefined; priority: string | null }) {
  const req = parseClientRequest(customFields)
  if (!req || (!req.description && req.approvedAmount == null && req.approvedHours == null && req.photos.length === 0)) return null
  return (
    <div className="flex flex-col gap-1.5 rounded-xl px-3.5 py-3 text-xs text-slate-200" style={{ background: 'rgba(6,182,212,0.06)', border: '1px solid rgba(6,182,212,0.22)' }}>
      <span className="text-[11px] font-black uppercase tracking-wider text-cyan-300">Pedido feito pelo cliente no portal</span>
      {priority && <p><span className="font-bold text-white">Prioridade: </span>{priority}</p>}
      {req.approvedAmount != null && <p><span className="font-bold text-white">Valor aprovado pelo cliente: </span>{formatUsd(req.approvedAmount)}</p>}
      {req.approvedHours != null && <p><span className="font-bold text-white">Tempo aprovado: </span>{req.approvedHours} h</p>}
      {req.description && <p className="whitespace-pre-wrap text-slate-300">{req.description}</p>}
      {req.photos.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {req.photos.map((url) => (
            <a key={url} href={url} target="_blank" rel="noopener noreferrer">
              <img src={url} alt="Foto enviada pelo cliente" className="h-16 w-16 rounded-lg object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  )
}
