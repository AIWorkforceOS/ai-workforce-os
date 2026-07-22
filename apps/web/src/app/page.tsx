import Link from 'next/link'
import { getLocale } from '@/lib/i18n/server'
import { planPrice, type Locale } from '@/lib/i18n/config'
import { Reveal } from '@/components/landing/reveal'
import { DemoChat } from '@/components/landing/demo-chat'
import {
  Bot, Check, Zap, BarChart3, MessageSquare, Shield, ArrowRight,
  TrendingUp, Clock, DollarSign, Users, ChevronDown, Play,
  Sparkles, Globe, Lock, HeadphonesIcon, Briefcase, Megaphone, Wallet, MapPin,
  ClipboardList, Scale, Truck, Home, HeartHandshake,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/**
 * Todo o copy da landing vive aqui, em pt e en. A localidade vem do
 * middleware (geolocalização por IP — EUA abre em inglês/dólar).
 *
 * Posicionamento: a Alizo se apresenta como empresa americana de
 * tecnologia sediada em Phoenix, Arizona, sempre na fronteira da IA.
 * Números de produto descrevem apenas o que existe hoje (4 funcionários
 * ativos, WhatsApp, prospecção, funil). A seção de economia usa valores
 * de mercado explicitamente marcados como ilustrativos. A conversa da
 * demonstração é uma simulação declarada como tal.
 */
const COPY = {
  pt: {
    nav: { how: 'Como funciona', demo: 'Demonstração', story: 'Nossa história', plans: 'Planos', faq: 'FAQ', login: 'Entrar', cta: 'Começar agora' },
    hero: {
      badge: 'Phoenix, Arizona · Empresa americana de tecnologia em IA',
      titleA: 'Seu próximo',
      titleGrad: 'funcionário destaque',
      titleB: 'não é humano.',
      sub1: 'A ',
      sub2: ' constrói funcionários digitais de IA que vendem, recrutam e atendem pela sua empresa — 24 horas por dia, com a tecnologia mais recente do mundo.',
      sub3: ' Sem contratar. Sem folha de pagamento. Sem limite de escala.',
      ctaMain: 'Contratar meu funcionário IA',
      ctaDemo: 'Ver demonstração',
      techLine: 'Sempre rodando a última geração de IA de fronteira — atualizada continuamente',
      proof: [
        { value: '4', label: 'Funcionários digitais prontos', sub: 'AI Sales Representative, RH, Tráfego Pago e Recepcionista' },
        { value: '24/7', label: 'Disponibilidade garantida', sub: 'Sem feriados, sem férias' },
        { value: '10 min', label: 'Para configurar e ativar', sub: 'Entrevista guiada, sem código' },
      ],
    },
    demo: {
      eyebrow: 'Demonstração',
      titleA: 'Veja um funcionário IA',
      titleB: 'fechando de verdade.',
      sub: 'Simulação de uma conversa real: o lead chega às 23h47 e a Ava — AI Sales Representative — responde em segundos, qualifica e agenda a visita. Enquanto o dono da empresa dorme.',
      bullets: [
        { title: 'Responde em segundos', desc: 'O lead nunca espera. Cada minuto de demora derruba a chance de fechar.' },
        { title: 'Qualifica como um vendedor sênior', desc: 'Faz as perguntas certas, entende o contexto e conduz a conversa até o próximo passo.' },
        { title: 'Fecha e agenda sozinho', desc: 'Estimativa, agendamento e follow-up — sem ninguém da sua equipe encostar no celular.' },
      ],
      chat: {
        agentName: 'Ava',
        agentRole: 'AI Sales Rep',
        online: 'Online agora',
        messages: [
          { from: 'lead', text: 'oi, vi o anúncio de vocês. quanto fica uma reforma completa de cozinha?', time: '23:47' },
          { from: 'ai', text: 'Oi! Que bom que chamou 👋 Sou a Ava, da Reforma Prime. Consigo te passar uma estimativa agora — só me confirma: é pra sua casa atual? Pensa em mudar a planta ou manter o layout e renovar acabamentos?', time: '23:47' },
          { from: 'lead', text: 'casa atual. manter o layout, trocar armários, bancada e piso', time: '23:48' },
          { from: 'ai', text: 'Perfeito. Reformas assim, mantendo o layout, ficam entre R$ 28 mil e R$ 45 mil dependendo dos acabamentos — e nossa agenda de obra está com 3 semanas de espera. Posso reservar uma visita técnica gratuita essa semana pra te dar o valor exato: quinta às 10h ou sábado às 9h?', time: '23:48' },
          { from: 'lead', text: 'sábado 9h fechou. nossa, que rápido kkk', time: '23:50' },
          { from: 'ai', text: 'Reservado: sábado, 9h ✅ Vou te mandar a confirmação e um lembrete um dia antes. Quer que nosso técnico avalie mais alguma coisa na visita — iluminação, ilha, parte hidráulica?', time: '23:50' },
          { from: 'lead', text: 'a ilha, na vdd', time: '23:51' },
          { from: 'ai', text: 'Anotado — ilha incluída no escopo. Até sábado! 🙌', time: '23:51' },
        ],
        outcome: 'Lead qualificado · Visita agendada',
        outcomeSub: '23h51 — enquanto o dono da empresa dormia',
        replay: 'Simulação · reinicia sozinha',
      },
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
    story: {
      eyebrow: 'Nossa história',
      titleA: 'Nascida no deserto do Arizona,',
      titleB: 'construída para o mundo.',
      p1: 'A Alizo nasceu em Phoenix, Arizona, de uma inquietação simples: víamos pequenas e médias empresas perdendo clientes todos os dias — não por falta de qualidade, mas por falta de gente. O lead chegava às 23h e ninguém respondia. A vaga ficava aberta por meses. O anúncio queimava verba sem ninguém olhar.',
      p2: 'As grandes corporações sempre tiveram exércitos de vendedores, recrutadores e analistas. As pequenas, não. Quando os modelos de IA de fronteira chegaram, entendemos que essa conta finalmente podia mudar: pela primeira vez, uma empresa de qualquer tamanho poderia ter uma equipe completa trabalhando 24 horas por dia.',
      p3: 'Por isso não construímos "mais um chatbot". Construímos funcionários digitais — que entrevistam você, aprendem o seu negócio e trabalham de verdade. E como vivemos no ritmo da fronteira da IA, cada avanço dos melhores laboratórios do mundo chega aos nossos funcionários em semanas, não em anos.',
      coords: '33.4484° N · 112.0740° W — Phoenix, AZ',
      hq: 'Sede · Phoenix, Arizona',
      milestones: [
        { tag: 'A origem', title: 'Phoenix, Arizona', desc: 'Fundada no coração de um dos ecossistemas de tecnologia que mais crescem nos Estados Unidos.' },
        { tag: 'A tese', title: 'IA que trabalha, não que conversa', desc: 'Funcionários digitais com função, meta e responsabilidade — não assistentes genéricos.' },
        { tag: 'Hoje', title: 'Alcance global', desc: 'Funcionários digitais prontos para atender empresas em qualquer lugar do mundo, 24/7.' },
      ],
    },
    how: {
      eyebrow: 'Configuração simples',
      titleA: 'Do plano ao primeiro atendimento',
      titleB: 'em menos de 10 minutos',
      steps: [
        { title: 'Escolha seu plano', desc: 'Selecione o plano ideal para o tamanho da sua operação e pague com PIX, boleto ou cartão à vista.' },
        { title: 'Crie sua conta', desc: 'Acesso imediato. Você define sua senha e entra direto na plataforma, sem esperar e-mail.' },
        { title: 'Ele entrevista você', desc: 'Como um contratado no primeiro dia: seu funcionário IA conduz uma entrevista adaptativa e aprende seu negócio, serviços, preços e tom de voz.' },
        { title: 'Ele começa a trabalhar', desc: 'Ativo 24/7 no WhatsApp da sua empresa — atendendo, qualificando e fazendo follow-up.' },
      ],
      highlight: {
        tag: 'O diferencial Alizo',
        title: 'A entrevista de contratação',
        desc: 'Antes de falar com qualquer cliente, seu funcionário IA senta com você — como numa entrevista de primeiro dia. Ele pergunta sobre seu segmento, seus serviços, seus diferenciais e sua forma de atender, e monta sozinho o próprio manual de trabalho. Quanto mais você conta, melhor ele fica.',
      },
    },
    team: {
      eyebrow: 'Conheça o time',
      titleA: 'Dez funcionários digitais.',
      titleB: 'Contrate os que sua operação precisa.',
      ready: 'Disponível',
      soon: 'Em breve',
      members: [
        { key: 'sdr', name: 'AI Sales Representative', ready: true, desc: 'Atende no WhatsApp em segundos, qualifica leads, faz follow-up automático e prospecta empresas no Google Maps.' },
        { key: 'rh', name: 'Recrutador (RH)', ready: true, desc: 'Cria a vaga com IA, tria currículos, pontua candidatos na régua certa e entrega uma shortlist pronta para entrevista.' },
        { key: 'traffic', name: 'Gestor de Tráfego Pago', ready: true, desc: 'Acompanha Meta Ads e Google Ads, detecta desperdício e sugere otimizações — você aprova, ele executa.' },
        { key: 'reception', name: 'Recepcionista', ready: true, desc: 'Primeiro contato, triagem e direcionamento — dúvidas, agendamentos e atendimento ao cliente.' },
        { key: 'admin', name: 'Assistente Administrativo', ready: false, desc: 'Rotinas administrativas, documentos, agenda e suporte operacional do dia a dia.' },
        { key: 'finance', name: 'Assistente Financeiro', ready: false, desc: 'Cobranças, conciliação e relatórios de todo o departamento financeiro da empresa.' },
        { key: 'legal', name: 'Assistente Jurídico', ready: false, desc: 'Contratos, documentos, compliance e suporte jurídico para o seu negócio.' },
        { key: 'ops', name: 'Gestor de Operações', ready: false, desc: 'Compras, estoque, logística e relacionamento com fornecedores.' },
        { key: 'realestate', name: 'Consultor Imobiliário', ready: false, desc: 'Atendimento, qualificação e agendamento de visitas para o setor imobiliário.' },
        { key: 'cs', name: 'Gerente de Sucesso do Cliente', ready: false, desc: 'Onboarding, retenção, pós-venda e renovação de clientes.' },
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
    numbers: {
      eyebrow: 'A conta que importa',
      titleA: 'Quanto custa',
      titleB: 'não automatizar?',
      sub: 'Exemplo ilustrativo com valores típicos de mercado — o cálculo do seu caso acontece no onboarding.',
      cards: [
        { value: 'R$ 3.500+', label: 'Custo mensal típico de um atendente CLT', sub: 'salário + encargos + benefícios' },
        { value: 'R$ 497', label: 'Funcionário digital Alizo (Starter)', sub: 'até ~85% menos por mês' },
        { value: '168h', label: 'De cobertura por semana com a Alizo', sub: 'vs. ~44h de um turno comercial' },
        { value: 'Segundos', label: 'Para responder qualquer lead', sub: 'a qualquer hora — inclusive 3h da manhã' },
      ],
      disclaimer: 'Valores ilustrativos baseados em médias de mercado; resultados variam por segmento e operação.',
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
        { q: 'De onde é a Alizo?', a: 'A Alizo é uma empresa americana de tecnologia sediada em Phoenix, Arizona, com alcance global. Nossa plataforma roda sobre os modelos de IA mais recentes do mercado e é atualizada continuamente conforme a fronteira da IA avança.' },
        { q: 'Preciso de conhecimento técnico para configurar?', a: 'Não. Seu funcionário IA conduz uma entrevista guiada com você, passo a passo. Em menos de 10 minutos ele está ativo. Se precisar de ajuda, nossa equipe faz a configuração completa por você.' },
        { q: 'Como funciona o pagamento? Aceitam PIX e boleto?', a: 'Sim. No Brasil aceitamos PIX, boleto bancário e cartão de débito ou crédito à vista (sem parcelamento no momento). Nos EUA, aceitamos cartão de débito ou crédito.' },
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
    footer: { rights: 'Todos os direitos reservados', hq: 'Phoenix, Arizona · EUA' },
    chat: {
      teaserTitleA: 'Olá! Sou o ',
      teaserTitleB: ', seu consultor IA 👋',
      teaserSub: 'Tire suas dúvidas antes de assinar!',
      ariaLabel: 'Falar com consultor IA',
    },
  },
  en: {
    nav: { how: 'How it works', demo: 'Live demo', story: 'Our story', plans: 'Pricing', faq: 'FAQ', login: 'Sign in', cta: 'Get started' },
    hero: {
      badge: 'Phoenix, Arizona · American AI technology company',
      titleA: 'Your next',
      titleGrad: 'top performer',
      titleB: "isn't human.",
      sub1: '',
      sub2: ' builds AI digital employees that sell, recruit and serve for your business — 24 hours a day, powered by the latest AI in the world.',
      sub3: ' No hiring. No payroll. No scaling limits.',
      ctaMain: 'Hire my AI employee',
      ctaDemo: 'Watch the demo',
      techLine: 'Always running the latest generation of frontier AI — continuously updated',
      proof: [
        { value: '4', label: 'Digital employees ready today', sub: 'AI Sales Representative, Recruiter, Paid Ads and Receptionist' },
        { value: '24/7', label: 'Guaranteed availability', sub: 'No holidays, no vacations' },
        { value: '10 min', label: 'To set up and go live', sub: 'Guided interview, no code' },
      ],
    },
    demo: {
      eyebrow: 'Live demo',
      titleA: 'Watch an AI employee',
      titleB: 'actually close.',
      sub: 'A simulated real-world conversation: the lead texts at 11:47 PM and Ava — AI Sales Representative — replies in seconds, qualifies and books the visit. While the owner sleeps.',
      bullets: [
        { title: 'Replies in seconds', desc: 'The lead never waits. Every minute of delay cuts the odds of closing.' },
        { title: 'Qualifies like a senior rep', desc: 'Asks the right questions, reads the context and drives the conversation to the next step.' },
        { title: 'Closes and books on its own', desc: 'Estimates, scheduling and follow-up — without anyone on your team touching a phone.' },
      ],
      chat: {
        agentName: 'Ava',
        agentRole: 'AI Sales Rep',
        online: 'Online now',
        messages: [
          { from: 'lead', text: 'hey, saw your ad — how much for a full kitchen remodel?', time: '11:47 PM' },
          { from: 'ai', text: "Hey! Glad you reached out 👋 I'm Ava with Desert Peak Remodeling. I can get you a ballpark right now — quick check: is this for your current home? Keeping the layout, or changing the footprint?", time: '11:47 PM' },
          { from: 'lead', text: 'current home. same layout — new cabinets, countertops and flooring', time: '11:48 PM' },
          { from: 'ai', text: "Perfect. Same-layout remodels like that typically run $18k–$27k depending on finishes — and our install calendar is about 3 weeks out. I can hold a free on-site estimate this week to get you an exact number: Thursday 10am or Saturday 9am?", time: '11:48 PM' },
          { from: 'lead', text: 'saturday 9am works. wow that was fast lol', time: '11:50 PM' },
          { from: 'ai', text: "You're booked: Saturday, 9am ✅ I'll text you a confirmation and a reminder the day before. Anything else you'd like our estimator to look at — lighting, island, plumbing?", time: '11:50 PM' },
          { from: 'lead', text: 'the island, actually', time: '11:51 PM' },
          { from: 'ai', text: 'Noted — island added to the scope. See you Saturday! 🙌', time: '11:51 PM' },
        ],
        outcome: 'Lead qualified · Visit booked',
        outcomeSub: '11:51 PM — while the owner was asleep',
        replay: 'Simulation · replays automatically',
      },
    },
    pain: {
      eyebrow: 'The reality nobody talks about',
      titleA: 'While you read this, your competitors',
      titleB: 'are already automating.',
      cards: [
        { title: 'Leads go cold in minutes', desc: 'When replies take too long, the customer has already moved on. Your AI employee replies in seconds.' },
        { title: 'Thousands of dollars in payroll', desc: 'For repetitive tasks an AI employee handles for $197/month, 24 hours a day.' },
        { title: 'Your team is burned out', desc: 'Answering the same basic questions on WhatsApp instead of closing sales.' },
      ],
      closerA: "The question isn't ",
      closerIf: 'if',
      closerB: " you'll automate. It's ",
      closerWhen: 'when',
      closerC: ' — and whether it happens before or after your competition.',
    },
    story: {
      eyebrow: 'Our story',
      titleA: 'Born in the Arizona desert,',
      titleB: 'built for the world.',
      p1: 'Alizo was born in Phoenix, Arizona, out of a simple frustration: we watched small and mid-sized businesses lose customers every single day — not for lack of quality, but for lack of people. The lead texted at 11pm and nobody answered. The job opening sat unfilled for months. The ad budget burned with nobody watching.',
      p2: 'Big corporations have always had armies of salespeople, recruiters and analysts. Small businesses never did. When frontier AI models arrived, we knew that math could finally change: for the first time, a company of any size could run a full team working around the clock.',
      p3: "That's why we didn't build another chatbot. We built digital employees — ones that interview you, learn your business and actually do the work. And because we live at the AI frontier, every breakthrough from the world's best labs reaches our employees in weeks, not years.",
      coords: '33.4484° N · 112.0740° W — Phoenix, AZ',
      hq: 'Headquarters · Phoenix, Arizona',
      milestones: [
        { tag: 'The origin', title: 'Phoenix, Arizona', desc: 'Founded in the heart of one of the fastest-growing tech ecosystems in the United States.' },
        { tag: 'The thesis', title: 'AI that works, not chats', desc: 'Digital employees with a role, a goal and accountability — not generic assistants.' },
        { tag: 'Today', title: 'Built for global reach', desc: 'Digital employees ready to serve businesses anywhere in the world, 24/7.' },
      ],
    },
    how: {
      eyebrow: 'Simple setup',
      titleA: 'From plan to first conversation',
      titleB: 'in under 10 minutes',
      steps: [
        { title: 'Pick your plan', desc: 'Choose the plan that fits your operation and pay with a debit or credit card.' },
        { title: 'Create your account', desc: 'Instant access. You set your password and go straight into the platform — no waiting for emails.' },
        { title: 'It interviews you', desc: 'Like a new hire on day one: your AI employee runs an adaptive interview and learns your business, services, pricing and tone of voice.' },
        { title: 'It starts working', desc: 'Live 24/7 on your business WhatsApp — answering, qualifying and following up.' },
      ],
      highlight: {
        tag: 'The Alizo difference',
        title: 'The hiring interview',
        desc: "Before it talks to a single customer, your AI employee sits down with you — like a first-day interview. It asks about your industry, your services, your differentiators and how you like to serve customers, then writes its own playbook. The more you share, the better it gets.",
      },
    },
    team: {
      eyebrow: 'Meet the team',
      titleA: 'Ten digital employees.',
      titleB: 'Hire the ones your operation needs.',
      ready: 'Available',
      soon: 'Coming soon',
      members: [
        { key: 'sdr', name: 'AI Sales Representative', ready: true, desc: 'Answers on WhatsApp in seconds, qualifies leads, follows up automatically and prospects companies on Google Maps.' },
        { key: 'rh', name: 'AI Recruiter (HR)', ready: true, desc: 'Creates the job posting with AI, screens resumes, scores candidates consistently and delivers an interview-ready shortlist.' },
        { key: 'traffic', name: 'AI Marketing/Traffic Specialist', ready: true, desc: 'Monitors Meta Ads and Google Ads, spots wasted spend and suggests optimizations — you approve, it executes.' },
        { key: 'reception', name: 'AI Receptionist', ready: true, desc: 'First point of contact, routing and customer service for any inquiry.' },
        { key: 'admin', name: 'AI Administrative Assistant', ready: false, desc: 'Day-to-day admin work — documents, scheduling and operational support.' },
        { key: 'finance', name: 'AI Financial Assistant', ready: false, desc: 'Runs your entire finance department — billing, reconciliation and reports.' },
        { key: 'legal', name: 'AI Legal Assistant', ready: false, desc: 'Contracts, documents, compliance and legal support for your business.' },
        { key: 'ops', name: 'AI Operations Manager', ready: false, desc: 'Purchasing, inventory, logistics and supplier management.' },
        { key: 'realestate', name: 'AI Real Estate Consultant', ready: false, desc: 'Customer service, qualification and showing scheduling for real estate.' },
        { key: 'cs', name: 'AI Customer Success Manager', ready: false, desc: 'Onboarding, retention, post-sale support and renewals.' },
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
    numbers: {
      eyebrow: 'The math that matters',
      titleA: 'What does',
      titleB: 'not automating cost?',
      sub: 'An illustrative example with typical market numbers — your own case is mapped out during onboarding.',
      cards: [
        { value: '$4,500+', label: 'Typical monthly cost of a full-time rep in the US', sub: 'salary + taxes + benefits' },
        { value: '$197', label: 'Alizo digital employee (Starter)', sub: 'up to ~96% less per month' },
        { value: '168h', label: 'Of coverage per week with Alizo', sub: 'vs. ~40h of a standard shift' },
        { value: 'Seconds', label: 'To answer any lead', sub: 'any time — including 3am' },
      ],
      disclaimer: 'Illustrative figures based on typical market averages; results vary by industry and operation.',
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
      withTitle: 'You invest from $197/month',
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
        { q: 'Where is Alizo based?', a: 'Alizo is an American technology company headquartered in Phoenix, Arizona, built for global reach. Our platform runs on the latest AI models on the market and is continuously updated as the AI frontier advances.' },
        { q: 'Do I need technical knowledge to set it up?', a: 'No. Your AI employee runs a guided interview with you, step by step. In under 10 minutes it goes live. If you need help, our team does the full setup for you.' },
        { q: 'How does payment work?', a: 'In the US we accept debit or credit card (single monthly charge, no installment plans). In Brazil we accept PIX, boleto and debit/credit card.' },
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
    footer: { rights: 'All rights reserved', hq: 'Phoenix, Arizona · USA' },
    chat: {
      teaserTitleA: "Hi! I'm ",
      teaserTitleB: ', your AI consultant 👋',
      teaserSub: 'Ask me anything before you subscribe!',
      ariaLabel: 'Talk to the AI consultant',
    },
  },
} as const

type Copy = (typeof COPY)[Locale]

const TEAM_ICONS = {
  sdr: Bot, rh: Briefcase, traffic: Megaphone, reception: HeadphonesIcon,
  admin: ClipboardList, finance: Wallet, legal: Scale, ops: Truck, realestate: Home, cs: HeartHandshake,
} as const
const CONTACT_EMAIL = 'suporte@alizo.com.br'

/** Grade de linhas ciano com máscara radial — o "fundo tecnológico" da marca. */
function TechGrid({ opacity = 0.14 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        opacity,
        backgroundImage:
          'linear-gradient(rgba(6,182,212,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.5) 1px, transparent 1px)',
        backgroundSize: '54px 54px',
        maskImage: 'radial-gradient(ellipse 75% 65% at 50% 35%, black 25%, transparent 78%)',
        WebkitMaskImage: 'radial-gradient(ellipse 75% 65% at 50% 35%, black 25%, transparent 78%)',
      }}
    />
  )
}

export default function HomePage() {
  const locale = getLocale()
  const t: Copy = COPY[locale]

  const painIcons = [Clock, DollarSign, Users]
  const stepColors = ['#3b82f6', '#8b5cf6', '#22d3ee', '#f59e0b']
  const demoIcons = [Zap, Users, Check]
  const milestoneIcons = [MapPin, Sparkles, Globe]
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
            <a href="#demo" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.demo}</a>
            <a href="#historia" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.story}</a>
            <a href="#como-funciona" className="text-sm text-zinc-400 transition-colors hover:text-white">{t.nav.how}</a>
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
      <section className="relative overflow-hidden pb-20 pt-32">
        <div className="pointer-events-none absolute inset-0">
          <TechGrid />
          <div className="absolute left-1/2 top-0 h-[600px] w-[900px] -translate-x-1/2 rounded-full opacity-20"
            style={{ background: 'radial-gradient(ellipse, #06b6d4 0%, transparent 70%)', filter: 'blur(80px)' }} />
          <div className="absolute -left-40 top-40 h-72 w-72 rounded-full opacity-10"
            style={{ background: 'radial-gradient(ellipse, #3b82f6 0%, transparent 70%)', filter: 'blur(60px)' }} />
          <div className="absolute -right-32 top-64 h-80 w-80 rounded-full opacity-10"
            style={{ background: 'radial-gradient(ellipse, #8b5cf6 0%, transparent 70%)', filter: 'blur(70px)' }} />
        </div>

        <div className="relative mx-auto max-w-5xl px-6 text-center">
          {/* Emblema da marca sobre fundo tecnológico: anel conic girando + glow */}
          <div className="relative mx-auto mb-8 h-24 w-24" style={{ animation: 'alz-float 6s ease-in-out infinite' }}>
            <div className="absolute -inset-8 -z-10 rounded-full opacity-50"
              style={{ background: 'radial-gradient(circle, rgba(6,182,212,0.45), transparent 70%)', filter: 'blur(22px)', animation: 'alz-pulse 4s ease-in-out infinite' }} />
            <div className="absolute inset-0 overflow-hidden rounded-[26px]">
              <div className="absolute inset-[-50%]"
                style={{ background: 'conic-gradient(from 0deg, transparent 0%, #06b6d4 18%, transparent 34%, transparent 55%, #4361ee 74%, transparent 92%)', animation: 'alz-spin 6s linear infinite' }} />
            </div>
            <div className="absolute inset-[2px] flex items-center justify-center rounded-[24px]"
              style={{ background: 'linear-gradient(160deg, #0c1420, #070b12)' }}>
              <img src="/branding/alizo-icon.png" alt="Alizo" className="h-11 w-11 object-contain" />
            </div>
          </div>

          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 px-4 py-1.5"
            style={{ background: 'rgba(6,182,212,0.08)' }}>
            <MapPin size={12} className="text-cyan-400" />
            <span className="text-xs font-bold text-cyan-400">{t.hero.badge}</span>
          </div>

          <h1 className="text-4xl font-black leading-[1.08] tracking-tight md:text-6xl lg:text-7xl">
            {t.hero.titleA}{' '}
            <span style={{ background: 'linear-gradient(135deg, #22d3ee, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              {t.hero.titleGrad}
            </span>
            <br />
            {t.hero.titleB}
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
            <a
              href="#demo"
              className="flex items-center gap-2 rounded-2xl border border-white/10 px-8 py-4 text-base font-medium text-white transition-colors hover:bg-white/5"
            >
              <Play size={14} />
              {t.hero.ctaDemo}
            </a>
          </div>

          <p className="mt-8 flex items-center justify-center gap-2 text-xs text-zinc-500">
            <Sparkles size={12} className="text-cyan-400" />
            {t.hero.techLine}
          </p>

          <Reveal delay={150}>
            <div className="mx-auto mt-14 grid max-w-3xl grid-cols-3 divide-x divide-white/10 overflow-hidden rounded-2xl border border-white/10"
              style={{ background: 'rgba(255,255,255,0.03)' }}>
              {t.hero.proof.map(({ value, label, sub }) => (
                <div key={label} className="flex flex-col items-center px-4 py-6">
                  <p className="text-3xl font-black text-white">{value}</p>
                  <p className="mt-1 text-xs font-semibold text-zinc-300">{label}</p>
                  <p className="mt-0.5 text-[10px] text-cyan-400">{sub}</p>
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── DEMONSTRAÇÃO AO VIVO ─── */}
      <section id="demo" className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <div>
              <Reveal>
                <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.demo.eyebrow}</p>
                <h2 className="mt-3 text-3xl font-black md:text-4xl">
                  {t.demo.titleA}<br />
                  <span style={{ background: 'linear-gradient(135deg, #22d3ee, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {t.demo.titleB}
                  </span>
                </h2>
                <p className="mt-5 text-base leading-relaxed text-zinc-400">{t.demo.sub}</p>
              </Reveal>
              <div className="mt-8 space-y-4">
                {t.demo.bullets.map(({ title, desc }, i) => {
                  const Icon = demoIcons[i]!
                  return (
                    <Reveal key={title} delay={i * 120}>
                      <div className="flex items-start gap-4 rounded-2xl border border-white/10 p-4 transition-all hover:border-cyan-500/30 hover:-translate-y-0.5"
                        style={{ background: 'rgba(255,255,255,0.03)' }}>
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl"
                          style={{ background: 'rgba(6,182,212,0.12)' }}>
                          <Icon size={16} className="text-cyan-400" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-white">{title}</h3>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-500">{desc}</p>
                        </div>
                      </div>
                    </Reveal>
                  )
                })}
              </div>
            </div>

            <Reveal delay={200}>
              <div className="relative">
                <div className="pointer-events-none absolute -inset-10 -z-10 opacity-60">
                  <TechGrid opacity={0.12} />
                </div>
                <DemoChat copy={t.demo.chat} />
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ─── DOR / AGITAÇÃO ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
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
                    <div key={title} className="rounded-2xl border border-red-500/15 p-5 transition-all hover:-translate-y-0.5 hover:border-red-500/30"
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
          </Reveal>
        </div>
      </section>

      {/* ─── NOSSA HISTÓRIA ─── */}
      <section id="historia" className="relative overflow-hidden py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
            <Reveal>
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.story.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">
                {t.story.titleA}<br />
                <span style={{ background: 'linear-gradient(135deg, #f59e0b, #22d3ee)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {t.story.titleB}
                </span>
              </h2>
              <div className="mt-6 space-y-4 text-base leading-relaxed text-zinc-400">
                <p>{t.story.p1}</p>
                <p>{t.story.p2}</p>
                <p>{t.story.p3}</p>
              </div>
            </Reveal>

            {/* Logo da Alizo sobre fundo tecnológico — visual da marca */}
            <Reveal delay={150}>
              <div className="relative overflow-hidden rounded-3xl border border-white/10 p-10"
                style={{ background: 'linear-gradient(160deg, #0b1220 0%, #070b12 100%)', minHeight: '340px' }}>
                <TechGrid opacity={0.22} />
                <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30"
                  style={{ background: 'radial-gradient(circle, #06b6d4 0%, transparent 70%)', filter: 'blur(50px)', animation: 'alz-pulse 5s ease-in-out infinite' }} />
                <div className="relative flex h-full min-h-[260px] flex-col items-center justify-center gap-6">
                  <div style={{ animation: 'alz-float 7s ease-in-out infinite' }}>
                    <img src="/branding/alizo-logo.png" alt="Alizo" className="h-14 w-auto" />
                  </div>
                  <div className="flex items-center gap-2 rounded-full border border-cyan-500/25 px-4 py-1.5"
                    style={{ background: 'rgba(6,182,212,0.08)' }}>
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
                    </span>
                    <span className="text-[11px] font-bold text-cyan-300">{t.story.hq}</span>
                  </div>
                  <p className="font-mono text-[10px] tracking-[0.2em] text-zinc-600">{t.story.coords}</p>
                </div>
              </div>
            </Reveal>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
            {t.story.milestones.map(({ tag, title, desc }, i) => {
              const Icon = milestoneIcons[i]!
              return (
                <Reveal key={title} delay={i * 130}>
                  <div className="h-full rounded-2xl border border-white/10 p-6 transition-all hover:-translate-y-1 hover:border-cyan-500/30"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="flex items-center justify-between">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl"
                        style={{ background: 'rgba(6,182,212,0.12)' }}>
                        <Icon size={16} className="text-cyan-400" />
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">{tag}</span>
                    </div>
                    <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── COMO FUNCIONA ─── */}
      <section id="como-funciona" className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
            <div className="mb-14 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.how.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">
                {t.how.titleA}<br />
                <span style={{ color: '#22d3ee' }}>{t.how.titleB}</span>
              </h2>
            </div>
          </Reveal>

          <div className="relative grid grid-cols-1 gap-6 md:grid-cols-4">
            {t.how.steps.map(({ title, desc }, i) => (
              <Reveal key={title} delay={i * 110}>
                <div className="relative h-full">
                  {i < 3 && (
                    <div className="absolute right-0 top-8 hidden h-px w-full translate-x-1/2 border-t border-dashed border-white/10 md:block" />
                  )}
                  <div className="relative h-full rounded-2xl border border-white/10 p-6 transition-all hover:-translate-y-1 hover:border-white/20"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    <div className="text-4xl font-black" style={{ color: stepColors[i], opacity: 0.4 }}>
                      {`0${i + 1}`}
                    </div>
                    <h3 className="mt-3 text-sm font-black text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>

          {/* Destaque: a entrevista de contratação (feature real do produto) */}
          <Reveal delay={200}>
            <div className="mt-10 overflow-hidden rounded-3xl border border-cyan-500/25 p-8 md:p-10"
              style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(6,9,15,0.4) 100%)' }}>
              <div className="flex flex-col gap-6 md:flex-row md:items-center">
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl"
                  style={{ background: 'linear-gradient(135deg, #06b6d4, #4361ee)', boxShadow: '0 8px 24px rgba(6,182,212,0.35)' }}>
                  <MessageSquare size={22} className="text-white" />
                </div>
                <div>
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide"
                    style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
                    {t.how.highlight.tag}
                  </span>
                  <h3 className="mt-2 text-xl font-black text-white">{t.how.highlight.title}</h3>
                  <p className="mt-2 max-w-3xl text-sm leading-relaxed text-zinc-400">{t.how.highlight.desc}</p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ─── FUNCIONÁRIOS DIGITAIS ─── */}
      <section id="funcionarios" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-14 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.team.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">
                {t.team.titleA}<br />{t.team.titleB}
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.team.members.map(({ key, name, ready, desc }, i) => {
              const Icon = TEAM_ICONS[key as keyof typeof TEAM_ICONS]
              return (
                <Reveal key={key} delay={i * 90}>
                  <div
                    className="relative h-full overflow-hidden rounded-2xl border p-6 transition-all hover:-translate-y-1"
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
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── BENEFÍCIOS ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-14 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.benefits.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">
                {t.benefits.titleA}<br />{t.benefits.titleB}
              </h2>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {t.benefits.cards.map(({ title, desc, badge }, i) => {
              const Icon = benefitIcons[i]!
              const color = benefitColors[i]!
              return (
                <Reveal key={title} delay={(i % 3) * 100}>
                  <div className="group relative h-full overflow-hidden rounded-2xl border border-white/10 p-6 transition-all hover:-translate-y-1 hover:border-white/20"
                    style={{ background: 'rgba(255,255,255,0.03)' }}>
                    {badge && (
                      <span className="absolute right-4 top-4 rounded-full px-2.5 py-0.5 text-[10px] font-black"
                        style={{ background: 'rgba(6,182,212,0.15)', color: '#22d3ee' }}>
                        {badge}
                      </span>
                    )}
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl transition-transform group-hover:scale-110"
                      style={{ background: `${color}18`, boxShadow: `0 4px 12px ${color}20` }}>
                      <Icon size={18} style={{ color }} />
                    </div>
                    <h3 className="mt-4 text-sm font-black text-white">{title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-zinc-500">{desc}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── NÚMEROS / ECONOMIA ─── */}
      <section className="relative py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-12 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.numbers.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">
                {t.numbers.titleA}{' '}
                <span style={{ background: 'linear-gradient(135deg, #f87171, #f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                  {t.numbers.titleB}
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-sm text-zinc-400">{t.numbers.sub}</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.numbers.cards.map(({ value, label, sub }, i) => (
              <Reveal key={label} delay={i * 110}>
                <div className="h-full rounded-2xl border border-white/10 p-6 text-center transition-all hover:-translate-y-1 hover:border-cyan-500/30"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <p className="text-3xl font-black"
                    style={{ background: 'linear-gradient(135deg, #22d3ee, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                    {value}
                  </p>
                  <p className="mt-2 text-xs font-semibold text-zinc-300">{label}</p>
                  <p className="mt-1 text-[11px] text-zinc-500">{sub}</p>
                </div>
              </Reveal>
            ))}
          </div>

          <p className="mt-6 text-center text-[11px] text-zinc-600">{t.numbers.disclaimer}</p>
        </div>
      </section>

      {/* ─── ROI SECTION ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-5xl px-6">
          <Reveal>
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
          </Reveal>
        </div>
      </section>

      {/* ─── PLANOS / PRICING ─── */}
      <section id="planos" className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <Reveal>
            <div className="mb-14 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.plans.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black md:text-4xl">{t.plans.title}</h2>
              <p className="mt-4 text-zinc-400">{t.plans.sub}</p>
            </div>
          </Reveal>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {t.plans.items.map((plan, i) => (
              <Reveal key={plan.slug} delay={i * 120}>
                <PlanCard plan={plan} locale={locale} labels={t.plans} />
              </Reveal>
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
          <Reveal>
            <div className="mb-14 text-center">
              <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cyan-400">{t.faq.eyebrow}</p>
              <h2 className="mt-3 text-3xl font-black">{t.faq.title}</h2>
            </div>
          </Reveal>

          <div className="space-y-3">
            {t.faq.items.map(({ q, a }, i) => (
              <Reveal key={q} delay={i * 60}>
                <details className="group cursor-pointer rounded-2xl border border-white/10 p-5 transition-all hover:border-white/20"
                  style={{ background: 'rgba(255,255,255,0.03)' }}>
                  <summary className="flex items-center justify-between gap-4 text-sm font-black text-white marker:hidden list-none">
                    {q}
                    <ChevronDown size={16} className="flex-shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-4 text-sm leading-relaxed text-zinc-400">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="py-20">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <div className="overflow-hidden rounded-3xl text-center"
              style={{ background: 'linear-gradient(135deg, rgba(6,182,212,0.15) 0%, rgba(6,9,15,1) 100%)', border: '1px solid rgba(6,182,212,0.25)' }}>
              <div className="relative p-12 md:p-16">
                <div className="pointer-events-none absolute inset-0">
                  <TechGrid opacity={0.1} />
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
          </Reveal>
        </div>
      </section>

      {/* ─── FOOTER ─── */}
      <footer className="border-t border-white/[0.06] py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
            <div className="flex flex-col items-center gap-2 md:items-start">
              <img src="/branding/alizo-logo.png" alt="Alizo" className="h-6 w-auto" />
              <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                <MapPin size={11} className="text-cyan-500" />
                {t.footer.hq}
              </p>
            </div>
            <div className="flex items-center gap-6 text-xs text-zinc-500">
              <a href="#demo" className="hover:text-white transition-colors">{t.nav.demo}</a>
              <a href="#historia" className="hover:text-white transition-colors">{t.nav.story}</a>
              <a href="#como-funciona" className="hover:text-white transition-colors">{t.nav.how}</a>
              <a href="#planos" className="hover:text-white transition-colors">{t.nav.plans}</a>
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
    <div className={`relative flex h-full flex-col overflow-hidden rounded-3xl transition-all hover:-translate-y-1 ${
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
