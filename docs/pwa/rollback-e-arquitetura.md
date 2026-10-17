# PWA / modo offline — arquitetura, segurança e rollback

## Peças
| Peça | Onde | Função |
|---|---|---|
| Manifesto | `app/manifest.ts` | Nome "Alizo AI", standalone, cores da marca, ícones derivados do `icon.png` oficial (`public/pwa/`) |
| Service Worker | `public/sw.js` | Guarda só código (`/_next/static`) e a casca `/offline-app`; se a rede falha no portal, redireciona para `/offline-app?to=…` |
| Casca offline | `app/offline-app` + `components/portal-funcionario/offline-app.tsx` | Monta agenda/ordem/sincronização a partir do IndexedDB, com aviso de dados locais e data da última sincronização |
| Agenda local | IndexedDB v3 (`offline_snapshot`, `meta`) | Cópia de CONSULTA da agenda do técnico, gravada a cada visita online (`offline-snapshot-writer.tsx`, `/api/portal-funcionario/offline-snapshot`) |
| Fila/rascunhos | IndexedDB (`pending_service_order_saves`, `service_order_drafts`) | **Inalterados em estrutura**; só ganharam `ownerId` |
| Registro/atualização | `lib/portal-funcionario/sw-register.ts` | Registra o SW; versão nova só assume com a fila vazia |

## Regras de preservação (garantidas por código e testes)
- Logout, atualização do app e expiração do snapshot **nunca** apagam fila, rascunhos, fotos, vídeos, assinaturas nem marcos pendentes. Logout apaga **apenas** a agenda de consulta.
- Os 14 dias valem **só** para exibir a agenda guardada; não tocam em nada pendente.
- Isolamento por usuário: itens e rascunhos têm `ownerId`; a fila só envia os do usuário logado; rascunho de outro usuário não é exibido; ao entrar outro funcionário, a agenda de consulta do anterior sai do aparelho.
- Sem espaço: `addPendingSave` confere o espaço antes e devolve falha (a tela diz "sem espaço… nada foi salvo") — nunca um "salvo" falso.

## O que o Service Worker NÃO faz
Não guarda páginas logadas, `/api/*`, Supabase nem outro domínio; não intercepta POST/PATCH/DELETE; não força atualização; não mexe no IndexedDB.

## Rollback (do mais leve ao mais completo)
1. **Interruptor:** definir `NEXT_PUBLIC_PWA_ENABLED=false` na Vercel e redeployar → o app se desregistra e apaga só os caches `alizo-*` (nunca o IndexedDB).
2. **SW de autodestruição:** substituir `public/sw.js` por:
   ```js
   self.addEventListener('install', () => self.skipWaiting())
   self.addEventListener('activate', (e) => e.waitUntil((async () => {
     for (const n of await caches.keys()) if (n.startsWith('alizo-')) await caches.delete(n)
     await self.registration.unregister()
   })()))
   ```
   `sw.js` é servido com `Cache-Control: no-store`, então o aparelho pega a nova versão na próxima abertura.
3. **Reverter o commit** do PWA e publicar. O ícone instalado continua funcionando como atalho normal.
Nenhum desses passos apaga dados do IndexedDB (fila, rascunhos, agenda).
