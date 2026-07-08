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
