'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/client'
import { PRIVACY_VERSION } from '@/lib/legal'

/**
 * Política de Privacidade — conteúdo PROVISÓRIO até revisão jurídica
 * final (mesma decisão de app/terms/page.tsx: infraestrutura pronta,
 * texto final substitui este rascunho sem novo desenvolvimento).
 */

const COPY = {
  pt: {
    title: 'Política de Privacidade',
    draftNotice:
      'Versão provisória — este texto ainda está em revisão jurídica e pode mudar antes do lançamento oficial. A infraestrutura de aceite (versionamento, registro auditável) já está ativa; o conteúdo final substitui este rascunho sem exigir novo desenvolvimento.',
    version: 'Versão',
    sections: [
      {
        h: '1. Quais dados coletamos',
        p: 'Dados da sua empresa e conta (nome, e-mail, telefone), dados de leads/clientes que você cadastra ou que seus funcionários digitais coletam, e conteúdo de conversas processadas pela plataforma para operar seus funcionários digitais.',
      },
      {
        h: '2. Como usamos',
        p: 'Para operar a plataforma, seus funcionários digitais de IA e as integrações que você conecta (WhatsApp, e-mail, redes sociais, plataformas de anúncio). Não vendemos seus dados a terceiros.',
      },
      {
        h: '3. Isolamento entre clientes',
        p: 'Os dados da sua organização são isolados dos de outras organizações na plataforma (multi-tenant), com controle de acesso por usuário e unidade.',
      },
      {
        h: '4. Seus direitos',
        p: 'Você pode solicitar acesso, correção ou exclusão dos dados da sua organização a qualquer momento, conforme a legislação aplicável (LGPD no Brasil).',
      },
      {
        h: '5. Contato',
        p: 'Dúvidas sobre privacidade: suporte@alizo.com.br.',
      },
    ],
  },
  en: {
    title: 'Privacy Policy',
    draftNotice:
      'Draft version — this text is still under legal review and may change before official launch. The acceptance infrastructure (versioning, auditable record) is already active; the final content will replace this draft without requiring further development.',
    version: 'Version',
    sections: [
      {
        h: '1. What data we collect',
        p: 'Your company and account data (name, email, phone), lead/customer data you enter or that your AI employees collect, and conversation content processed by the platform to run your AI employees.',
      },
      {
        h: '2. How we use it',
        p: 'To operate the platform, your AI employees, and the integrations you connect (WhatsApp, email, social media, ad platforms). We do not sell your data to third parties.',
      },
      {
        h: '3. Isolation between customers',
        p: 'Your organization\'s data is isolated from other organizations on the platform (multi-tenant), with access control by user and location.',
      },
      {
        h: '4. Your rights',
        p: 'You may request access, correction, or deletion of your organization\'s data at any time, subject to applicable law.',
      },
      {
        h: '5. Contact',
        p: 'Privacy questions: suporte@alizo.com.br.',
      },
    ],
  },
} as const

export default function PrivacyPage() {
  const locale = useLocale()
  const t = COPY[locale]

  return (
    <div className="min-h-screen" style={{ background: '#0a0f1e', color: '#fff' }}>
      <nav className="border-b border-white/[0.06] px-6 py-4" style={{ background: 'rgba(10,15,30,0.9)' }}>
        <div className="mx-auto flex max-w-3xl items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <img src="/branding/alizo-logo.png" alt="Alizo" className="h-7 w-auto" />
          </Link>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-black text-white">{t.title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {t.version}: {PRIVACY_VERSION}
        </p>

        <div className="mt-5 rounded-xl px-4 py-3 text-xs text-amber-400" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
          {t.draftNotice}
        </div>

        <div className="mt-8 space-y-6">
          {t.sections.map((s) => (
            <div key={s.h}>
              <h2 className="text-lg font-bold text-white">{s.h}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{s.p}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
