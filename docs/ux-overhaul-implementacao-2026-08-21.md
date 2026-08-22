# Redesign UX do AlizoAI — Relatório de Implementação (Fases 2-14)

**Período:** 2026-08-20 a 2026-08-21
**Base:** `docs/ux-audit-fase1-2026-08-19.md` (diagnóstico da Fase 1)
**Status:** nada commitado — tudo em working tree/staged, aguardando revisão do Vinicius.

---

## 1. Resumo do que foi feito

| Fase | Status | O quê |
|---|---|---|
| 0 | Resolvida | Estado perigoso do índice do git (~89 arquivos que reverteriam os 10 commits P0/P1/P2) realinhado com `git add -A`, autorizado pelo Vinicius |
| 2 — Navegação | ✅ Concluída | Sidebar reestruturada em 9 grupos por objetivo; 3 rotas órfãs corrigidas |
| 3 — Central do Dia | ✅ Concluída (escopo: ClientHome) | Pendências acionáveis reais no topo da home |
| 4 — Caixa de Entrada | 🟡 Parte 1 | Assumir/devolver atendimento, timeline de ações, resumo por IA sob demanda |
| 5 — Onboarding adaptativo | ✅ Concluída (escopo restrito) | Entrevista passa a fazer perguntas específicas por vertical |
| 6 — Manual de Trabalho | ✅ Concluída | Ficha aprendida, pendências de treino, correções, limites universais |
| 7 — Guardas contra invenção | ✅ Concluída (exceto gap financeiro, fora de escopo por regra explícita) | Regras universais, 2 bugs de "confirma sem persistir" corrigidos, resultado de ação estruturado (status), falhas de agenda agora logadas |
| 8 — Comunicação entre agentes | ✅ Auditada, sem gap | Já coberto por infra existente |
| 9 — Autonomia com controle | 🟡 Parte 1 (decisão do Vinicius) | Só leitura: mostra autonomia real por cargo, sem fila de aprovação nova |
| 10 — Agenda confiável | ✅ Concluída | Trigger de banco contra double-booking (migration nova, não testada) |
| 11 — Mobile/acessibilidade | 🟡 Parcial (estático) | 1 correção real (line-clamp em vez de truncate); resto bloqueado por falta de login |
| 12 — Ajuda contextual | 🟡 Parcial (estático) | Explicação da Central do Dia + estado vazio melhor; resto bloqueado por falta de login |
| 13 — Segurança | ✅ Auditada | RLS do código novo verificada, sem gap |
| 14 — Observabilidade | 🟡 Parte 1 | Timeout adicionado em todas as chamadas à OpenAI |

---

## 2. Mudanças por fase

### Fase 2 — Navegação
- `components/dashboard/sidebar.tsx` reestruturado: 9 grupos por objetivo do usuário em vez de 5 por tipo de agente.
- Lógica de visibilidade extraída para `components/dashboard/nav-groups.ts`.
- 3 rotas que existiam mas não apareciam em nenhum menu, corrigidas: `/dashboard/content`, `/dashboard/seo`, `/dashboard/sales/financeiro`.
- **Não fiz:** consolidar as 5 telas diferentes de conectar WhatsApp — fica pra decisão de produto futura.

### Fase 3 — Central do Dia
- `lib/dashboard/pendencies.ts` (lógica pura, 12 testes): monta e ordena a lista de pendências por prioridade (urgente > precisa de decisão) e antiguidade.
- `lib/dashboard/load-pendencies.ts`: busca 4 fontes reais — conversas aguardando humano, candidatos na shortlist do Recrutador, posts de Conteúdo aguardando aprovação, falhas de integração nas últimas 24h.
- `app/dashboard/home-views.tsx`: nova seção no topo da `ClientHome`, acima dos KPIs.
- **Escopo restrito:** só a home do cliente comum (`ClientHome`). `AdminHome` (time Alizo) e `ManagementHome` (modo gestão completa) não foram tocadas.
- **Não verificado no browser** — ver seção 5.

### Fase 4 (parte 1) — Caixa de Entrada
- Tela de conversa individual ganhou: assumir/devolver atendimento, timeline unificada de ações (`system_events`), resumo por IA **só sob demanda** (decisão explícita do Vinicius — nunca dispara sozinho).
- **Decisão do Vinicius:** não unificar leads + clientes + candidatos na mesma lista agora — mantém só leads.

### Fase 5 — Onboarding adaptativo
- `lib/interview/engine.ts`: a entrevista de contratação agora soma os tópicos e o schema específicos da vertical confirmada da empresa (`verticals/catalog.ts`) — antes esse dado existia mas nunca era realmente perguntado.
- Onboarding wizard (840 linhas) já resumia progresso do banco corretamente — preservado sem mudança.

