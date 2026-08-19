'use client'

import Link from 'next/link'
import { useLocale } from '@/lib/i18n/client'
import { TERMS_VERSION } from '@/lib/legal'

/**
 * Termos de Uso — conteúdo PROVISÓRIO até revisão jurídica final (pedido
 * explícito: criar a infraestrutura/versionamento agora, sem inventar
 * texto jurídico definitivo). TERMS_VERSION (lib/legal.ts) é o que fica
 * registrado em legal_acceptances no momento do aceite — atualize a
 * versão sempre que o texto abaixo mudar de forma substantiva.
 */

const COPY = {
  pt: {
    title: 'Termos de Uso',
    draftNotice:
      'Versão provisória — este texto ainda está em revisão jurídica e pode mudar antes do lançamento oficial. A infraestrutura de aceite (versionamento, registro auditável) já está ativa; o conteúdo final substitui este rascunho sem exigir novo desenvolvimento.',
    version: 'Versão',
    sections: [
      {
        h: '1. Sobre este documento',
        p: 'Estes Termos de Uso regulam o acesso e uso da plataforma Alizo AI ("Alizo", "nós") pelo cliente ("você", "sua empresa"). Ao criar uma conta, você concorda com estes termos e com a Política de Privacidade.',
      },
      {
        h: '2. A conta e o acesso',
        p: 'O acesso é liberado imediatamente após o cadastro, com garantia de 7 dias. A cobrança do plano contratado segue as condições apresentadas no checkout no momento da contratação.',
      },
      {
        h: '3. Uso aceitável',
        p: 'Você é responsável pelo conteúdo enviado aos seus funcionários digitais (IA) e pelo uso que faz das integrações conectadas (WhatsApp, e-mail, redes sociais, plataformas de anúncio). O uso da plataforma para fins ilícitos, spam ou violação de direitos de terceiros não é permitido.',
      },
      {
        h: '4. Cancelamento',
        p: 'Você pode cancelar a qualquer momento, conforme descrito na garantia de 7 dias e nas condições comerciais do seu plano.',
      },
      {
        h: '5. Contato',
        p: 'Dúvidas sobre estes termos: suporte@alizo.com.br.',
      },
    ],
  },
  en: {
    title: 'Terms of Service',
    draftNotice:
      'Draft version — this text is still under legal review and may change before official launch. The acceptance infrastructure (versioning, auditable record) is already active; the final content will replace this draft without requiring further development.',
    version: 'Version',
    sections: [
      {
        h: '1. About this document',
        p: 'These Terms of Service govern access to and use of the Alizo AI platform ("Alizo", "we") by the customer ("you", "your company"). By creating an account, you agree to these terms and to the Privacy Policy.',
      },
      {
        h: '2. Your account and access',
        p: 'Access is granted immediately after signup, with a 7-day guarantee. Billing for your plan follows the terms shown at checkout at the time of purchase.',
      },
      {
        h: '3. Acceptable use',
        p: 'You are responsible for content sent to your AI employees and for how you use connected integrations (WhatsApp, email, social media, ad platforms). Using the platform for unlawful purposes, spam, or infringement of third-party rights is not allowed.',
      },
      {
        h: '4. Cancellation',
        p: 'You can cancel at any time, as described in the 7-day guarantee and your plan\'s commercial terms.',
      },
      {
        h: '5. Contact',
        p: 'Questions about these terms: suporte@alizo.com.br.',
      },
    ],
  },
} as const

export default function TermsPage() {
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
          {t.version}: {TERMS_VERSION}
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
