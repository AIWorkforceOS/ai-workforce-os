// Teste ponta a ponta do modo offline em um Chrome REAL (headless, perfil temporário — não toca no seu Chrome).
// Uso: pnpm --filter web build && (cd apps/web && pnpm exec next start -p 3101 &) ; node tools/pwa-offline-e2e.mjs
// Ele registra o Service Worker, aquece o cache, semeia uma agenda no IndexedDB, DERRUBA o servidor e confere que o portal abre offline.
import { spawn, execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://localhost:3101'
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const profile = mkdtempSync(join(tmpdir(), 'alizo-e2e-'))
const chrome = spawn(chromePath, ['--headless=new', '--remote-debugging-port=9333', '--remote-allow-origins=*', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=420,900', 'about:blank'], { stdio: 'ignore' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let targets
for (let i = 0; i < 40; i++) { try { targets = await (await fetch('http://localhost:9333/json')).json(); if (targets.length) break } catch {} await sleep(250) }
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0; const pending = new Map()
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
const send = (method, params = {}) => new Promise((resolve) => { const i = ++id; pending.set(i, resolve); ws.send(JSON.stringify({ id: i, method, params })) })
const evalJs = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description ?? r.result }
const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2500) }
const log = (k, v) => console.log(k.padEnd(46), typeof v === 'string' ? v : JSON.stringify(v))
await send('Page.enable'); await send('Runtime.enable')

// 1) online: registra o SW e aquece a casca
await nav(`${BASE}/offline-app?to=/portal-funcionario`)
log('1. registra SW', await evalJs(`(async()=>{ const reg = await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'none'}); await navigator.serviceWorker.ready; if(!navigator.serviceWorker.controller){ await new Promise(r=>{navigator.serviceWorker.addEventListener('controllerchange',r,{once:true}); setTimeout(r,3000)}) } return {active: !!reg.active || !!navigator.serviceWorker.controller} })()`))
await nav(`${BASE}/offline-app?to=/portal-funcionario`) // já controlado: assets passam pelo SW
log('   aquece cache (casca + chunks)', await evalJs(`(async()=>{ const html = await (await fetch('/offline-app')).text(); const urls=[...new Set([...html.matchAll(/\\/_next\\/static\\/[^"'\\\\\\s)<>]+\\.(?:js|css)/g)].map(m=>m[0]))]; for(const u of urls) await fetch(u); const sh=await (await caches.open('alizo-shell-v1')).keys(); const st=await (await caches.open('alizo-static-v1')).keys(); return {chunks: urls.length, shell: sh.map(k=>new URL(k.url).pathname), staticCached: st.length} })()`))

// 2) semeia a agenda (como o portal faria online) no IndexedDB, nos mesmos stores do app
const appt = (id, num, status) => ({ id, unit_id: '11111111-1111-1111-1111-111111111111', starts_at: new Date().toISOString(), ends_at: new Date(Date.now()+3600e3).toISOString(), status: 'scheduled', address: '11098 Biscayne Blvd, Miami, FL', notes: 'Trocar lâmpadas do corredor', customers: { name: 'Loja Teste' }, services: { name: 'Manutenção' }, service_order_number: num, service_order_file_url: null, service_order_file_name: null, service_order_summary_pt: 'Resumo em português da ordem ' + num, service_order_scope_en: 'Replace hallway lights.', service_order_status: status, service_order_signed_by: null, service_order_signed_at: null, service_order_location_name: 'Store 42', service_order_signature_url: null, service_order_part_purchase_link: null, service_order_material_description: null, service_order_material_value: null, service_order_hours_needed: null, service_order_photos: [], trip_started_at: null, checked_in_at: null, work_ended_at: null })
const A1 = '639bfb55-2a72-4430-90ce-c4770431c30f', A2 = '94fd09d0-fd50-490c-b3a8-7d78d166e6d1'
const snapshot = { employeeId: 'emp-1', savedAt: Date.now() - 3600e3, appointments: [appt(A1, '161120-01', 'pending'), appt(A2, '159959-02', 'pending')], timezone: 'America/New_York', locale: 'pt', requiresCheckin: false }
log('2. semeia agenda no IndexedDB', await evalJs(`(async()=>{ const db = await new Promise((res,rej)=>{ const r = indexedDB.open('alizo-portal-funcionario',3); r.onupgradeneeded=()=>{ const d=r.result; for (const [n,k] of [['pending_service_order_saves','id'],['service_order_drafts','appointmentId'],['offline_snapshot','employeeId'],['meta','key']]) if(!d.objectStoreNames.contains(n)) d.createObjectStore(n,{keyPath:k}) }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) }); await new Promise((res,rej)=>{ const t=db.transaction(['offline_snapshot','meta'],'readwrite'); t.objectStore('offline_snapshot').put(${JSON.stringify(snapshot)}); t.objectStore('meta').put({key:'active_owner',employeeId:'emp-1'}); t.oncomplete=res; t.onerror=()=>rej(t.error) }); return 'ok' })()`))

