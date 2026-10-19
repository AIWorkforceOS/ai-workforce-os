# (OBSOLETO — só histórico) Execução dos jobs compatível com o plano Hobby — o Vinicius confirmou Vercel e Supabase PRO em 18/10; vale `revisao-final-primeiro-deploy-controlado.md`

**Nada foi alterado** (nem `vercel.json`, nem rotas, nem crons existentes). Premissa de planejamento (decisão do Vinicius): plano **Hobby** até confirmar no painel. Requisitos: (1) disparo imediato após salvar; (2) recuperação agendada de jobs interrompidos; (3) **não depender do navegador aberto**; (4) não tocar nos crons existentes (Facil-IT e outros); (5) módulo continua desligado.

## 1. Por que o desenho atual não serve no Hobby
O `vercel.json` local já tem `/api/cron/quote-jobs` a cada minuto (`* * * * *`, commit local). No Hobby, cron só pode rodar **no máximo 1×/dia** (e sem hora exata dentro da janela, segundo a documentação da Vercel consultada em 17–18/10; reconfirmar no painel) — **um deploy com essa linha falharia**. Todos os crons de produção hoje são diários (o do Facil-IT é feito com várias entradas diárias), o que também sugere Hobby. **Esta linha precisa sair antes de qualquer push.**

## 2. Desenho proposto (3 camadas, nenhuma depende do navegador)
**Camada A — disparo imediato pelo SERVIDOR (no salvamento).** A rota que salva a ordem já cria o job depois de gravar (`maybeEnqueueQuoteAnalysis`). Passa a, em seguida, disparar o processamento com `waitUntil(fetch(POST /api/quote-jobs/{id}/run))`, autenticado por um segredo servidor-a-servidor (`QUOTE_RUNNER_SECRET`). É uma **invocação nova** com orçamento próprio de tempo (`maxDuration` 300 s, como as rotas atuais), não aumenta o tempo do salvamento e **não precisa do app aberto**: o salvamento chega ao servidor pela fila offline (já à prova de perda) e o servidor assume. Se o disparo falhar, o salvamento não é afetado (try/catch, como hoje).
**Camada B — continuação encadeada.** Se uma passada termina sem concluir (limite de 240 s por passada, espera de nova tentativa curta, etapa seguinte), a própria rota se re-dispara (profundidade máxima 6, só se há trabalho). Idempotente: lease + chave de idempotência já impedem duplicar.
**Camada C — recuperação agendada (rede de segurança).** Três opções, em ordem de recomendação:
1. **Supabase `pg_cron` + `pg_net` (recomendada, custo zero)**: a cada minuto o *banco* roda uma consulta barata ("existe job `queued/running` vencido e sem worker?") e **só se existir** faz um POST para `/api/cron/quote-jobs`. Sem job pendente = nenhuma chamada HTTP. Recuperação em ≤ ~1–2 min. Exige: habilitar as extensões `pg_cron` e `pg_net` (disponíveis neste projeto, hoje não instaladas), guardar o segredo no Supabase Vault e criar `QUOTE_RUNNER_SECRET` na Vercel (**eu não consigo criar variáveis na Vercel — 403**; seria ação sua).
2. **Cron diário da Vercel** (permitido no Hobby) trocando a linha por minuto por uma diária (ex.: `0 11 * * *`) em `/api/cron/quote-jobs`: recupera o que sobrou **uma vez por dia** (pode demorar até ~24 h). Não substitui a opção 1, só complementa.
3. **Varredura oportunista**: quando alguém salva uma ordem ou o admin abre a tela de cotações, o servidor verifica (consulta indexada) se há job vencido e dispara a recuperação, com limite de 1 verificação a cada 5 min. Em horário de trabalho recupera em minutos; sem nenhum acesso, não roda.
Recomendação: **A + B + C1 + C2**. Sem C1 (se não quiser ligar `pg_cron`): A + B + C2 + C3 (recuperação em minutos só com movimento no app; sem movimento, até 24 h).

## 3. Latência, confiabilidade e custo (honesto)
| Item | Com o desenho |
|---|---|
| Início da análise após salvar | ~1–3 s (nova invocação; pode ter partida a frio) |
| Duração de uma análise | diagnóstico 7–30 s por chamada (medido); pipeline completo estimado 1–4 min, dentro de 1–2 passadas de até 240 s |
| Recuperação de job interrompido | C1: ≤ ~1–2 min · C3: minutos, só com movimento · C2: até ~24 h |
| Se o técnico fecha o app | nada muda: o servidor já tem a ordem; o resultado aparece quando ele reabrir (a tela só consulta o estado) |
| Se o servidor/plataforma derruba a execução | `waitUntil`/encadeamento é "melhor esforço" (pode perder); o lease vence em 5 min e a camada C retoma **sem refazer etapas concluídas nem gastar de novo** (orçamento em 3 baldes, reservas idempotentes) |
| Garantia de entrega | **não é exatamente-uma-vez**: é "pelo menos uma vez" com idempotência (lease + chave + reservas) — pode tentar de novo, nunca cobra duas vezes a mesma reserva |
| Custo Vercel (Hobby) | poucas centenas de invocações/mês no piloto (≈30 cotações × 1 disparo + 1–3 passadas + consultas de estado): desprezível frente à cota incluída; reconfirmar cotas no painel. Tempo de espera por resposta da OpenAI não é CPU ativa |
| Custo Supabase | `pg_cron`/`pg_net` não têm cobrança adicional no plano atual; 1 consulta leve por minuto |
| Custo OpenAI | inalterado: tetos US$ 0,60/cotação e US$ 50/mês |
| **Aviso de plano** | O Hobby da Vercel é voltado a **uso pessoal/não comercial** (termos); o Alizo em produção para clientes pagantes tende a exigir Pro. Decisão de negócio do Vinicius — não bloqueia esta proposta |

## 4. O que muda quando for aprovado (nada disso foi feito)
- `vercel.json`: **remover** `* * * * *` de `/api/cron/quote-jobs` (obrigatório no Hobby); opcional: 1 entrada diária. **Nenhum cron existente é tocado.**
- `app/api/quote-jobs/[id]/run/route.ts`: aceitar também chamada servidor-a-servidor (cabeçalho com segredo, comparação em tempo constante), mantendo a checagem de acesso para usuários.
- Disparo após salvar (`server.ts`/rota de salvar): `waitUntil` do pacote `@vercel/functions` (Next 14 não tem `after` estável; pacote novo, pequeno e oficial).
- Encadeamento (camada B) e varredura oportunista (C3) com limites.
- Migration 098 (aditiva, **só com autorização**): `create extension pg_cron, pg_net` + job por minuto com a checagem "há job pendente?" + segredo no Vault.
- Variável `QUOTE_RUNNER_SECRET` na Vercel (ação do Vinicius) e o mesmo valor no Vault.
- Testes: simulação de queda no meio da passada (retomada sem refazer etapas nem cobrar duas vezes), concorrência dos disparos (3 jobs simultâneos máx.), e verificação de que, com o módulo desligado, nada dispara.
Tudo continua **inerte** enquanto o registro de etapas estiver vazio e as unidades em `off`.

## 5. Decisões que preciso do Vinicius
1. Aprovar o desenho A + B + C (e qual combinação de C: 1+2, ou 2+3 sem `pg_cron`).
2. Se C1: autorizar a migration 098 e criar `QUOTE_RUNNER_SECRET` na Vercel.
3. Autorizar a remoção da linha por minuto do `vercel.json` local (antes de qualquer push).
