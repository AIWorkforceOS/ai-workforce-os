import type { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, LabelHTMLAttributes } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Design tokens shared across the dashboard — dark, glass, cyan/indigo accent.
// ---------------------------------------------------------------------------
export const cardShadow = '0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.06)'
export const brandGradient = 'linear-gradient(135deg, #06b6d4 0%, #4361ee 100%)'

const badgeVariants = {
  green: { background: 'rgba(34,197,94,0.12)', color: '#4ade80' },
  red: { background: 'rgba(239,68,68,0.12)', color: '#f87171' },
  amber: { background: 'rgba(245,158,11,0.12)', color: '#fbbf24' },
  blue: { background: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
  purple: { background: 'rgba(139,92,246,0.15)', color: '#a78bfa' },
  cyan: { background: 'rgba(6,182,212,0.15)', color: '#22d3ee' },
  slate: { background: 'rgba(255,255,255,0.06)', color: '#64748b' },
} as const

export type BadgeVariant = keyof typeof badgeVariants

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-2xl bg-[#141a2b] ${className}`} style={{ boxShadow: cardShadow }}>
      {children}
    </div>
  )
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow: string
  title: string
  subtitle?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{eyebrow}</p>
        <h1 className="mt-0.5 text-2xl font-black tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function CardHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <div>
        <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">{eyebrow}</p>
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function Badge({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  const style = badgeVariants[variant]
  return (
    <span className="rounded-full px-2.5 py-1 text-[11px] font-bold capitalize" style={style}>
      {children}
    </span>
  )
}

export function PrimaryButton({ href, children, icon }: { href: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
      style={{ background: brandGradient, boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
    >
      {icon}
      {children}
    </Link>
  )
}

export function GhostLink({ href, children, icon }: { href: string; children: ReactNode; icon?: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-center gap-1.5 rounded-xl py-2 text-xs font-bold text-slate-300 transition-all hover:bg-white/5"
      style={{ border: '1px solid rgba(255,255,255,0.08)' }}
    >
      {icon}
      {children}
    </Link>
  )
}

export function EmptyState({
  icon,
  title,
  subtitle,
  actionHref,
  actionLabel,
  gradient = 'linear-gradient(135deg, #06b6d4, #4361ee)',
}: {
  icon: ReactNode
  title: string
  subtitle?: string
  actionHref?: string
  actionLabel?: string
  gradient?: string
}) {
  return (
    <div className="flex flex-col items-center gap-4 px-5 py-20 text-center">
      <div
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: gradient, boxShadow: '0 6px 16px rgba(6,182,212,0.25)' }}
      >
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-white">{title}</p>
        {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
      </div>
      {actionHref && actionLabel && (
        <Link
          href={actionHref}
          className="rounded-xl px-5 py-2 text-sm font-bold text-white"
          style={{ background: brandGradient, boxShadow: '0 4px 12px rgba(6,182,212,0.25)' }}
        >
          {actionLabel}
        </Link>
      )}
    </div>
  )
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th className="px-5 py-3 text-left text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
      {children}
    </th>
  )
}

export function TableShell({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        {children}
      </tr>
    </thead>
  )
}

export function Tr({ children }: { children: ReactNode }) {
  return (
    <tr className="last:border-0 transition-colors hover:bg-white/[0.03]" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      {children}
    </tr>
  )
}

export function Td({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <td className={`px-5 py-3.5 ${className}`}>{children}</td>
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------
const fieldClass =
  'rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-cyan-500/50'
const fieldStyle = { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }

export function Label({ children, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className="text-xs font-bold uppercase tracking-wide text-slate-400" {...props}>
      {children}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', style, ...rest } = props
  return <input className={`${fieldClass} ${className}`} style={{ ...fieldStyle, ...style }} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', style, ...rest } = props
  return <select className={`${fieldClass} ${className}`} style={{ ...fieldStyle, ...style }} {...rest} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', style, ...rest } = props
  return <textarea className={`${fieldClass} ${className}`} style={{ ...fieldStyle, ...style }} {...rest} />
}

export function FormSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold text-white">{title}</h2>
        {action}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// KpiCard — número + label + sub-texto, barra superior em gradiente e ícone
// opcional. Vira <Link> (com hover de elevação) quando `href` é passado.
// `gradient` recebe classes Tailwind de gradiente, ex.: 'from-cyan-400 to-blue-500'.
// `icon` deve chegar já renderizado, ex.: <Users size={16} className="text-white" />.
// ---------------------------------------------------------------------------
export function KpiCard({
  label,
  value,
  sub,
  icon,
  gradient = 'from-cyan-400 to-blue-500',
  href,
}: {
  label: string
  value: ReactNode
  sub?: string
  icon?: ReactNode
  gradient?: string
  href?: string
}) {
  const inner = (
    <>
      <div className={`absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r ${gradient}`} />
      <div className="p-4 pt-5">
        {icon && (
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${gradient}`}
            style={{ boxShadow: '0 4px 10px rgba(0,0,0,0.3)' }}
          >
            {icon}
          </div>
        )}
        <p className={`${icon ? 'mt-3 ' : ''}text-[26px] font-black leading-none tracking-tight text-white`}>{value}</p>
        <p className="mt-1.5 text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">{label}</p>
        {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
      </div>
    </>
  )
  const baseStyle = { background: '#141a2b', boxShadow: cardShadow }
  if (href) {
    return (
      <Link
        href={href}
        className="group relative block overflow-hidden rounded-2xl transition-all duration-200 hover:-translate-y-0.5"
        style={baseStyle}
      >
        {inner}
      </Link>
    )
  }
  return (
    <div className="relative overflow-hidden rounded-2xl" style={baseStyle}>
      {inner}
    </div>
  )
}

// ---------------------------------------------------------------------------
// SectionLabel — o "eyebrow" uppercase 10px usado antes de uma seção, com
// ação opcional à direita (ex.: link "Ver tudo →").
// ---------------------------------------------------------------------------
export function SectionLabel({
  children,
  action,
  className = '',
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between ${className}`}>
      <p className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">{children}</p>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// TableCard — Card + cabeçalho opcional + <table> dentro de overflow-x-auto,
// pra tabela não estourar o layout em telas pequenas. Os filhos vão direto
// dentro do <table> (use TableShell/Th/Tr/Td).
// ---------------------------------------------------------------------------
export function TableCard({
  eyebrow,
  title,
  action,
  children,
}: {
  eyebrow?: string
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      {(eyebrow || title || action) && (
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}
        >
          <div>
            {eyebrow && <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-500">{eyebrow}</p>}
            {title && <h2 className="text-sm font-bold text-white">{title}</h2>}
          </div>
          {action}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">{children}</table>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// StatusPill — bolinha colorida + texto, pra estados (ativo/pendente/inativo).
// Reusa as cores de Badge; a bolinha herda a cor do texto via currentColor.
// ---------------------------------------------------------------------------
export function StatusPill({ variant, children }: { variant: BadgeVariant; children: ReactNode }) {
  const style = badgeVariants[variant]
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold" style={style}>
      <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full" style={{ background: 'currentColor' }} />
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// AlertBanner — banner "o que fazer agora": fundo em gradiente translúcido,
// ícone em caixa gradiente, eyebrow, título, descrição, conteúdo extra
// (children, ex.: chips de progresso) e CTA à direita.
// ---------------------------------------------------------------------------
const alertTones = {
  info: {
    background: 'linear-gradient(135deg, rgba(6,182,212,0.12) 0%, rgba(67,97,238,0.08) 100%)',
    ring: 'rgba(6,182,212,0.25)',
    eyebrowColor: '#67e8f9',
    iconBackground: brandGradient,
    iconShadow: '0 4px 14px rgba(6,182,212,0.35)',
  },
  warning: {
    background: 'linear-gradient(135deg, rgba(245,158,11,0.12) 0%, rgba(239,68,68,0.06) 100%)',
    ring: 'rgba(245,158,11,0.25)',
    eyebrowColor: '#fcd34d',
    iconBackground: 'linear-gradient(135deg, #f59e0b, #ef4444)',
    iconShadow: '0 4px 14px rgba(245,158,11,0.35)',
  },
} as const

export type AlertTone = keyof typeof alertTones

export function AlertBanner({
  icon,
  eyebrow,
  title,
  description,
  action,
  children,
  tone = 'info',
}: {
  icon?: ReactNode
  eyebrow?: string
  title: string
  description?: string
  action?: ReactNode
  children?: ReactNode
  tone?: AlertTone
}) {
  const t = alertTones[tone]
  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{ background: t.background, boxShadow: `0 1px 3px rgba(0,0,0,0.3), 0 0 0 1px ${t.ring}` }}
    >
      <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          {icon && (
            <div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl"
              style={{ background: t.iconBackground, boxShadow: t.iconShadow }}
            >
              {icon}
            </div>
          )}
          <div>
            {eyebrow && (
              <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: t.eyebrowColor }}>
                {eyebrow}
              </p>
            )}
            <h2 className="mt-0.5 text-lg font-black text-white">{title}</h2>
            {description && <p className="mt-0.5 text-sm text-slate-300">{description}</p>}
            {children && <div className="mt-3">{children}</div>}
          </div>
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
    </div>
  )
}