// 3) DERRUBA o servidor = sem internet
execSync(`pkill -f "next start -p 3101" || true`); await sleep(1500)
let serverDown = false; try { await fetch(BASE + '/offline-app', { signal: AbortSignal.timeout(2000) }) } catch { serverDown = true }
log('3. servidor derrubado (sem internet)', serverDown)

// 4) abre o portal pela URL do ícone (start_url): SW deve redirecionar para a casca offline
await nav(`${BASE}/portal-funcionario`)
await sleep(2500)
log('4. URL final após abrir /portal-funcionario', await evalJs('location.pathname + location.search'))
log('   texto na tela (agenda offline)', (await evalJs('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 420))

// 5) abre a WO 161120-01 pelo caminho real da ordem
await nav(`${BASE}/portal-funcionario/ordem/${A1}`)
await sleep(2500)
log('5. URL final ao abrir a WO', await evalJs('location.pathname + location.search'))
const orderText = (await evalJs('document.body.innerText')).replace(/\s+/g, ' ')
log('   WO aparece / aviso dados locais', { temNumero: orderText.includes('161120-01'), avisoLocal: orderText.includes('dados locais'), dataSync: /\d{2}\/\d{2}/.test(orderText), escopo: orderText.includes('Replace hallway lights'), formulario: /fotos antes/i.test(orderText), assinatura: /assinou/i.test(orderText) })
log('   texto da WO', orderText.slice(0, 900))
// 5b) digita no formulário offline → o rascunho deve ir para o IndexedDB
log('5b. digita nome (rascunho)', await evalJs(`(async()=>{ const inp=[...document.querySelectorAll('input')].find(i=>/gerente/i.test(i.placeholder||'')); if(!inp) return 'campo não achado'; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(inp,'Maria Gerente'); inp.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,1500)); const db=await new Promise((res,rej)=>{const r=indexedDB.open('alizo-portal-funcionario',3); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)}); const all=await new Promise(res=>{const q=db.transaction('service_order_drafts').objectStore('service_order_drafts').getAll(); q.onsuccess=()=>res(q.result)}); return {rascunhos: all.length, nome: all[0]?.fields?.signedBy, dono: all[0]?.ownerId} })()`))
// 6) WO que nunca foi sincronizada
await nav(`${BASE}/portal-funcionario/ordem/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)
await sleep(2000)
log('6. WO NÃO sincronizada', (await evalJs('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 200))
// 7) tela de sincronização offline
await nav(`${BASE}/portal-funcionario/sincronizacao`)
await sleep(2500)
const syncText = (await evalJs('document.body.innerText')).replace(/\s+/g, ' ')
log('7. sincronização offline', { sinal: syncText.includes('Sem internet'), ordens: /Ordens disponíveis offline\s*2/.test(syncText), naoTrocarIcone: syncText.includes('Instalar a Alizo como app') })
// 8) grava um item na fila offline pelo próprio código do app (fluxo real de salvar sem internet), depois confere a fila
const queue = await evalJs(`(async()=>{ const db = await new Promise((res,rej)=>{ const r=indexedDB.open('alizo-portal-funcionario',3); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) }); const all = await new Promise(res=>{ const q=db.transaction('pending_service_order_saves').objectStore('pending_service_order_saves').getAll(); q.onsuccess=()=>res(q.result) }); return all.length })()`)
log('8. itens na fila (antes do teste de gravação)', queue)

ws.close(); chrome.kill()