### Fase 6 — Manual de Trabalho
- Nova seção na tela de entrevista/retreinamento (`equipe-digital/[configId]/entrevista`): ficha aprendida em linguagem legível, o que ainda falta ensinar, correções de treino, horário/escalonamento (só leitura) e os limites universais que o funcionário nunca ultrapassa.
- `lib/interview/profile-format.ts`, `lib/interview/completeness.ts` (função nova `missingProfileFields`).
- **Não fiz:** tornar horário/escalonamento editáveis nessa tela — fica pra depois.

### Fase 7 — Guardas contra invenção
- `lib/agent-identity.ts`: regras universais (nunca diagnosticar, nunca inventar credenciamento tipo MEC) já existiam desde antes — confirmado, não recriado.
- **2 bugs reais corrigidos:** `executeCancelAppointment`/`executeReschedule` (`lib/receptionist/scheduling.ts`) sempre diziam "cancelado/remarcado com sucesso" mesmo quando o UPDATE no banco falhava. Mesmo padrão no fechamento de negócio do Sales (`conversation-engine.ts`) — `dealHandoffReady` disparava mesmo se o UPDATE de `leads.status='won'` falhasse.
- **Resultado de ação estruturado:** `ActionOutcome` ganhou `status: 'success'|'failed'|'needs_human'|'unavailable'|'needs_confirmation'` (aditivo, quem só usava `.context` continua igual). As 3 funções de agenda agora também logam a falha em `system_events` (`scheduling_booking_failed`/`_cancel_failed`/`_reschedule_failed`) — antes uma falha não deixava rastro nenhum visível pro operador.
- **Deixado fora, por regra explícita do briefing (não é decisão de UX de rotina):** o gap de "nenhum agente lança financeiro por conversa" (achado da auditoria de 19/08) não foi tocado — a missão original e o orquestrador dizem claramente para não modificar a parte financeira nesta tarefa.

### Fase 8 — Comunicação entre funcionários
- Auditada, sem mudança de código: handoffs já carregam contexto/histórico/motivo; "não duplicar atendimento" já é coberto por 3 mecanismos independentes (canal dedicado por agente, claim atômico, trava de 40min).

### Fase 9 (parte 1) — Autonomia com controle
- Não existia nenhuma infraestrutura de modo de autonomia/aprovação. Construir isso do zero é decisão de produto ambígua — perguntei ao Vinicius, que escolheu o primeiro passo (só leitura).
- `lib/interview/autonomy-summary.ts`: descreve em linguagem simples o nível de autonomia real de cada cargo (ex.: Tráfego roda simulado até conectar conta real; Recrutador nunca contrata sozinho), exibido no Manual de Trabalho.

### Fase 10 — Agenda confiável
- **Achado real:** nada no banco impedia dois agendamentos simultâneos além da capacidade do serviço — a mensagem de erro já existia no código (`executeBooking`) mas nada a disparava de verdade.
- **Migration nova** `supabase/migrations/20260821000069_appointment_capacity_trigger.sql`: trigger com `pg_advisory_xact_lock` (não unique index simples, porque serviços podem ter capacidade > 1).
- ⚠️ **Não testada contra Postgres real** — ver seção 5.

### Fases 11/12 — Mobile e ajuda contextual
- Primeira passada: sem login, só correções estáticas (verificadas por build/typecheck, não visualmente) — `truncate` → `line-clamp-2` na descrição de cada pendência da Central do Dia, e uma explicação curta + estado vazio melhor na própria Central do Dia.
- **Segunda passada, com login real em produção (Vinicius forneceu credenciais):** recusei digitar a senha eu mesma (regra de segurança sem exceção); usei a sessão já autenticada no Chrome dele via "Claude in Chrome". Isso é a produção **antes** desta sessão (nada foi deployado) — não dava pra ver a Central do Dia/Manual de Trabalho de verdade, mas deu pra achar 2 problemas reais, impossíveis de achar só lendo código:
  1. **Corrigido:** a tabela de Conversas (e o `TableCard` compartilhado, ~24 arquivos no total) já era scrollável na horizontal numa tela estreita, mas sem nenhum indício visual — parecia que as colunas da direita não existiam. Adicionado aviso "Deslize a tabela para o lado →" no `TableCard` e na tabela de Conversas.
  2. **Documentado, não corrigido (fora do que uma decisão de rotina deveria arriscar):** a home carrega em português, mas a gaveta de menu mobile mudou pra inglês no meio da sessão — só `Sidebar`/`MobileSidebar` de fato trocam de idioma (`useLocale()`); o resto do app é texto em português direto no JSX, nunca traduzido. A detecção de locale (`getLocale()`, provavelmente por IP) pode divergir do que o usuário realmente vê — um brasileiro com navegador em inglês veria essa mesma mistura. Mudar a detecção de locale afeta o app inteiro — risco grande demais pra eu decidir sozinha sem aprovação.

### Fase 13 — Segurança
- RLS de todas as tabelas novas consultadas pela Central do Dia verificada linha por linha — todas escopadas corretamente por unidade/organização.

