'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, Copy, Download, Share, SquarePlus, TriangleAlert } from 'lucide-react'
import { detectInstallPlatform, type InstallPlatform } from '@/lib/portal-funcionario/install-platform'
import { isStandaloneDisplay } from '@/lib/portal-funcionario/offline-routes'
import { registerServiceWorker } from '@/lib/portal-funcionario/sw-register'

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

const PAGE_URL = 'https://www.alizoai.com/instalar'

/**
 * Instalação guiada. Android/Chrome: botão "Instalar agora" (um toque, pergunta nativa do celular).
 * iPhone: a Apple NÃO permite instalar por link — o único caminho é Compartilhar → Adicionar à Tela de Início;
 * aqui o passo a passo é mostrado em ordem, e avisa quando o link foi aberto dentro do WhatsApp/Instagram.
 */
export function InstallGuide() {
  const [platform, setPlatform] = useState<InstallPlatform | null>(null)
  const [installed, setInstalled] = useState(false)
  const [canPrompt, setCanPrompt] = useState(false)
  const [copied, setCopied] = useState(false)
  const promptRef = useRef<InstallPromptEvent | null>(null)

  useEffect(() => {
    setPlatform(detectInstallPlatform(navigator.userAgent))
    setInstalled(isStandaloneDisplay())
    void registerServiceWorker() // o Chrome só oferece "Instalar" com o Service Worker ativo
    const onPrompt = (event: Event) => {
      event.preventDefault()
      promptRef.current = event as InstallPromptEvent
      setCanPrompt(true)
    }
    const onInstalled = () => setInstalled(true)
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  async function installNow() {
    const event = promptRef.current
    if (!event) return
    await event.prompt()
    const choice = await event.userChoice
    if (choice.outcome === 'accepted') setInstalled(true)
    promptRef.current = null
    setCanPrompt(false)
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(PAGE_URL)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const card = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)' }
  const step = 'flex items-start gap-3 rounded-xl p-3 text-sm text-slate-200'

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 py-8" style={{ background: '#0a0f1e' }}>
      <div className="flex items-center gap-3">
        <img src="/pwa/icon-192.png" alt="Alizo" className="h-14 w-14 rounded-2xl" />
        <div>
          <h1 className="text-xl font-black text-white">Instalar a Alizo</h1>
          <p className="text-xs text-slate-400">Abre em tela cheia, funciona sem internet e envia sozinho quando a internet voltar.</p>
        </div>
      </div>

      {installed && (
        <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.35)' }}>
          <p className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 size={16} /> A Alizo já está instalada neste aparelho.</p>
          <a href="/portal-funcionario" className="w-fit rounded-xl px-4 py-2 text-sm font-black text-black" style={{ background: '#34d399' }}>Abrir minha agenda</a>
        </div>
      )}

      {!installed && platform === 'android' && (
        <div className="flex flex-col gap-3 rounded-2xl p-4" style={card}>
          {canPrompt ? (
            <button type="button" onClick={installNow} className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-4 text-base font-black text-black" style={{ background: '#22d3ee' }}>
              <Download size={18} /> Instalar agora
            </button>
          ) : (
            <p className="text-sm text-slate-200">
              Abra no <b>Chrome</b>, toque nos 3 pontinhos <b>⋮</b> e escolha <b>&quot;Instalar app&quot;</b> (ou &quot;Adicionar à tela inicial&quot;).
            </p>
          )}
          <p className="text-xs text-slate-400">Depois de instalar, abra o ícone, entre com seu login e toque em <b>Sincronização → Preparar para uso offline</b> (com internet).</p>
        </div>
      )}

      {!installed && platform === 'ios-inapp' && (
        <div className="flex flex-col gap-3 rounded-2xl p-4" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <p className="flex items-start gap-2 text-sm font-bold text-amber-200"><TriangleAlert size={16} className="mt-0.5 shrink-0" /> Você abriu dentro de outro aplicativo (WhatsApp, Instagram…). Ali não dá para instalar.</p>
          <p className="text-sm text-slate-200">Toque em <b>⋯ / compartilhar → &quot;Abrir no Safari&quot;</b>, ou copie o link e cole no Safari.</p>
          <button type="button" onClick={copyLink} className="flex w-fit items-center gap-2 rounded-xl px-4 py-2 text-sm font-black text-black" style={{ background: '#fbbf24' }}>
            <Copy size={14} /> {copied ? 'Link copiado!' : 'Copiar link'}
          </button>
        </div>
      )}

      {!installed && (platform === 'ios-safari' || platform === 'ios-other' || platform === 'ios-inapp') && (
        <div className="flex flex-col gap-2 rounded-2xl p-4" style={card}>
          <p className="text-sm font-black text-white">No iPhone são 3 toques (a Apple não permite instalar por link):</p>
          {platform === 'ios-other' && <p className="text-xs text-amber-200">Dica: se o menu abaixo não aparecer, abra esta página no <b>Safari</b>.</p>}
          <div className={step} style={{ background: 'rgba(255,255,255,0.04)' }}>
            <Share size={20} className="mt-0.5 shrink-0 text-cyan-300" />
            <span><b>1.</b> Toque no botão <b>Compartilhar</b> (quadrado com uma seta para cima, embaixo no Safari).</span>
          </div>
          <div className={step} style={{ background: 'rgba(255,255,255,0.04)' }}>
            <SquarePlus size={20} className="mt-0.5 shrink-0 text-cyan-300" />
            <span><b>2.</b> Role a lista e toque em <b>&quot;Adicionar à Tela de Início&quot;</b>. Deixe <b>&quot;Abrir como app&quot;</b> ligado.</span>
          </div>
          <div className={step} style={{ background: 'rgba(255,255,255,0.04)' }}>
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-300" />
            <span><b>3.</b> Toque em <b>Adicionar</b>. O ícone da Alizo aparece na sua tela inicial. Abra por ele, entre com seu login e toque em <b>Sincronização → Preparar para uso offline</b>.</span>
          </div>
          <p className="mt-1 text-xs text-amber-200">
            Já tem o ícone antigo da Alizo? Antes de trocar, abra <b>Sincronização</b> por ele e confirme que aparece <b>&quot;Pode instalar&quot;</b> em verde — assim nenhuma foto ou assinatura pendente fica para trás.
          </p>
        </div>
      )}

      {!installed && platform === 'desktop' && (
        <p className="rounded-2xl p-4 text-sm text-slate-200" style={card}>
          Esta página é para o celular. Abra <b>{PAGE_URL}</b> no iPhone (Safari) ou no Android (Chrome).
        </p>
      )}

      {platform === null && <p className="text-sm text-slate-400">Carregando…</p>}
    </main>
  )
}
