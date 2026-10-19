# Revisão final — primeiro deploy controlado da infraestrutura do Super Agente (18/10/2026)

Premissa informada pelo Vinicius: Vercel **Pro** e Supabase **Pro**. Arquitetura simplificada: **cron por minuto da Vercel mantido** + **disparo imediato após salvar** + recuperação pelo cron. Migration 098 (`pg_cron`/`pg_net`) **não** será criada. Nenhuma arquitetura alternativa para Hobby (o documento `execucao-jobs-plano-hobby-proposta.md` fica só como histórico).
**Estado: NADA publicado.** Unidades em `off`, módulo desligado, etapas vazias (inerte), sem chamadas pagas.

## 1. O que foi revisado e corrigido nesta rodada
| # | Achado | Ação |
|---|---|---|
| 1 | **Não existia disparo imediato após salvar.** O "a tela chama" nunca foi construído (não há interface). Sem isso, só o cron (até ~1 min) processaria | Novo disparo **servidor→servidor**: após gravar a ordem e criar o job, `kickQuoteJob` chama `POST /api/quote-jobs/{id}/run` (em `waitUntil`, o salvamento não espera). A rota responde **202 na hora** e processa em segundo plano numa invocação própria (até 300 s). Não depende de navegador |
| 2 | **Risco de função cortada no meio**: o runner começava etapas até 240 s e uma etapa pode durar 90 s ⇒ 330 s > `maxDuration` 300 s | `ROUTE_TIME_BUDGET_MS = 180 s` nas duas rotas (cron e disparo): 180 + 90 = 270 s < 300 s |
| 3 | Autenticação do cron comparava string simples (`!==`) | `isRunnerAuthorized`: `Bearer <CRON_SECRET>` em **tempo constante**; sem `CRON_SECRET` ninguém passa (500 no cron, 401/usuário na rota); mesma regra para o disparo imediato (reaproveita o `CRON_SECRET` que os crons atuais já usam — **nenhuma variável nova**) |
| 4 | Texto/comentários do cron falavam em "gasto no pior caso" | Atualizado para "não confirmadas" |
Dependência nova: `@vercel/functions` (oficial; `waitUntil`; Next 14 não tem `after` estável). Só adições no `pnpm-lock.yaml`.

## 2. Autenticação do cron — conferido
- A Vercel envia `Authorization: Bearer ${CRON_SECRET}` automaticamente nos crons quando a variável existe; os crons atuais (Facil-IT, backup etc.) já dependem dela. **Não consigo ler as variáveis da Vercel (403)**: a confirmação prática é o primeiro disparo do novo cron após o deploy (200 `skipped` = segredo OK; 500 "CRON_SECRET não configurado" = faltou).
- Testes automáticos: segredo errado/ausente ⇒ 401; sem `CRON_SECRET` ⇒ 500 no cron e ninguém passa no disparo; com etapas vazias ou `QUOTE_TEAM_ENABLED=false` ⇒ responde sem tocar no banco.

## 3. Processamento com o app fechado — conferido (testes)
- Salvou e fechou: job criado ao salvar → concluído **só pelo cron** (`claimNext`), sem nenhuma chamada da tela.
- Rota de disparo com segredo: 202 na hora; conclui em segundo plano; **`getAppUser` nunca é chamado** (sem sessão).
- Função morreu no meio (lease vence): o cron seguinte retoma **sem refazer etapa gravada**; a chamada interrompida fica "não confirmada" (conta no teto, não vira gasto real, **sem cobrança em dobro**).
- Disparo imediato + cron ao mesmo tempo: só um processa (`completed` + `not_claimed`), etapas rodam uma vez.
- Travas preservadas: máx. 3 jobs rodando; 3 análises novas/ordem/dia; idempotência; tetos US$ 0,60 e US$ 50; reservas idempotentes.

## 4. Vinculação do projeto à equipe Vercel — o que dá para afirmar
- Projeto `ai-workforce-os` (`prj_5c4HSzTjUMVPB4K8lFzSj08kNWgz`) pertence à equipe `smarter1` (`team_OQB11EZpKT07eDrtokZzVLRZ`, nome "viniciusmfpaiva91-4931's projects") — **a única equipe visível** para a integração; repositório GitHub `AIWorkforceOS/ai-workforce-os`, branch `main` ⇒ **produção** (push em `main` = deploy automático); domínios `alizoai.com`, `www.alizoai.com`; último deploy READY (`dpl_HSPDTpgfxjcAwz16yhf2y2RN8Tvz`, commit `09e829c`).
- **O plano (Pro) não é verificável pela API**: cobrança responde "Plan not found" (404) e a listagem de variáveis dá 403. Verificação manual (1 minuto): Vercel → escopo **smarter1** → **Settings → Billing → Current plan = Pro**. O nome padrão da equipe é o de conta pessoal, então vale conferir mesmo.
- Rede de segurança do próprio deploy: se por engano fosse Hobby, a Vercel **recusa o deploy** por causa do cron por minuto e a produção continua no deployment anterior (comportamento da documentação; confirmar no painel se aparecer erro de cron).