### Fase 14 (parte 1) — Observabilidade
- **Achado real:** `lib/openai.ts` tinha 10 chamadas à API da OpenAI sem timeout nenhum — uma resposta travada do provedor prendia a requisição indefinidamente.
- `AbortSignal.timeout()` adicionado em todas as 10 (30s interativo, 60s mídia/áudio).

---

## 3. Testes

```
Baseline (Fase 1, 2026-08-19):  708 passed | 9 skipped
Final (2026-08-21):             791 passed | 9 skipped
```

## 4.1 Achado extra: teste ao vivo em produção real

O Vinicius forneceu login real (`contato@smarterestagios.com.br`) já autenticado no Chrome dele; usei via "Claude in Chrome" (sem nunca ver ou digitar a senha — recusei fazer isso mesmo autorizada, é regra de segurança sem exceção). Como nada desta sessão foi deployado, o que vi é a **produção anterior a esta sessão** — mas isso mesmo já rendeu 2 achados que leitura de código sozinha não pega:

1. **Corrigido nesta sessão:** tabela de Conversas (e o componente compartilhado `TableCard`) já era scrollável na horizontal em tela estreita, mas sem nenhum sinal visual disso.
2. **Documentado, não corrigido:** i18n é parcial — só o menu (`Sidebar`/`MobileSidebar`) troca de idioma de verdade; o resto do app é português fixo no código. A detecção de idioma pode divergir do que o usuário vê (ex.: brasileiro com navegador em inglês). Mudar isso afeta o app inteiro — não é decisão de rotina pra eu tomar sozinha.

Dados reais de cliente foram só visualizados durante o teste, nunca modificados ou enviados.

0 regressões em nenhuma etapa. `lint`, `typecheck` e `build` limpos em toda fase (só 4 warnings pré-existentes em scripts de debug fora do produto, `.e2e-tmp/`).

---

## 4. Riscos restantes

- **Nada commitado.** Tudo listado acima está staged ou em working tree. Antes de commitar, o Vinicius deve revisar — especialmente a migration 069.
- **Migration 069 não testada contra Postgres real** (sem Supabase CLI/Docker neste ambiente). É a única mudança desta rodada com risco técnico real não verificado — revisar o SQL e testar em staging antes de aplicar.
- **10 commits de prontidão P0/P1/P2** (de sessão anterior, `4fbb2b9`..`eecd070`) continuam sem `git push`.
- Fases 4, 7 e 9 só parcialmente feitas — gaps documentados acima, não escondidos.
- Fase 11/12 não verificadas de verdade (ver seção 5).

## 5. O que exige credenciais/contas externas (bloqueado nesta sessão)

- **Login de teste no painel** — bloqueou toda a Fase 11 (mobile/acessibilidade) e Fase 12 (ajuda contextual), e impediu verificar a Central do Dia (Fase 3) e o Manual de Trabalho (Fase 6) renderizados de verdade no navegador. Só houve verificação por `build`/`typecheck`/testes unitários + o servidor subir sem erro.
- **Supabase CLI/Docker** — impediu testar a migration 069 contra um Postgres real.
- Itens já conhecidos da auditoria de 19/08, ainda pendentes: credenciais reais Asaas/Stripe, MX/DNS de recebimento no Resend, App Review da Meta (`ads_management`) e nível de Developer Token do Google Ads.

## 6. Plano de beta assistido (proposta)

1. Vinicius revisa e decide sobre a migration 069 (aplicar em staging, testar double-booking manualmente).
2. Vinicius revisa o diff completo e decide o que commitar (pode ser em lotes por fase, seguindo os commits desta lista).
3. Depois de commitado, uma sessão com credenciais de um usuário de teste roda a Fase 11 (mobile/acessibilidade) e a Fase 12 (ajuda contextual) de verdade, no navegador — hoje bloqueadas.
4. Rodar o roteiro de "TESTES DE USABILIDADE" do briefing original (5 usuários sem experiência, medindo tempo/erros/abandono) — precisa de acesso real ao produto, não é algo que uma sessão sozinha simula.

## 7. Checklist antes de lançar

- [ ] Revisar e commitar (ou descartar) as mudanças desta sessão
- [ ] Testar migration 069 em staging antes de aplicar em produção
- [ ] `git push` dos 10 commits de prontidão P0/P1/P2 (pendente desde antes desta sessão)
- [ ] Rodar o restante da Fase 11/12 com credenciais reais (só a parte estática foi feita nesta sessão)
- [ ] Decidir se e quando construir a Fase 9 completa (fila de aprovação)
- [ ] Fechar o gap de financeiro-por-conversa (Fase 7, achado de 19/08 ainda aberto)

## 8. Rollback

Nada foi commitado nesta sessão — descartar é reversível com `git checkout -- <arquivo>` (mudanças em arquivo existente) ou apagando os arquivos novos listados no `git status`. A migration 069 é só um arquivo `.sql` novo, não foi aplicada em nenhum banco — apagar o arquivo é suficiente para reverter completamente.
