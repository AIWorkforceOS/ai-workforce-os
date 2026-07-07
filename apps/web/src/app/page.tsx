import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/service'
import {
  Bot, Check, Zap, BarChart3, MessageSquare, Shield, ArrowRight,
  Star, TrendingUp, Clock, DollarSign, Users, ChevronDown, Play,
  Sparkles, Globe, Lock, HeadphonesIcon,
} from 'lucide-react'

type Plan = {
  id: string; name: string; slug: string; description: string | null
  price_monthly: number; max_units: number; max_agents: number
  max_leads_per_month: number; features: string[]; is_featured: boolean; sort_order: number
}

const PLANS_STATIC = [
  {
    name: 'Starter',
    slug: 'starter',
    price: 297,
    desc: 'Para empresas que estão começando a automatizar',
    featured: false,
    features: [
      'Até 1 unidade / localização',
      '1 funcionário IA ativo',
      '500 leads qualificados/mês',
      'Conexão WhatsApp Business',
      'Dashboard de métricas básico',
      'Suporte por e-mail (48h)',
      'Onboarding guiado',
    ],
  },
  {
    name: 'Pro',
    slug: 'pro',
    price: 597,
    desc: 'Para redes em crescimento que precisam de escala',
    featured: true,
    features: [
      'Até 5 unidades / localizações',
      '3 funcionários IA simultâneos',
      '2.000 leads qualificados/mês',
      'WhatsApp multi-unidade integrado',
      'Dashboard completo + financeiro',
      'Relatórios de conversão e pipeline',
      'Suporte prioritário (12h)',
      'Configuração feita pela nossa equipe',
    ],
  },
  {
    name: 'Enterprise',
    slug: 'enterprise',
    price: 1497,
    desc: 'Para grandes redes com operação em múltiplos estados',
    featured: false,
    features: [
      'Unidades ilimitadas',
      'Funcionários IA ilimitados',
      'Leads ilimitados',
      'API dedicada + integrações customizadas',
      'SLA 99.9% garantido em contrato',
      'Gerente de conta exclusivo',
      'Treinamento da equipe incluso',
      'Relatórios personalizados',
    ],
  },
]

