# Relatório do primeiro deploy controlado — 18/10/2026 (noite, horário de Phoenix)

Commit publicado: `3c5d384` em `main` (10 commits sobre `09e829c`). Deploy `dpl_3csZaBEPXe8f3JNfxo7DincnLy37` **READY** em ~1 min 15 s, promovido para `alizoai.com`/`www.alizoai.com`. Ponto de retorno: `dpl_HSPDTpgfxjcAwz16yhf2y2RN8Tvz` (commit `09e829c`). **Rollback não foi necessário.** Módulo desligado, 5/5 unidades `off`, nenhuma chamada à OpenAI, Fase 4 não iniciada.

## Antes do push
Lint raiz, `typecheck`, 1503 testes e `build` verdes numa cópia limpa do `HEAD` (0 arquivos sujos); só os commits aprovados saíram (nada de chat/tráfego/_tmp); correção isolada do lint do checkout (`3c5d384`).

## Verificações pós-deploy
| Item | Resultado |
|---|---|
| Plano/equipe | Painel Vercel da equipe `smarter1` mostra selo **Pro**; o cron por minuto foi aceito no deploy |
| Cron | Logs da Vercel: `GET /api/cron/quote-jobs` **200 a cada minuto**, disparado pela própria Vercel com o segredo real (etapas vazias ⇒ só pode ser o caminho "skipped"). Sondagens minhas sem segredo: 401 (esperado) |
| Autenticação | `/api/cron/quote-jobs`, `/api/quote-jobs/*` ⇒ 401 sem credencial; `CRON_SECRET` ativo em Production (cron real passa) |
| Logs | Console: Warning 0, Error 0, Fatal 0; nenhum 5xx; únicos 4xx = meus 401 de sondagem e 2 respostas 400 do reenvio idempotente do teste |
| Salvar WO (teste) | Ordem descartável `TESTE-DEPLOY-0001` (Mawi Pro, mar/2027): salvar fotos 200; finalizar com assinatura 200 (`completed`, assinante gravado) |
| Upload de foto e assinatura | 2 fotos (antes/depois) + assinatura gravadas, 3 arquivos no Storage, sem duplicidade; reenvio da mesma foto ⇒ 400 "Nenhuma foto para salvar" (comportamento antigo, sem duplicar) |
| PDF | Ordem de serviço 200 `application/pdf` 126 KB; relatório fotográfico 200 `application/pdf` |
| Relatório público | `/relatorio/<token>` 200, 2 imagens carregando (200) |
| PWA | `/offline-app` 200, `/manifest.webmanifest` 200, `/sw.js` 200 (sem mudança neste deploy) |
| Painel/agenda | dashboard e agenda da Mawi Pro carregam; busca por nº da ordem funciona |
| Integridade das WOs | Depois da limpeza: 121 ordens, 79 assinaturas, 18 mídias, 138 arquivos, hash das ordens `8084387a…` — **idêntico** à medição imediatamente antes do push; service_records 237, invoices 8 |
| Unidades / módulo | 5/5 `off`; `quote_analysis_jobs`, `quote_budget_reservations`, `quote_drafts` = 0 |
| Limpeza | Ordem de teste removida (linha e 3 arquivos pela API de Storage); 0 resíduos |

## Não executado (limite de acesso) — sugerido ao Vinicius
Fluxo do **técnico** (login de funcionário) e **fila offline** de ponta a ponta no celular: não uso credenciais de terceiros. Cobertos por 25 testes automáticos do `offline-sync` (incl. a correção deste deploy) e pelo roteiro `docs/setup/roteiro-teste-upload-direto.md` (casos 4.1–4.5: modo avião, retomada, app fechado, rascunho). O `sw.js` e a fila não foram alterados no deploy, exceto a correção do `AbortError`.
