import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import { Check, Zap, Bot, BarChart3, Globe, MessageSquare, Shield } from 'lucide-react'

type Plan = {
  id: string
  name: string
  slug: string
  description: string | null
  price_monthly: number
  max_units: number
  max_agents: number
  max_leads_per_month: number
  features: string[]
  is_featured: boolean
  sort_order: number
}

const DEFAULT_FEATURES: Record<string, string[]> = {
  basico: [
    'Até 1 unidade',
    '1 agente de IA',
    '500 leads/mês',
    'Conexão WhatsApp',
    'Dashboard básico',
    'Suporte por e-mail',
  ],
  pro: [
    'Até 5 unidades',
    '3 agentes de IA',
    '2.000 leads/mês',
    'Conexão WhatsApp multi-unidade',
    'Dashboard completo + financeiro',
    'Resultados e pipeline',
    'Suporte prioritário',
  ],
  enterprise: [
    'Unidades ilimitadas',
    'Agentes ilimitados',
    'Leads ilimitados',
    'Toda a plataforma',
    'API dedicada',
    'SLA garantido',
    'Gerente de conta',
  ],
}

export default async function HomePage() {
  let plans: Plan[] = []
  try {
    const supabase = createServiceClient()
    if (supabase) {
      const { data } = await supabase
        .from('plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order')
      plans = (data ?? []) as Plan[]
    }
  } catch {
    // graceful — show page even if DB unreachable
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Nav */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500">
              <Bot size={16} className="text-white" />
            </div>
            <span className="font-semibold">AI Workforce OS</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="#planos" className="text-sm text-zinc-400 hover:text-white transition-colors">Planos</a>
            <a href="#recursos" className="text-sm text-zinc-400 hover:text-white transition-colors">Recursos</a>
            <Link
              href="/login"
              className="rounded-lg border border-white/10 px-4 py-1.5 text-sm font-medium text-white hover:bg-white/5 transition-colors"
            >
              Entrar
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden pb-24 pt-40">
        {/* Background glow */}
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center">
          <div className="h-[500px] w-[800px] rounded-full bg-green-500/10 blur-[120px]" />
        </div>

        <div className="relative mx-auto max-w-4xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-500/30 bg-green-500/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-medium text-green-400">Sistema ativo · Pronto para uso imediato</span>
          </div>

          <h1 className="text-5xl font-bold leading-tight tracking-tight md:text-6xl">
            A força de trabalho<br />
            <span className="bg-gradient-to-r from-green-400 to-emerald-300 bg-clip-text text-transparent">
              inteligente
            </span>{' '}
            que escala<br />
            com seu negócio
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400">
            Gerencie agentes de IA, redes de franquias, leads e resultados em uma única plataforma.
            Automatize o atendimento e acompanhe tudo em tempo real.
          </p>

          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <a
              href="#planos"
              className="rounded-xl bg-green-500 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-400"
            >
              Começar agora
            </a>
            <Link
              href="/login"
              className="rounded-xl border border-white/10 px-8 py-3.5 text-sm font-medium text-white transition-colors hover:bg-white/5"
            >
              Já tenho acesso →
            </Link>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-3 divide-x divide-white/10 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
            {[
              { value: '1.200+', label: 'Leads gerados' },
              { value: '340', label: 'Conversas/dia' },
              { value: '94%', label: 'Taxa de resposta' },
            ].map(({ value, label }) => (
              <div key={label} className="flex flex-col items-center py-6">
                <p className="text-2xl font-bold">{value}</p>
                <p className="mt-1 text-xs text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="recursos" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold">Tudo que sua rede precisa</h2>
            <p className="mt-3 text-zinc-400">Uma plataforma completa do atendimento ao fechamento</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              { icon: Bot, title: 'Agentes de IA', desc: 'Atendimento automático 24/7 via WhatsApp, qualificação de leads e respostas inteligentes por unidade.' },
              { icon: MessageSquare, title: 'WhatsApp por unidade', desc: 'Cada unidade conecta seu próprio número. Gerencie todas as conversas em um único painel.' },
              { icon: BarChart3, title: 'Dashboard em tempo real', desc: 'KPIs de leads, fechamentos, conversas e financeiro atualizados ao vivo em cada nível.' },
              { icon: Globe, title: 'Multi-unidade', desc: 'Cadastre quantas unidades precisar, cada uma trabalhando de forma independente e monitorada.' },
              { icon: Zap, title: 'Financeiro automático', desc: 'Cobranças geradas automaticamente no cadastro. Acompanhe A Receber e custos do sistema.' },
              { icon: Shield, title: 'Segurança enterprise', desc: 'Infraestrutura Supabase + Vercel com backups automáticos e controle de acesso por perfil.' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="rounded-xl border border-white/10 bg-white/5 p-6 transition-colors hover:border-white/20">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-green-500/15">
                  <Icon size={18} className="text-green-400" />
                </div>
                <h3 className="text-sm font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans */}
      <section id="planos" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-bold">Escolha seu plano</h2>
            <p className="mt-3 text-zinc-400">Escale conforme seu negócio cresce. Cancele quando quiser.</p>
          </div>

          {plans.length === 0 ? (
            // Fallback static plans when DB is unavailable
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {[
                { name: 'Básico', slug: 'basico', price: null, desc: 'Para quem está começando', featured: false },
                { name: 'Pro', slug: 'pro', price: null, desc: 'Para redes em crescimento', featured: true },
                { name: 'Enterprise', slug: 'enterprise', price: null, desc: 'Para grandes operações', featured: false },
              ].map((p) => (
                <PlanCard key={p.slug} name={p.name} slug={p.slug} price={p.price} desc={p.desc} featured={p.featured} features={DEFAULT_FEATURES[p.slug] ?? []} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              {plans.map((plan) => {
                const features = Array.isArray(plan.features) && plan.features.length > 0
                  ? plan.features as string[]
                  : DEFAULT_FEATURES[plan.slug] ?? []
                return (
                  <PlanCard
                    key={plan.id}
                    name={plan.name}
                    slug={plan.slug}
                    price={plan.price_monthly > 0 ? plan.price_monthly : null}
                    desc={plan.description ?? ''}
                    featured={plan.is_featured}
                    features={features}
                  />
                )
              })}
            </div>
          )}

          <p className="mt-8 text-center text-sm text-zinc-600">
            Preços sob consulta · Fale com a equipe para negociação personalizada
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-bold">Pronto para automatizar sua rede?</h2>
          <p className="mt-4 text-zinc-400">Entre em contato e comece hoje mesmo.</p>
          <a
            href="mailto:viniciusmfp29@gmail.com?subject=AI Workforce OS - Interesse"
            className="mt-8 inline-flex items-center gap-2 rounded-xl bg-green-500 px-8 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-green-400"
          >
            Falar com a equipe
          </a>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-green-500">
              <Bot size={12} className="text-white" />
            </div>
            <span className="text-sm text-zinc-500">AI Workforce OS</span>
          </div>
          <p className="text-xs text-zinc-600">© 2026 AI Workforce OS. Todos os direitos reservados.</p>
          <Link href="/login" className="text-xs text-zinc-500 hover:text-white transition-colors">Acessar painel</Link>
        </div>
      </footer>
    </main>
  )
}

function PlanCard({
  name, slug, price, desc, featured, features,
}: {
  name: string; slug: string; price: number | null; desc: string; featured: boolean; features: string[]
}) {
  return (
    <div className={`relative flex flex-col rounded-2xl border p-8 transition-all ${
      featured
        ? 'border-green-500/50 bg-green-500/5 shadow-[0_0_60px_-15px_rgb(34,197,94,0.3)]'
        : 'border-white/10 bg-white/5'
    }`}>
      {featured && (
        <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-green-500 px-4 py-1 text-xs font-semibold text-white">
          Mais popular
        </div>
      )}
      <div>
        <h3 className="text-lg font-bold">{name}</h3>
        <p className="mt-1 text-sm text-zinc-400">{desc}</p>
      </div>
      <div className="my-6">
        {price != null && price > 0 ? (
          <div className="flex items-end gap-1">
            <span className="text-4xl font-bold">R$ {price.toLocaleString('pt-BR')}</span>
            <span className="mb-1 text-zinc-500">/mês</span>
          </div>
        ) : (
          <p className="text-2xl font-bold text-zinc-300">Sob consulta</p>
        )}
      </div>
      <ul className="flex flex-col gap-2.5">
        {features.map((f) => (
          <li key={f} className="flex items-center gap-2.5 text-sm text-zinc-300">
            <Check size={14} className="flex-shrink-0 text-green-400" />
            {f}
          </li>
        ))}
      </ul>
      <a
        href="mailto:viniciusmfp29@gmail.com?subject=AI Workforce OS - Plano ${name}"
        className={`mt-8 flex items-center justify-center rounded-xl py-3 text-sm font-semibold transition-colors ${
          featured
            ? 'bg-green-500 text-white hover:bg-green-400'
            : 'border border-white/10 text-white hover:bg-white/5'
        }`}
      >
        Começar com {name}
      </a>
    </div>
  )
}
