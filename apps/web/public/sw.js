/*
 * Alizo AI — Service Worker (PWA de campo). Versão 1.
 *
 * O QUE FAZ (e só isto):
 *  1. Guarda o código do app (/_next/static/*, imutável por hash) e uma página-casca ESTÁTICA
 *     (/offline-app, sem dado de usuário) para o app abrir sem internet.
 *  2. Navegação do portal do funcionário: rede primeiro; se a rede falhar (offline ou >10s),
 *     redireciona para /offline-app?to=<caminho>, que monta a agenda/ordem a partir do IndexedDB.
 *
 * O QUE NUNCA FAZ:
 *  - Não guarda respostas de páginas logadas, de /api/*, de Supabase ou de qualquer outro domínio
 *    (nada privado em Cache Storage compartilhado).
 *  - Não intercepta POST/PATCH/DELETE: envio de fotos, vídeos, assinatura e marcos passa direto
 *    (a fila offline fica no IndexedDB, que este arquivo nunca toca).
 *  - Não força atualização: versão nova só assume quando o app avisa (sem itens pendentes).
 *
 * ROLLBACK: trocar este arquivo por um que chame self.registration.unregister() e apague os caches
 * "alizo-*" (ver docs/pwa/rollback.md) ou definir NEXT_PUBLIC_PWA_ENABLED=false (o app se desregistra).
 */
const VERSION = 'v1'
const STATIC_CACHE = 'alizo-static-' + VERSION
const SHELL_CACHE = 'alizo-shell-' + VERSION
const OFFLINE_ROUTE = '/offline-app'
const PRECACHE = [OFFLINE_ROUTE, '/manifest.webmanifest', '/pwa/icon-192.png', '/pwa/icon-512.png', '/pwa/apple-touch-icon.png', '/branding/alizo-icon.png']
const PORTAL_NAV_TIMEOUT_MS = 10000
const SHELL_NAV_TIMEOUT_MS = 4000
const STATIC_MAX_ENTRIES = 600

function isPortalPath(path) {
  return path === '/portal-funcionario' || path.indexOf('/portal-funcionario/') === 0
}

function withTimeout(promise, ms) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      reject(new Error('timeout'))
    }, ms)
    promise.then(
      function (value) {
        clearTimeout(timer)
        resolve(value)
      },
      function (error) {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

async function precache() {
  const cache = await caches.open(SHELL_CACHE)
  await Promise.all(
    PRECACHE.map(function (url) {
      return cache.add(new Request(url, { cache: 'reload' })).catch(function () {})
    }),
  )
}

async function trimStatic() {
  try {
    const cache = await caches.open(STATIC_CACHE)
    const keys = await cache.keys()
    if (keys.length > STATIC_MAX_ENTRIES) {
      await Promise.all(keys.slice(0, keys.length - STATIC_MAX_ENTRIES + 100).map(function (key) { return cache.delete(key) }))
    }
  } catch (e) {}
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response && response.ok && response.type === 'basic') {
    cache.put(request, response.clone()).then(trimStatic, function () {})
  }
  return response
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE)
  const hit = await cache.match(request)
  const refresh = fetch(request).then(function (response) {
    if (response && response.ok && response.type === 'basic') cache.put(request, response.clone())
    return response
  })
  if (hit) {
    refresh.catch(function () {})
    return hit
  }
  return refresh
}

const FALLBACK_HTML =
  '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Alizo</title></head>' +
  '<body style="background:#0a0f1e;color:#e2e8f0;font-family:system-ui,sans-serif;padding:24px"><h1 style="font-size:18px">Sem internet e o app ainda não foi preparado neste aparelho</h1>' +
  '<p>Conecte-se à internet e abra a Alizo uma vez para preparar o uso offline. Nada do que você salvou foi perdido.</p></body></html>'

async function shellNavigation(request) {
  const cache = await caches.open(SHELL_CACHE)
  try {
    const response = await withTimeout(fetch(request), SHELL_NAV_TIMEOUT_MS)
    if (response && response.ok && response.type === 'basic') cache.put(OFFLINE_ROUTE, response.clone())
    return response
  } catch (e) {
    const hit = await cache.match(OFFLINE_ROUTE)
    return hit || new Response(FALLBACK_HTML, { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })
  }
}

async function portalNavigation(request, url) {
  try {
    return await withTimeout(fetch(request), PORTAL_NAV_TIMEOUT_MS)
  } catch (e) {
    const target = OFFLINE_ROUTE + '?to=' + encodeURIComponent(url.pathname + url.search)
    return Response.redirect(new URL(target, self.location.origin).href, 302)
  }
}

self.addEventListener('install', function (event) {
  // sem skipWaiting aqui: a versão nova espera o app confirmar que não há itens pendentes
  event.waitUntil(precache())
})

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      const keep = [STATIC_CACHE, SHELL_CACHE]
      const names = await caches.keys()
      await Promise.all(
        names
          .filter(function (name) { return name.indexOf('alizo-') === 0 && keep.indexOf(name) === -1 })
          .map(function (name) { return caches.delete(name) }),
      )
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', function (event) {
  const data = event.data || {}
  if (data.type === 'SKIP_WAITING') self.skipWaiting()
  if (data.type === 'GET_VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION })
})

self.addEventListener('fetch', function (event) {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  const path = url.pathname
  if (path.indexOf('/api/') === 0 || path === '/sw.js') return

  if (request.mode === 'navigate') {
    if (path === OFFLINE_ROUTE) {
      event.respondWith(shellNavigation(request))
    } else if (isPortalPath(path)) {
      event.respondWith(portalNavigation(request, url))
    }
    return
  }

  if (path.indexOf('/_next/static/') === 0) {
    event.respondWith(cacheFirst(request))
    return
  }

  // casca e ícones (sem query: payloads RSC como /offline-app?_rsc=… não entram)
  if (url.search === '' && PRECACHE.indexOf(path) !== -1) {
    event.respondWith(staleWhileRevalidate(request))
  }
})