## 5. O que será publicado (push em `main` = deploy de produção)
Commits locais à frente de `origin/main` (`09e829c`): 8 já feitos + o da rodada atual. Efeito em produção, com o módulo inerte:
1. **PWA/offline**: correção em `offline-sync.ts` (execução abandonada pelo vigia deixa de virar rejeição). Comportamento de dados inalterado.
2. **Salvar ordem** (`service-order/route.ts`): +1 chamada `maybeEnqueueQuoteAnalysis`, que **retorna na hora sem tocar no banco** enquanto `handlers.ts` estiver vazio (e `try/catch` total; nunca atrasa nem falha o salvamento).
3. **Rotas novas inertes**: `/api/quote-jobs/[id]` (GET estado), `/api/quote-jobs/[id]/run` (POST), `/api/cron/quote-jobs` — todas respondem 409/`skipped` sem tocar no banco.
4. **`vercel.json`**: +1 cron `* * * * *` em `/api/cron/quote-jobs` (22 no total; custo ≈ 43 mil invocações/mês, ≈ US$ 0,03, execução de milissegundos).
5. Dependência `@vercel/functions`; testes; scripts em `tools/`; docs. As **alterações locais não commitadas** (chat/tráfego e arquivos `_tmp_*`) **não entram** no push.
Verificado hoje: `tsc` limpo, lint limpo, **1512 testes passando (0 erros)**, `next build` OK.
O deploy **não ativa nada**: as 5 unidades seguem `off`, `QUOTE_STAGE_HANDLERS` vazio, nenhuma chamada à OpenAI.

## 6. Sequência do primeiro deploy controlado (quando o Vinicius autorizar push/deploy)
1. **Antes:** conferir no painel Billing = Pro; conferir que `CRON_SECRET` existe (Settings → Environment Variables); migrations 093–097 já aplicadas (feito); backup externo existente (feito); anotar o deployment atual como ponto de retorno: `dpl_HSPDTpgfxjcAwz16yhf2y2RN8Tvz`.
2. **Push** dos commits para `main` (só commits; sem os arquivos não commitados). Acompanhar o deploy até READY.
3. **Imediatamente depois (leitura/baixo risco):**
   - Vercel → Cron Jobs: 22 crons listados; rodar "Run" no `/api/cron/quote-jobs` ⇒ **200 `pipeline_not_ready_or_disabled`** (ou, no log, 1ª execução automática com 200).
   - Logs de runtime: nenhum erro novo; o cron por minuto aparece e termina em milissegundos.
   - **Teste de fumaça de WO** com uma ordem de teste (Mawi): salvar com foto + assinatura, finalizar, baixar PDF, abrir relatório; confirmar que contagens/hash não mudam além da própria ordem.
   - PWA: abrir `/portal-funcionario/sincronizacao` e confirmar "Nada pendente"; salvar offline→online de uma ordem de teste.
   - Banco: 5/5 unidades `off`, `quote_analysis_jobs` e `quote_budget_reservations` com 0 linhas.
4. **Rollback não destrutivo (qualquer momento):** Vercel → Deployments → promover `dpl_HSPDTpgfx…` (Instant Rollback; reverte código **e** o cron). Não há dado novo a desfazer (módulo inerte). Opcional: `QUOTE_TEAM_ENABLED=false` na Vercel.
5. **Parar.** Ativação (modo sombra, Fase 4) e chamadas pagas exigem autorizações separadas.

## 7. Riscos restantes
1. Plano/variáveis da Vercel não verificáveis por mim (conferência manual acima).
2. O disparo imediato usa o domínio da própria requisição; se uma ordem for salva por um endereço `*.vercel.app` protegido por SSO, o disparo falha **sem efeito** e o cron por minuto processa em até ~1 min.
3. `waitUntil`/cron da Vercel são "melhor esforço" (podem perder ou duplicar): coberto por lease, idempotência, retomada e reservas idempotentes (testado).
4. Cron por minuto passa a existir em produção (custo ≈ US$ 0,03/mês); sem etapas registradas ele não toca no banco.
5. Alertas antigos de segurança do Supabase continuam documentados e não alterados (`alertas-seguranca-supabase-2026-10-18.md`).
6. Fase 4 (etapas reais, interface do técnico, modo sombra) **não iniciada**; o diagnóstico real só roda depois dela e de nova autorização.
