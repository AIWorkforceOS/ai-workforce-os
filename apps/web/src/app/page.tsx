import Link from 'next/link'
import { getLocale } from '@/lib/i18n/server'
import { planPrice, type Locale } from '@/lib/i18n/config'
import {
  Bot, Check, Zap, BarChart3, MessageSquare, Shield, ArrowRight,
  TrendingUp, Clock, DollarSign, Users, ChevronDown, Play,
  Sparkles, Globe, Lock, HeadphonesIcon, Briefcase, Megaphone, Wallet, MapPin,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Todo o copy da landing vive aqui, em pt e en. A localidade vem do
 * middleware (geolocalização por IP — EUA abre em inglês/dólar).
 *
 * Números e features descrevem apenas o que o produto entrega hoje:
 * atendimento/qualificação no WhatsApp, prospecção via Google Maps,
 * follow-up automático, funil de vendas e os 3 funcionários digitais
 * existentes (SDR, RH, Tráfego). Sem cotas inventadas.
 */
const COPY = {
  pt: {
    nav: { how: 'Como funciona', employees: 'Funcionários', plans: 'Planos', faq: 'FAQ', login: 'Entrar', cta: 'Começar agora' },
    hero: {
      badge: 'Funcionários digitais de IA — atendendo em segundos, 24/7',
      titleA: 'Você está perdendo',
      titleRed: 'clientes e dinheiro',
      titleB: 'todo dia',
      titleC: 'enquanto sua equipe',
      titleCyan: 'faz tarefas manuais.',
      sub1: 'A ',
      sub2: ' coloca funcionários digitais de IA trabalhando 24h/7 por você — atendendo, qualificando leads e fechando vendas enquanto você dorme.',
      sub3: ' Sem contratar. Sem folha de pagamento. Sem limite de escala.',
      ctaMain: 'Quero meu funcionário IA agora',
      ctaDemo: 'Ver demonstração',
      proof: [
        { value: '3', label: 'Funcionários digitais prontos', sub: 'AI Sales Representative, RH e Tráfego Pago' },
        { value: '24/7', label: 'Disponibilidade garantida', sub: 'Sem feriados, sem férias' },
        { value: '10 min', label: 'Para configurar e ativar', sub: 'Wizard guiado, sem código' },
      ],
    },
    pain: {
      eyebrow: 'A realidade que ninguém fala',
      titleA: 'Enquanto você lê isso, seus concorrentes',
      titleB: 'já estão automatizando.',
      cards: [
        { title: 'Leads esfriam em minutos', desc: 'Quando a resposta demora, o cliente já foi ver a concorrência. Seu funcionário IA responde em segundos.' },
        { title: 'Milhares de reais em salários', desc: 'Para fazer tarefas repetitivas que um funcionário IA faz por R$497/mês, 24 horas por dia.' },
        { title: 'Sua equipe está esgotada', desc: 'Respondendo as mesmas perguntas básicas no WhatsApp em vez de fechar vendas.' },
      ],
      closerA: 'A pergunta não é ',
      closerIf: 'se',
      closerB: ' você vai automatizar. É ',
      closerWhen: 'quando',
      closerC: ' — e se vai ser antes ou depois da concorrência.',
    },
    how: {
      eyebrow: 'Simples assim',
      titleA: 'Em menos de 10 minutos seu funcionário',
      titleB: 'IA já está trabalhando por você',
      steps: [
        { title: 'Escolha seu plano', desc: 'Selecione o plano ideal para o tamanho da sua operação e pague com PIX, boleto ou cartão à vista.' },
        { title: 'Crie sua conta', desc: 'Acesso imediato. Você define sua senha e entra direto na plataforma, sem esperar e-mail.' },
        { title: 'Configure o funcionário', desc: 'Nosso wizard guiado configura tudo: nome do agente, script de vendas, tom de voz e WhatsApp.' },
        { title: 'Ele começa a trabalhar', desc: 'Seu funcionário IA já está ativo — atendendo, qualificando e fazendo follow-up 24/7.' },
      ],
    },
    team: {
      eyebrow: 'Conheça o time',
      titleA: 'Cinco funcionários digitais.',
      titleB: 'Contrate os que sua operação precisa.',
      ready: 'Disponível',
      soon: 'Em breve',
      members: [
        { key: 'sdr', name: 'AI Sales Representative', ready: true, desc: 'Atende no WhatsApp em segundos, qualifica leads, faz follow-up automático e prospecta empresas no Google Maps.' },
        { key: 'rh', name: 'Recrutador (RH)', ready: true, desc: 'Cria a vaga com IA, tria currículos, pontua candidatos na régua certa e entrega uma shortlist pronta para entrevista.' },
        { key: 'traffic', name: 'Gestor de Tráfego Pago', ready: true, desc: 'Acompanha Meta Ads e Google Ads, detecta desperdício e sugere otimizações — você aprova, ele executa.' },
        { key: 'finance', name: 'Financeiro', ready: false, desc: 'Cobranças, conciliação e relatórios financeiros automáticos.' },
        { key: 'reception', name: 'Recepcionista Geral', ready: false, desc: 'Triagem de qualquer atendimento: dúvidas, agendamentos e direcionamento.' },
      ],
    },
    benefits: {
      eyebrow: 'O que você recebe',
      titleA: 'Uma força de trabalho completa',
      titleB: 'que nunca cansa, nunca falta, nunca pede aumento',
      cards: [
        { title: 'Atendimento 24/7 no WhatsApp', desc: 'Responde em segundos. Qualifica o lead. Faz follow-up. Tira dúvidas. Tudo automaticamente enquanto você descansa.', badge: 'Mais vendido' },
        { title: 'Qualificação inteligente de leads', desc: 'O funcionário IA identifica quem tem potencial de compra e prioriza — para você focar apenas no que importa.', badge: null },
        { title: 'Dashboard de resultados ao vivo', desc: 'Veja em tempo real os leads, conversas e o funil de vendas de cada unidade.', badge: null },
        { title: 'Gestão multi-unidade', desc: 'Da operação com uma unidade à rede com várias — tudo gerenciado de um único painel centralizado.', badge: null },
        { title: 'Prospecção automática', desc: 'Encontra empresas do seu setor no Google Maps, com telefone, e coloca direto no seu funil.', badge: null },
        { title: 'Segurança de nível enterprise', desc: 'Dados criptografados, backups automáticos e controle de acesso por perfil. Conformidade com a LGPD.', badge: null },
      ],
    },
    roi: {
      withoutEyebrow: 'Sem a Alizo',
      withoutTitle: 'Você paga salário, encargos e horário comercial',
      withoutItems: [
        'Atendente CLT custa alguns milhares de reais por mês',
        'Disponível apenas 8h/dia, 5 dias/semana',
        'Férias, faltas, licenças médicas',
        'Treinar de novo quando sai',
        'Leads fora do horário ficam sem resposta',
      ],
      withEyebrow: 'Com a Alizo',
      withTitle: 'Você investe a partir de R$497/mês',
      withItems: [
        'Funcionário IA ativo 24h por dia, 7 dias por semana',
        'Nunca falta, nunca tira férias, nunca pede aumento',
        'Responde em segundos, a qualquer hora',
        'Follow-up automático para o lead não esfriar',
        'Escala instantaneamente com sua demanda',
        '7 dias de garantia total',
      ],
      cta: 'Quero economizar agora',
    },
    plans: {
      eyebrow: 'Investimento',
      title: 'Escolha o plano para sua operação',
      sub: '7 dias de garantia. Cancele quando quiser. Sem fidelidade.',
      perMonth: '/mês',
      onRequest: 'Sob consulta',
      ctaStart: 'Começar com',
      ctaTalk: 'Fale com a gente',
      featured: '⚡ Mais popular',
      items: [
        {
          slug: 'starter', name: 'Starter', featured: false,
          desc: 'Para empresas que estão começando a automatizar',
          features: ['1 unidade / localização', '1 funcionário digital ativo', 'Atendimento e qualificação no WhatsApp 24/7', 'Prospecção de empresas via Google Maps', 'Follow-up automático de leads', 'Dashboard de resultados em tempo real', 'Suporte por e-mail'],
        },
        {
          slug: 'pro', name: 'Pro', featured: true,
          desc: 'Para operações em crescimento que precisam de escala',
          features: ['Até 5 unidades / localizações', 'Até 3 funcionários digitais (AI Sales Representative, RH e Tráfego)', 'WhatsApp multi-unidade integrado', 'Prospecção de empresas via Google Maps', 'Funil de vendas (CRM) completo', 'Suporte prioritário', 'Configuração assistida pela nossa equipe'],
        },
        {
          slug: 'enterprise', name: 'Enterprise', featured: false,
          desc: 'Para grandes redes — escopo e preço sob consulta',
          features: ['Unidades ilimitadas', 'Todos os funcionários digitais', 'Onboarding e configuração dedicados', 'Suporte dedicado', 'Condições comerciais personalizadas'],
        },
      ],
      trust: ['Pagamento 100% seguro', 'Acesso imediato após o cadastro', 'Suporte em português', 'Configuração guiada'],
    },
    faq: {
      eyebrow: 'Perguntas frequentes',
      title: 'Tudo que você precisa saber',
      items: [
        { q: 'Preciso de conhecimento técnico para configurar?', a: 'Não. Nosso wizard de onboarding guia você passo a passo. Em menos de 10 minutos seu funcionário IA está ativo. Se precisar de ajuda, nossa equipe faz a configuração completa por você.' },
        { q: 'Como funciona o pagamento? Aceitam PIX e boleto?', a: 'Sim. No Brasil aceitamos PIX, boleto bancário e cartão de débito ou crédito à vista (sem parcelamento no momento). Nos EUA, aceitamos Zelle e cartão de débito ou crédito.' },
        { q: 'O funcionário IA responde igual a um humano?', a: 'Sim. Ele é treinado com o tom de voz da sua empresa, conhece seus produtos e serviços, e responde de forma natural. Os clientes raramente percebem que é IA — e quando percebem, adoram a velocidade.' },
        { q: 'E se eu precisar de mais unidades depois?', a: 'É só fazer upgrade do plano. Fale com a gente e a transição é feita sem interromper sua operação.' },
        { q: 'Posso cancelar quando quiser?', a: 'Sim. Sem fidelidade, sem multa. Se não estiver satisfeito nos primeiros 7 dias, devolvemos 100% do valor pago.' },
        { q: 'Meus dados ficam seguros?', a: 'Total segurança. Infraestrutura Supabase + Vercel com criptografia, backups automáticos e conformidade com a LGPD.' },
      ],
    },
    finalCta: {
      eyebrow: 'Não deixe para depois',
      titleA: 'Cada dia sem IA é',
      titleB: 'dinheiro jogado fora.',
      sub: 'Seus concorrentes já estão automatizando. A diferença entre quem vai liderar o mercado nos próximos 5 anos e quem vai ficar para trás é uma decisão que você toma hoje.',
      cta: 'Quero começar agora — 7 dias de garantia',
      trust: '✓ Sem fidelidade  ·  ✓ Cancele quando quiser  ·  ✓ Acesso imediato',
    },
    footer: { rights: 'Todos os direitos reservados' },
    chat: {
      teaserTitleA: 'Olá! Sou o ',
      teaserTitleB: ', seu consultor IA 👋',
      teaserSub: 'Tire suas dúvidas antes de assinar!',
      ariaLabel: 'Falar com consultor IA',
    },
  },
  en: {
    nav: { how: 'How it works', employees: 'Employees', plans: 'Pricing', faq: 'FAQ', login: 'Sign in', cta: 'Get started' },
    hero: {
      badge: 'AI digital employees — replying in seconds, 24/7',
      titleA: "You're losing",
      titleRed: 'customers and money',
      titleB: 'every day',
      titleC: 'while your team',
      titleCyan: 'does manual work.',
      sub1: '',
      sub2: ' puts AI digital employees to work for you 24/7 — answering, qualifying leads and closing sales while you sleep.',
      sub3: ' No hiring. No payroll. No scaling limits.',
      ctaMain: 'Get my AI employee now',
      ctaDemo: 'See a demo',
      proof: [
        { value: '3', label: 'Digital employees ready today', sub: 'AI Sales Representative, Recruiter and Paid Ads' },
        { value: '24/7', label: 'Guaranteed availability', sub: 'No holidays, no vacations' },
        { value: '10 min', label: 'To set up and go live', sub: 'Guided wizard, no code' },
      ],
    },
    pain: {
      eyebrow: 'The reality nobody talks about',
      titleA: 'While you read this, your competitors',
      titleB: 'are already automating.',
      cards: [
        { title: 'Leads go cold in minutes', desc: 'When replies take too long, the customer has already moved on. Your AI employee replies in seconds.' },
        { title: 'Thousands of dollars in payroll', desc: 'For repetitive tasks an AI employee handles for $97/month, 24 hours a day.' },
        { title: 'Your team is burned out', desc: 'Answering the same basic questions on WhatsApp instead of closing sales.' },
      ],
      closerA: "The question isn't ",
      closerIf: 'if',
      closerB: " you'll automate. It's ",
      closerWhen: 'when',
      closerC: ' — and whether it happens before or after your competition.',
    },
    how: {
      eyebrow: "It's this simple",
      titleA: 'In under 10 minutes your AI employee',
      titleB: 'is already working for you',
      steps: [
        { title: 'Pick your plan', desc: 'Choose the plan that fits your operation and pay with Zelle or a debit/credit card.' },
        { title: 'Create your account', desc: 'Instant access. You set your password and go straight into the platform — no waiting for emails.' },
        { title: 'Set up your employee', desc: 'Our guided wizard configures everything: agent name, sales script, tone of voice and WhatsApp.' },
        { title: 'It starts working', desc: 'Your AI employee is live — answering, qualifying and following up 24/7.' },
      ],
    },
    team: {
      eyebrow: 'Meet the team',
      titleA: 'Five digital employees.',
      titleB: 'Hire the ones your operation needs.',
      ready: 'Available',
      soon: 'Coming soon',
      members: [
        { key: 'sdr', name: 'AI Sales Representative', ready: true, desc: 'Answers on WhatsApp in seconds, qualifies leads, follows up automatically and prospects companies on Google Maps.' },
        { key: 'rh', name: 'Recruiter (HR)', ready: true, desc: 'Creates the job posting with AI, screens resumes, scores candidates consistently and delivers an interview-ready shortlist.' },
        { key: 'traffic', name: 'Paid Ads Manager', ready: true, desc: 'Monitors Meta Ads and Google Ads, spots wasted spend and suggests optimizations — you approve, it executes.' },
        { key: 'finance', name: 'Finance', ready: false, desc: 'Automatic billing, reconciliation and financial reports.' },
        { key: 'reception', name: 'General Receptionist', ready: false, desc: 'Front-line triage for any inquiry: questions, scheduling and routing.' },
      ],
    },
    benefits: {
      eyebrow: 'What you get',
      titleA: 'A complete workforce',
      titleB: 'that never tires, never misses a day, never asks for a raise',
      cards: [
        { title: '24/7 WhatsApp coverage', desc: 'Replies in seconds. Qualifies the lead. Follows up. Answers questions. All automatically while you rest.', badge: 'Best seller' },
        { title: 'Smart lead qualification', desc: 'Your AI employee spots buying intent and prioritizes — so you focus only on what matters.', badge: null },
        { title: 'Live results dashboard', desc: 'See leads, conversations and the sales pipeline of every location in real time.', badge: null },
        { title: 'Multi-location management', desc: 'From a single location to a whole network — everything managed from one central panel.', badge: null },
        { title: 'Automatic prospecting', desc: 'Finds companies in your industry on Google Maps, with phone numbers, straight into your pipeline.', badge: null },
        { title: 'Enterprise-grade security', desc: 'Encrypted data, automatic backups and role-based access control.', badge: null },
      ],
    },
    roi: {
      withoutEyebrow: 'Without Alizo',
      withoutTitle: 'You pay salary, taxes and business hours',
      withoutItems: [
        'A full-time rep costs thousands of dollars a month',
        'Available only 8h/day, 5 days a week',
        'Vacations, sick days, turnover',
        'Retraining every time someone leaves',
        'After-hours leads go unanswered',
      ],
      withEyebrow: 'With Alizo',
      withTitle: 'You invest from $97/month',
      withItems: [
        'AI employee active 24 hours a day, 7 days a week',
        'Never absent, never on vacation, never asks for a raise',
        'Replies in seconds, any time of day',
        'Automatic follow-up so leads never go cold',
        'Scales instantly with your demand',
        '7-day money-back guarantee',
      ],
      cta: 'Start saving now',
    },
    plans: {
      eyebrow: 'Pricing',
      title: 'Pick the plan for your operation',
      sub: '7-day guarantee. Cancel anytime. No lock-in.',
      perMonth: '/mo',
      onRequest: 'Contact us',
      ctaStart: 'Start with',
      ctaTalk: 'Talk to us',
      featured: '⚡ Most popular',
      items: [
        {
          slug: 'starter', name: 'Starter', featured: false,
          desc: 'For businesses starting to automate',
          features: ['1 unit / location', '1 active digital employee', '24/7 WhatsApp answering and qualification', 'Company prospecting via Google Maps', 'Automatic lead follow-up', 'Real-time results dashboard', 'Email support'],
        },
        {
          slug: 'pro', name: 'Pro', featured: true,
          desc: 'For growing operations that need scale',
          features: ['Up to 5 units / locations', 'Up to 3 digital employees (AI Sales Representative, HR and Ads)', 'Multi-location WhatsApp', 'Company prospecting via Google Maps', 'Full sales pipeline (CRM)', 'Priority support', 'Assisted setup by our team'],
        },
        {
          slug: 'enterprise', name: 'Enterprise', featured: false,
          desc: 'For large networks — scope and pricing on request',
          features: ['Unlimited units', 'All digital employees', 'Dedicated onboarding and setup', 'Dedicated support', 'Custom commercial terms'],
        },
      ],
      trust: ['100% secure payment', 'Instant access after signup', 'Support in English', 'Guided setup'],
    },
    faq: {
      eyebrow: 'Frequently asked questions',
      title: 'Everything you need to know',
      items: [
        { q: 'Do I need technical knowledge to set it up?', a: 'No. Our onboarding wizard guides you step by step. In under 10 minutes your AI employee is live. If you need help, our team does the full setup for you.' },
        { q: 'How does payment work?', a: 'In the US we accept Zelle and debit or credit card (single monthly charge, no installment plans). In Brazil we accept PIX, boleto and debit/credit card.' },
        { q: 'Does the AI employee sound human?', a: "Yes. It's trained on your company's tone of voice, knows your products and services, and replies naturally. Customers rarely notice it's AI — and when they do, they love the speed." },
        { q: 'What if I need more locations later?', a: 'Just upgrade your plan. Talk to us and the transition happens without interrupting your operation.' },
        { q: 'Can I cancel anytime?', a: "Yes. No lock-in, no penalty. If you're not satisfied within the first 7 days, we refund 100% of what you paid." },
        { q: 'Is my data safe?', a: 'Fully. Supabase + Vercel infrastructure with encryption, automatic backups and role-based access control.' },
      ],
    },
    finalCta: {
      eyebrow: "Don't put it off",
      titleA: 'Every day without AI is',
      titleB: 'money thrown away.',
      sub: "Your competitors are already automating. The difference between who leads the market over the next 5 years and who falls behind is a decision you make today.",
      cta: 'Start now — 7-day guarantee',
      trust: '✓ No lock-in  ·  ✓ Cancel anytime  ·  ✓ Instant access',
    },
    footer: { rights: 'All rights reserved' },
    chat: {
      teaserTitleA: "Hi! I'm ",
      teaserTitleB: ', your AI consultant 👋',
      teaserSub: 'Ask me anything before you subscribe!',
      ariaLabel: 'Talk to the AI consultant',
    },
  },
} as const

type Copy = (typeof COPY)[Locale]

const TEAM_ICONS = { sdr: Bot, rh: Briefcase, traffic: Megaphone, finance: Wallet, reception: HeadphonesIcon } as const
const CONTACT_EMAIL = 'suporte@alizo.com.br'

export default function HomePage() {
  const locale = getLocale()
  const t: Copy = COPY[locale]

  const painIcons = [Clock, DollarSign, Users]
  const stepColors = ['#3b82f6', '#8b5cf6', '#22d3ee', '#f59e0b']
  const benefitIcons = [MessageSquare, TrendingUp, BarChart3, Globe, MapPin, Shield]
  const benefitColors = ['#22d3ee', '#3b82f6', '#8b5cf6', '#f59e0b', '#ec4899', '#06b6d4']
  const trustIcons = [Lock, Zap, HeadphonesIcon, Sparkles]

  return (
    <main className="min-h-screen overflow-x-hidden" style={{ background: '#06090f', color: '#fff' }}>

      {/* ─── NAV ─── */}
      <nav className="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06]"
        style={{ background: 'rgba(6,9,15,0.85)', backdropFilter: 'blur(16px)' }}>
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <img src="/branding/alizo-logo.png" alt="Alizo" className="h-8 w-auto" />
          </div>
          <div className="hidden items-center gap-6 md:flex">
            <a href="#como-funciona" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.how}</a>
            <a href="#funcionarios" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.employees}</a>
            <a href="#planos" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.plans}</a>
            <a href="#faq" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.faq}</a>
            <Link href="/login" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.login}</Link>
          </div>
          <Link
            href="#planos"
            className="rounded-xl px-4 py-2 text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 4px 14px rgba(6,182,212,0.3)' }}
          >
            {t.nav.cta}
          </Link>
        </div>
      </nav>

      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden pb-20 pt-36">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full opacity-20"
            style={{ background: 'radial-gradient(ellipse, #06b6d4 0%, transparent 70%)', filter: 'blur(80px)' }} />
          <div className="absolute -left-40 top-40 h-72 w-72 rounded-full opacity-10"
            style={{ background: 'radial-gradient(ellipse, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 px-4 py-1.5"
            style={{ background: 'rgba(6,182,212,0.08)' }}>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
            </span>
            <span className="text-xs font-bold text-cyan-400">{t.hero.badge}</span>
          </div>

          <h1 className="text-4xl font-black leading-[1.1] tracking-tight md:text-6xl lg:text-7xl">
            {t.hero.titleA}<br />
            <span style={{ background: 'linear-gradient(135deg, #f87171, #ef4444)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {t.hero.titleRed}
            </span>
            {' '}{t.hero.titleB}<br />
            {t.hero.titleC}<br />
            <span style={{ background: 'linear-gradient(135deg, #22d3ee, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {t.hero.titleCyan}
            </span>
          </h1>

          <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-zinc-400">
            {t.hero.sub1}<strong className="text-white">Alizo</strong>{t.hero.sub2}
            <strong className="text-cyan-400">{t.hero.sub3}</strong>
          </p>

          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <a
              href="#planos"
              className="flex items-center gap-2 rounded-2xl px-8 py-4 text-base font-black text-white transition-all hover:scale-105 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 6px 30px rgba(6,182,212,0.4)' }}
            >
              {t.hero.ctaMain}
              <ArrowRight size={16} />
            </a>
            <Link
              href="/login"
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white/5"
            >
              <Play size={14} />
              {t.hero.ctaDemo}
            </Link>
          </div>

          <div className="mx-auto mt-16 grid max-w-3xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10"
            style={{ background: 'rgba(255,255,255,0.03)' }}>
            {t.hero.proof.map(({ value, label, sub }) => (
              <div key={label} className="flex flex-col items-center px-4 py-6">
                <p className="text-3xl font-black text-white">{value}</p>
                <p className="mt-1 text-xs font-semibold text-zinc-300">{label}</p>
                <p className="mt-0.5 text-[10px] text-cyan-400">{sub}</p>
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
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-red-400">{t.pain.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              {t.pain.titleA}<br />
              <span className="text-red-400">{t.pain.titleB}</span>
            </h2>
            <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
              {t.pain.cards.map(({ title, desc }, i) => {
                const Icon = painIcons[i]!
                return (
                  <div key={title} className="rounded-2xl border border-red-500/15 p-5"
                    style={{ background: 'rgba(239,68,68,0.05)' }}>
                    <Icon size={20} className="text-red-400" />
                    <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                  </div>
                )
              })}
            </div>
            <p className="mt-8 text-lg font-bold text-white">
              {t.pain.closerA}<em className="text-zinc-400">{t.pain.closerIf}</em>{t.pain.closerB}
              <span className="text-cyan-400">{t.pain.closerWhen}</span>{t.pain.closerC}
            </p>
          </div>
        </div>
      </section>

      {/* ─── COMO FUNCIONA ─── */}
      <section id="como-funciona" className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.how.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              {t.how.titleA}<br />
              <span style={{ color: '#22d3ee' }}>{t.how.titleB}</span>
            </h2>
          </div>

          <div className="relative grid grid-cols-1 gap-6 md:grid-cols-4">
            {t.how.steps.map(({ title, desc }, i) => (
              <div key={title} className="relative">
                {i < 3 && (
                  <div className="absolute right-0 top-8 hidden h-px w-full translate-x-1/2 border-t border-dashed border-white/10 md:block" />
                )}
                <div className="relative rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <div className="text-4xl font-black" style={{ color: stepColors[i], opacity: 0.4 }}>
                    {`0${i + 1}`}
                  </div>
                  <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FUNCIONÁRIOS DIGITAIS ─── */}
      <section id="funcionarios" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.team.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              {t.team.titleA}<br />{t.team.titleB}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.team.members.map(({ key, name, ready, desc }) => {
              const Icon = TEAM_ICONS[key as keyof typeof TEAM_ICONS]
              return (
                <div key={key}
                  className="relative overflow-hidden rounded-2xl border p-6 transition-all hover:-translate-y-0.5"
                  style={ready
                    ? { borderColor: 'rgba(6,182,212,0.25)', background: 'linear-gradient(160deg, rgba(6,182,212,0.06) 0%, rgba(255,255,255,0.02) 100%)' }
                    : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', opacity: 0.75 }}>
                  <span className="absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                    style={ready
                      ? { background: 'rgba(74,222,128,0.12)', color: '#4ade80' }
                      : { background: 'rgba(148,163,184,0.12)', color: '#94a3b8' }}>
                    {ready ? t.team.ready : t.team.soon}
                  </span>
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ background: 'rgba(6,182,212,0.12)' }}>
                    <Icon size={18} className={ready ? 'text-cyan-400' : 'text-slate-500'} />
                  </div>
                  <h3 className="mt-4 text-sm font-black text-white">{name}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── BENEFÍCIOS ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.benefits.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">
              {t.benefits.titleA}<br />{t.benefits.titleB}
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.benefits.cards.map(({ title, desc, badge }, i) => {
              const Icon = benefitIcons[i]!
              const color = benefitColors[i]!
              return (
                <div key={title} className="group relative overflow-hidden rounded-2xl border border-white/10 p-6 transition-all hover:border-white/20 hover:-translate-y-0.5"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  {badge && (
                    <span className="absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                      style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
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
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── ROI SECTION ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <div className="overflow-hidden rounded-3xl border border-cyan-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(6,9,15,0.5) 100%)' }}>
            <div className="grid grid-cols-1 md:grid-cols-2">
              <div className="border-b border-white/10 p-10 md:border-b-0 md:border-r">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.roi.withoutEyebrow}</p>
                <h3 className="mt-3 text-2xl font-black text-red-400">{t.roi.withoutTitle}</h3>
                <ul className="mt-6 space-y-3">
                  {t.roi.withoutItems.map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-400">
                      <span className="mt-0.5 text-red-400">✗</span>
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-10">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.roi.withEyebrow}</p>
                <h3 className="mt-3 text-2xl font-black text-cyan-400">{t.roi.withTitle}</h3>
                <ul className="mt-6 space-y-3">
                  {t.roi.withItems.map(item => (
                    <li key={item} className="flex items-start gap-2.5 text-sm text-zinc-300">
                      <Check size={14} className="mt-0.5 flex-shrink-0 text-cyan-400" />
                      {item}
                    </li>
                  ))}
                </ul>
                <a href="#planos" className="mt-8 flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white transition-all hover:scale-105"
                  style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 6px 20px rgba(6,182,212,0.3)' }}>
                  {t.roi.cta}
                  <ArrowRight size={14} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── PLANOS / PRICING ─── */}
      <section id="planos" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.plans.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black md:text-4xl">{t.plans.title}</h2>
            <p className="mt-4 text-zinc-400">{t.plans.sub}</p>
          </div>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {t.plans.items.map(plan => (
              <PlanCard key={plan.slug} plan={plan} locale={locale} labels={t.plans} />
            ))}
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-8">
            {t.plans.trust.map((text, i) => {
              const Icon = trustIcons[i]!
              return (
                <div key={text} className="flex items-center gap-2">
                  <Icon size={14} className="text-cyan-400" />
                  <span className="text-xs text-zinc-400">{text}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── FAQ ─── */}
      <section id="faq" className="py-20">
        <div className="mx-auto max-w-3xl px-6">
          <div className="mb-14 text-center">
            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.faq.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-black">{t.faq.title}</h2>
          </div>

          <div className="space-y-3">
            {t.faq.items.map(({ q, a }) => (
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
            style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,9,15,1) 100%)', border: '1px solid rgba(6,182,212,0.25)' }}>
            <div className="relative p-12 md:p-16">
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-1/2 top-1/2 h-[400px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
                  style={{ background: 'radial-gradient(ellipse, #06b6d4 0%, transparent 70%)', filter: 'blur(80px)' }} />
              </div>
              <div className="relative">
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.finalCta.eyebrow}</p>
                <h2 className="mt-3 text-4xl font-black md:text-5xl">
                  {t.finalCta.titleA}<br />
                  <span className="text-red-400">{t.finalCta.titleB}</span>
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-lg text-zinc-400">{t.finalCta.sub}</p>
                <a
                  href="#planos"
                  className="mt-10 inline-flex items-center gap-2 rounded-2xl px-10 py-4 text-base font-black text-white transition-all hover:scale-105 active:scale-95"
                  style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 8px 40px rgba(6,182,212,0.4)' }}
                >
                  {t.finalCta.cta}
                  <ArrowRight size={16} />
                </a>
                <p className="mt-4 text-xs text-zinc-500">{t.finalCta.trust}</p>
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
                style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)' }}>
                <Bot size={13} className="text-white" />
              </div>
              <span className="font-black text-white text-sm">alizo</span>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-500">
              <a href="#como-funciona" className="hover:text-white transition-colors">{t.nav.how}</a>
              <a href="#planos" className="hover:text-white transition-colors">{t.nav.plans}</a>
              <a href="#faq" className="hover:text-white transition-colors">{t.nav.faq}</a>
              <Link href="/login" className="hover:text-white transition-colors">{t.nav.login}</Link>
            </div>
            <p className="text-xs text-zinc-600">© 2026 Alizo · AI Workforce OS · {t.footer.rights}</p>
          </div>
        </div>
      </footer>

      <SalesChatWidget chat={t.chat} />
    </main>
  )
}

function PlanCard({
  plan, locale, labels,
}: {
  plan: Copy['plans']['items'][number]
  locale: Locale
  labels: Copy['plans']
}) {
  const { name, slug, desc, featured, features } = plan
  const isEnterprise = slug === 'enterprise'
  const price = isEnterprise ? null : planPrice(slug as 'starter' | 'pro', locale)
  const subject = locale === 'en' ? 'Enterprise plan' : 'Plano Enterprise'

  return (
    <div className={`relative flex flex-col overflow-hidden rounded-3xl transition-all hover:-translate-y-1 ${
      featured ? '' : 'border border-white/10'
    }`}
      style={featured ? {
        border: '1px solid rgba(6,182,212,0.4)',
        background: 'linear-gradient(160deg, rgba(6,182,212,0.1) 0%, rgba(6,9,15,0.9) 100%)',
        boxShadow: '0 0 60px rgba(6,182,212,0.15)',
      } : { background: 'rgba(255,255,255,0.03)' }}>

      {featured && (
        <div className="absolute inset-x-0 top-0 h-[2px]"
          style={{ background: 'linear-gradient(90deg, #06b6d4, #4361ee)' }} />
      )}

      {featured && (
        <div className="absolute right-5 top-5 rounded-full px-3 py-1 text-[10px] font-black"
          style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
          {labels.featured}
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
              <span className="text-xs text-zinc-500">{locale === 'en' ? 'US$' : 'R$'}</span>
              <span className="text-5xl font-black text-white">
                {price.toLocaleString(locale === 'en' ? 'en-US' : 'pt-BR')}
              </span>
              <span className="mb-1.5 text-sm text-zinc-500">{labels.perMonth}</span>
            </div>
          ) : (
            <p className="text-2xl font-black text-zinc-300">{labels.onRequest}</p>
          )}
        </div>

        {isEnterprise ? (
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`}
            className="flex items-center justify-center gap-2 rounded-2xl border border-white/15 py-3.5 text-sm font-black text-white transition-all hover:scale-[1.02] hover:border-white/30 hover:bg-white/5 active:scale-95"
          >
            {labels.ctaTalk}
            <ArrowRight size={14} />
          </a>
        ) : (
          <Link
            href={`/checkout?plan=${slug}`}
            className={`flex items-center justify-center gap-2 rounded-2xl py-3.5 text-sm font-black text-white transition-all hover:scale-[1.02] active:scale-95 ${
              featured ? '' : 'border border-white/15 hover:border-white/30 hover:bg-white/5'
            }`}
            style={featured ? {
              background: 'linear-gradient(135deg, #06b6d4, #4361ee)',
              boxShadow: '0 6px 20px rgba(6,182,212,0.3)',
            } : {}}
          >
            {labels.ctaStart} {name}
            <ArrowRight size={14} />
          </Link>
        )}

        <ul className="space-y-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm text-zinc-300">
              <Check size={13} className="mt-0.5 flex-shrink-0 text-cyan-400" />
              {f}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function SalesChatWidget({ chat }: { chat: Copy['chat'] }) {
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
        <div
          id="chat-bubble"
          style={{
            background: 'rgba(6,9,15,0.95)',
            border: '1px solid rgba(6,182,212,0.3)',
            borderRadius: '16px',
            padding: '12px 16px',
            maxWidth: '240px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            animation: 'slideUp 0.4s ease-out',
          }}
        >
          <p style={{ margin: 0, fontSize: '13px', color: '#d1fae5', fontWeight: 700 }}>
            {chat.teaserTitleA}<span style={{ color: '#22d3ee' }}>Kai</span>{chat.teaserTitleB}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#71717a' }}>
            {chat.teaserSub}
          </p>
        </div>

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
            background: 'linear-gradient(135deg, #06b6d4, #4361ee)',
            boxShadow: '0 8px 24px rgba(6,182,212,0.4)',
            transition: 'transform 0.2s',
          }}
          aria-label={chat.ariaLabel}
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