export default async function HomePage() {
  let plans: Plan[] = []
  try {
    const supabase = createServiceClient()
    if (supabase) {
      const { data } = await supabase.from('plans').select('*').eq('is_active', true).order('sort_order')
      plans = (data ?? []) as Plan[]
    }
  } catch {
    // graceful fallback to static
  }

  const displayPlans = plans.length > 0
    ? plans.map(p => ({
        name: p.name,
        slug: p.slug,
        price: p.price_monthly > 0 ? p.price_monthly : null,
        desc: p.description ?? '',
        featured: p.is_featured,
        features: Array.isArray(p.features) && p.features.length > 0
          ? p.features as string[]
          : PLANS_STATIC.find(s => s.slug === p.slug)?.features ?? [],
      }))
    : PLANS_STATIC.map(p => ({ ...p, price: p.price as number | null }))

  return (
    <main className="min-h-screen overflow-x-hidden" style={{ background: '#06090f', color: '#fff' }}>

      {/* ─── NAV ─── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06]"
        style={{ background: 'rgba(6,9,15,0.85)', backdropFilter: 'blur(16px)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 0 14px rgba(34,197,94,0.35)' }}>
              <Bot size={15} className="text-white" />
            </div>
            <span className="font-black tracking-tight text-white">AI Workforce <span style={{ color: '#22c55e' }}>OS</span></span>
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#como-funciona" className="text-sm text-zinc-400 transition-colors hover:text-white">Como funciona</a>
            <a href="#planos" className="text-sm text-zinc-400 transition-colors hover:text-white">Planos</a>
            <a href="#faq" className="text-sm text-zinc-400 transition-colors hover:text-white">FAQ</a>
            <Link href="/login" className="text-sm text-zinc-400 transition-colors hover:text-white">Entrar</Link>
          </div>
          <Link
            href="#planos"
            className="rounded-xl px-4 py-2 text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 4px 14px rgba(34,197,94,0.3)' }}
          >
            Começar agora
          </Link>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden pb-20 pt-36">
        {/* bg glows */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full opacity-20"
            style={{ background: 'radial-gradient(ellipse, #22c55e 0%, transparent 70%)', filter: 'blur(80px)' }} />
          <div className="absolute -left-40 top-40 h-72 w-72 rounded-full opacity-10"
            style={{ background: 'radial-gradient(ellipse, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 text-center">
          {/* Eyebrow */}
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-green-500/30 px-4 py-1.5"
            style={{ background: 'rgba(34,197,94,0.08)' }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-400" />
            </span>
            <span className="text-xs font-bold text-green-400">Sistema ao vivo · Mais de 1.200 conversas automatizadas hoje</span>
          </div>

          {/* Main headline — DOR → SOLUÇÃO */}
          <h1 className="text-4xl font-black leading-[1.1] tracking-tight md:text-6xl lg:text-7xl">
            Você está perdendo<br />
            <span style={{ background: 'linear-gradient(135deg, #f87171, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              clientes e dinheiro
            </span>
            {' '}todo dia<br />
            enquanto sua equipe<br />
            <span style={{ background: 'linear-gradient(135deg, #4ade80, #22c55e)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              faz tarefas manuais.
            </span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-zinc-400">
            O <strong className="text-white">AI Workforce OS</strong> coloca funcionários de IA trabalhando 24h/7 por você —
            atendendo, qualificando leads e fechando vendas enquanto você dorme.
            <strong className="text-green-400"> Sem contratar. Sem folha de pagamento. Sem limite de escala.</strong>
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="#planos"
              className="flex items-center gap-2 rounded-2xl px-8 py-4 text-base font-black text-white transition-all hover:scale-105 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 30px rgba(34,197,94,0.4)' }}
            >
              Quero meu funcionário IA agora
              <ArrowRight size={16} />
            </a>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white/5"
            >
              <Play size={14} />
              Ver demonstração
            </Link>
          </div>

          {/* Social proof bar */}
          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            {[
              { value: '1.200+', label: 'Leads gerados este mês', sub: '↑ 340% vs. equipe humana' },
              { value: 'R$0', label: 'Custo por lead qualificado', sub: 'vs. R$15–80 no mercado' },
              { value: '24/7', label: 'Disponibilidade garantida', sub: 'Sem feriados, sem férias' },
            ].map(({ value, label, sub }) => (
              <div key={label} className="flex flex-col items-center px-4 py-6">
                <p className="text-3xl font-black text-white">{value}</p>
                <p className="mt-1 text-xs font-semibold text-zinc-300">{label}</p>
                <p className="mt-0.5 text-[10px] text-green-400">{sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── DOR / AGITAÇÃO ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="rounded-3xl border border-red-500/20 p-8 md:p-12"
            style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.06) 0%, rgba(6,9,15,0) 60%)' }}>
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-400">A realidade que ninguém fala</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              Enquanto você lê isso, seus concorrentes<br />
              <span className="text-red-400">já estão automatizando.</span>
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {[
                {
                  icon: Clock,
                  title: '73% dos leads são perdidos',
                  desc: 'Porque a resposta demora mais de 5 minutos. O cliente foi ver a concorrência.',
                },
                {
                  icon: DollarSign,
                  title: 'R$8.400/mês em salários',
                  desc: 'Para fazer o que um funcionário IA faz por R$297/mês, 24 horas por dia.',
                },
                {
                  icon: Users,
                  title: 'Sua equipe está esgotada',
                  desc: 'Respondendo as mesmas perguntas básicas no WhatsApp em vez de fechar vendas.',
                },
              ].map(({ icon: Icon, title, desc }) => (
                <div key={title} className="rounded-2xl border border-red-500/15 p-5"
                  style={{ background: 'rgba(239,68,68,0.05)' }}>
                  <Icon size={20} className="text-red-400" />
                  <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                </div>
              ))}
            </div>
            <p className="mt-8 text-lg font-bold text-white">
              A pergunta não é <em className="text-zinc-400">se</em> você vai automatizar.
              É <span className="text-green-400">quando</span> — e se vai ser antes ou depois da concorrência.
            </p>
          </div>
        </div>
      </section>

      {/* ─── COMO FUNCIONA ─── */}
      <section id="como-funciona" className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Simples assim</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              Em menos de 10 minutos seu funcionário<br />
              <span style={{ color: '#22c55e' }}>IA já está trabalhando por você</span>
            </h2>
          </div>

          <div className="relative grid grid-cols-1 gap-6 md:grid-cols-4">
            {[
              {
                step: '01',
                title: 'Escolha seu plano',
                desc: 'Selecione o plano ideal para o tamanho da sua operação e faça o pagamento com cartão, PIX ou boleto.',
                color: '#3b82f6',
              },
              {
                step: '02',
                title: 'Crie sua conta',
                desc: 'Acesso imediato. Login e senha entram no seu e-mail automaticamente em segundos.',
                color: '#8b5cf6',
              },
              {
                step: '03',
                title: 'Configure o funcionário',
                desc: 'Nosso wizard guiado configura tudo: nome do agente, script de vendas, tom de voz e WhatsApp.',
                color: '#22c55e',
              },
              {
                step: '04',
                title: 'Ele começa a vender',
                desc: 'Seu funcionário IA já está ativo — atendendo, qualificando e convertendo 24/7 sem sua intervenção.',
                color: '#f59e0b',
              },
            ].map(({ step, title, desc, color }, i) => (
              <div key={step} className="relative">
                {i < 3 && (
                  <div className="absolute right-0 top-8 hidden h-px w-full translate-x-1/2 border-t border-dashed border-white/10 md:block" />
                )}
                <div className="relative rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-4xl font-black" style={{ color, opacity: 0.4 }}>{step}</div>
                  <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── BENEFÍCIOS ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">O que você recebe</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              Uma força de trabalho completa<br />que nunca cansa, nunca falta, nunca pede aumento
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: MessageSquare,
                title: 'Atendimento 24/7 no WhatsApp',
                desc: 'Responde em segundos. Qualifica o lead. Agenda. Tira dúvidas. Tudo automaticamente enquanto você descansa.',
                badge: 'Mais vendido',
                color: '#22c55e',
              },
              {
                icon: TrendingUp,
                title: 'Qualificação inteligente de leads',
                desc: 'O funcionário IA identifica quem tem potencial de compra e prioriza — para você focar apenas no que importa.',
                badge: null,
                color: '#3b82f6',
              },
              {
                icon: BarChart3,
                title: 'Dashboard de resultados ao vivo',
                desc: 'Veja em tempo real quantos leads, conversas, vendas e receita cada unidade está gerando agora.',
                badge: null,
                color: '#8b5cf6',
              },
              {
                icon: Globe,
                title: 'Gestão multi-unidade',
                desc: 'Uma franquia, 50 lojas ou 200 unidades — o sistema gerencia todas de um único painel centralizado.',
                badge: null,
                color: '#f59e0b',
              },
              {
                icon: Zap,
                title: 'Cobrança automatizada',
                desc: 'Gera cobranças, acompanha pagamentos e emite relatórios financeiros sem você precisar fazer nada.',
                badge: null,
                color: '#ec4899',
              },
              {
                icon: Shield,
                title: 'Segurança de nível enterprise',
                desc: 'Dados criptografados, backups automáticos e controle de acesso por perfil. Conformidade total com LGPD.',
                badge: null,
                color: '#06b6d4',
              },
            ].map(({ icon: Icon, title, desc, badge, color }) => (
              <div key={title} className="group relative overflow-hidden rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20 hover:-translate-y-0.5"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                {badge && (
                  <span className="absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                    style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
                    {badge}
                  </span>
                )}
                <div className="flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ background: `${color}18`, boxShadow: `0 4px 12px ${color}20` }}>
                  <Icon size={18} style={{ color }} />
                </div>
                <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── ROI SECTION ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="overflow-hidden rounded-3xl border border-green-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.08) 0%, rgba(6,9,15,0.5) 100%)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2">
              {/* Left */}
              <div className="border-b border-white/10 p-10 md:border-b-0 md:border-r">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Sem o AI Workforce OS</p>
                <h3 className="mt-3 text-2xl font-black text-red-400">Você gasta R$8.400/mês</h3>
                <ul className="mt-6 space-y-3">
                  {[
                    '1 atendente R$2.200/mês (CLT + encargos R$3.800)',
                    'Disponível apenas 8h/dia, 5 dias/semana',
                    'Férias, faltas, licenças médicas',
                    'Treinar de novo quando sai',
                    'Resposta em 30–60 minutos',
                    '73% dos leads perdidos fora do horário',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-400">
                      <span className="mt-0.5 text-red-400">✗</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              {/* Right */}
              <div className="p-10">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Com o AI Workforce OS</p>
                <h3 className="mt-3 text-2xl font-black text-green-400">Você investe R$297/mês</h3>
                <ul className="mt-6 space-y-3">
                  {[
                    'Funcionário IA ativo 24h por dia, 7 dias por semana',
                    'Nunca falta, nunca tira férias, nunca pede aumento',
                    'Responde em menos de 3 segundos',
                    '100% dos leads atendidos, a qualquer hora',
                    'Escala instantaneamente com sua demanda',
                    'ROI positivo no 1º mês garantido ou reembolso',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-300">
                      <Check size={14} className="mt-0.5 flex-shrink-0 text-green-400" />
                      {item}
                    </li>
                  ))}
                </ul>
                <a href="#planos" className="mt-8 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white transition-all hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 6px 20px rgba(34,197,94,0.3)' }}>
                  Quero economizar agora
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── DEPOIMENTOS ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Resultados reais</p>
            <h2 className="mt-3 text-3xl font-black">O que nossos clientes estão falando</h2>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {[
              {
                name: 'Ricardo M.',
                role: 'Franqueado — Rede de Estéticas (SP)',
                text: 'Em 3 semanas meu funcionário IA já tinha qualificado mais de 200 leads. Antes eu perdia 70% deles por não ter resposta rápida. Agora responde em 3 segundos, 24h por dia.',
                result: '+340% leads convertidos',
              },
              {
                name: 'Amanda S.',
                role: 'CEO — Rede de Cursos Online (RJ)',
                text: 'Reduzi minha equipe de atendimento de 4 para 1 pessoa. O AI Workforce cuida de tudo — qualificação, agendamento, follow-up. Meu custo caiu 60% e as vendas subiram.',
                result: '−60% custo operacional',
              },
              {
                name: 'Carlos R.',
                role: 'Diretor — Franquia de Serviços (MG)',
                text: 'O ROI foi imediato. Só no primeiro mês o sistema gerou R$18.000 em vendas que eu teria perdido fora do horário comercial. Vale cada centavo.',
                result: 'R$18k em vendas no 1º mês',
              },
            ].map(({ name, role, text, result }) => (
              <div key={name} className="rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <div className="flex gap-0.5">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} size={12} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="mt-4 text-sm leading-relaxed text-zinc-300">"{text}"</p>
                <div className="mt-5 border-t border-white/10 pt-4">
                  <p className="text-sm font-black text-white">{name}</p>
                  <p className="text-xs text-zinc-500">{role}</p>
                  <span className="mt-2 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-black"
                    style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>
                    {result}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PLANOS / PRICING ─── */}
      <section id="planos" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Investimento</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              Escolha o plano para sua operação
            </h2>
            <p className="mt-4 text-zinc-400">7 dias de garantia. Cancele quando quiser. Sem fidelidade.</p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {displayPlans.map(plan => (
              <PlanCard key={plan.slug} {...plan} />
            ))}
          </div>

          {/* Trust signals */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-8">
            {[
              { icon: Lock, text: 'Pagamento 100% seguro' },
              { icon: Zap, text: 'Acesso imediato após pagamento' },
              { icon: HeadphonesIcon, text: 'Suporte em português' },
              { icon: Sparkles, text: 'Configuração feita por nós' },
            ].map(({ icon: Icon, text }) => (
              <div key={text} className="flex items-center gap-2">
                <Icon size={14} className="text-green-400" />
                <span className="text-xs text-zinc-400">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Perguntas frequentes</p>
            <h2 className="mt-3 text-3xl font-black">Tudo que você precisa saber</h2>
          </div>

          <div className="space-y-3">
            {[
              {
                q: 'Preciso de conhecimento técnico para configurar?',
                a: 'Não. Nosso wizard de onboarding guia você passo a passo. Em menos de 10 minutos seu funcionário IA está ativo. Se precisar de ajuda, nossa equipe faz a configuração completa por você.',
              },
              {
                q: 'Como funciona o pagamento? Aceitam PIX e boleto?',
                a: 'Sim. Aceitamos cartão de crédito (até 12x), PIX com desconto e boleto bancário. Para clientes nos EUA, aceitamos Zelle e cartão internacional via Stripe.',
              },
              {
                q: 'O funcionário IA responde igual a um humano?',
                a: 'Sim. Ele é treinado com o tom de voz da sua empresa, conhece seus produtos e serviços, e responde de forma natural. Os clientes raramente percebem que é IA — e quando percebem, adoram a velocidade.',
              },
              {
                q: 'E se eu precisar de mais unidades depois?',
                a: 'É só fazer upgrade do plano. A transição é instantânea e você paga apenas a diferença proporcional dos dias restantes.',
              },
              {
                q: 'Posso cancelar quando quiser?',
                a: 'Sim. Sem fidelidade, sem multa. Se não estiver satisfeito nos primeiros 7 dias, devolvemos 100% do valor pago.',
              },
              {
                q: 'Meus dados ficam seguros?',
                a: 'Total segurança. Infraestrutura Supabase + Vercel com criptografia end-to-end, backups automáticos e total conformidade com LGPD.',
              },
            ].map(({ q, a }) => (
              <details key={q} className="group cursor-pointer rounded-2xl border border-white/10 p-5 transition-all hover:border-white/20"
                style={{ background: 'rgba(255,255,255,0.03)' }}>
                <summary className="flex items-center justify-between gap-4 text-sm font-black text-white marker:hidden list-none">
                  {q}
                  <ChevronDown size={16} className="flex-shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-4 text-sm leading-relaxed text-zinc-400">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <div className="overflow-hidden rounded-3xl text-center"
            style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.15) 0%, rgba(6,9,15,1) 100%)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <div className="relative p-12 md:p-16">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
                  style={{ background: 'radial-gradient(ellipse, #22c55e 0%, transparent 70%)', filter: 'blur(80px)' }} />
              </div>
              <div className="relative">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-green-400">Última chance</p>
                <h2 className="mt-3 text-4xl font-black md:text-5xl">
                  Cada dia sem IA é<br />
                  <span className="text-red-400">dinheiro jogado fora.</span>
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">
                  Seus concorrentes já estão automatizando. A diferença entre quem vai liderar o mercado
                  nos próximos 5 anos e quem vai ficar para trás é uma decisão que você toma hoje.
                </p>
                <a
                  href="#planos"
                  className="mt-10 inline-flex items-center gap-2 rounded-2xl px-10 py-4 text-base font-black text-white transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)', boxShadow: '0 8px 40px rgba(34,197,94,0.4)' }}
                >
                  Quero começar agora — 7 dias de garantia
                  <ArrowRight size={16} />
                </a>
                <p className="mt-4 text-xs text-zinc-500">
                  ✓ Sem fidelidade &nbsp;·&nbsp; ✓ Cancele quando quiser &nbsp;·&nbsp; ✓ Acesso imediato
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg"
                style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}>
                <Bot size={13} className="text-white" />
              </div>
              <span className="font-black text-white text-sm">AI Workforce <span style={{ color: '#22c55e' }}>OS</span></span>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-500">
              <a href="#como-funciona" className="hover:text-white transition-colors">Como funciona</a>
              <a href="#planos" className="hover:text-white transition-colors">Planos</a>
              <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
              <Link href="/login" className="hover:text-white transition-colors">Entrar</Link>
            </div>
            <p className="text-xs text-zinc-600">© 2026 AI Workforce OS · Todos os direitos reservados</p>
          </div>
        </div>
      </footer>

      {/* ─── FLOATING AI CHAT ─── */}
      <SalesChatWidget />
    </main>
  )
}

function PlanCard({
  name, slug, price, desc, featured, features,
}: {
  name: string; slug: string; price: number | null; desc: string; featured: boolean; features: string[]
}) {
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-3xl transition-all hover:-translate-y-1 ${
      featured ? '' : 'border border-white/10'
    }`}
      style={featured ? {
        border: '1px solid rgba(34,197,94,0.4)',
        background: 'linear-gradient(160deg, rgba(34,197,94,0.1) 0%, rgba(6,9,15,0.9) 100%)',
        boxShadow: '0 0 60px rgba(34,197,94,0.15)',
      } : { background: 'rgba(255,255,255,0.03)' }}>

      {featured && (
        <div className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, #22c55e, #4ade80)' }} />
      )}

      {featured && (
        <div className="absolute right-5 top-5 rounded-full px-3 py-1 text-[10px] font-black"
          style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}>
          ⚡ Mais popular
        </div>
      )}

      <div className="flex flex-col gap-5 p-8">
        <div>
          <h3 className="text-lg font-black text-white">{name}</h3>
          <p className="mt-1 text-xs text-zinc-500">{desc}</p>
        </div>

        <div>
          {price != null ? (
            <div className="flex items-end gap-1">
              <span className="text-xs text-zinc-500">R$</span>
              <span className="text-5xl font-black text-white">{price.toLocaleString('pt-BR')}</span>
              <span className="mb-1.5 text-sm text-zinc-500">/mês</span>
            </div>
          ) : (
            <p className="text-2xl font-black text-zinc-300">Sob consulta</p>
          )}
        </div>

        <Link
          href={`/checkout?plan=${slug}`}
          className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white transition-all hover:scale-[1.02] active:scale-95 ${
            featured ? '' : 'border border-white/15 hover:border-white/30 hover:bg-white/5'
          }`}
          style={featured ? {
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            boxShadow: '0 6px 20px rgba(34,197,94,0.3)',
          } : {}}
        >
          Começar com {name}
          <ArrowRight size={14} />
        </Link>

        <ul className="space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-300">
              <Check size={13} className="mt-0.5 flex-shrink-0 text-green-400" />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SalesChatWidget() {
  return (
    <>
      {/* Floating chat button — rendered client-side via CSS trick */}
      <div
        id="ai-chat-container"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: '12px',
        }}
      >
        {/* Chat bubble teaser */}
        <div
          id="chat-bubble"
          style={{
            background: 'rgba(6,9,15,0.95)',
            border: '1px solid rgba(34,197,94,0.3)',
            borderRadius: '16px',
            padding: '12px 16px',
            maxWidth: '240px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'slideUp 0.4s ease-out',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#d1fae5', fontWeight: 700 }}>
            Olá! Sou o <span style={{ color: '#22c55e' }}>Kai</span>, seu consultor IA 👋
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#71717a' }}>
            Tire suas dúvidas antes de assinar!
          </p>
        </div>

        {/* Chat toggle button */}
        <button
          id="chat-toggle"
          style={{
            width: '56px',
            height: '56px',
            borderRadius: '50%',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #22c55e, #16a34a)',
            boxShadow: '0 8px 24px rgba(34,197,94,0.4)',
            transition: 'transform 0.2s',
          }}
          aria-label="Falar com consultor IA"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        </button>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        #chat-toggle:hover { transform: scale(1.08); }
      ` }} />

      {/* Chat opens /chat page in modal — handled by ChatModal component */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          const btn = document.getElementById('chat-toggle');
          const bubble = document.getElementById('chat-bubble');
          let open = false;
          let iframe;

          // Hide bubble after 8s
          setTimeout(() => { if (bubble) bubble.style.opacity = '0'; }, 8000);

          btn && btn.addEventListener('click', function() {
            open = !open;
            bubble && (bubble.style.display = 'none');
            if (open) {
              if (!iframe) {
                iframe = document.createElement('iframe');
                iframe.src = '/chat';
                iframe.style.cssText = 'position:fixed;bottom:96px;right:24px;width:380px;height:560px;border:none;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.5);z-index:9998;background:#06090f;';
                document.body.appendChild(iframe);
              }
              iframe.style.display = 'block';
            } else if (iframe) {
              iframe.style.display = 'none';
            }
          });
        })();
      `}} />
    </>
  )
}
