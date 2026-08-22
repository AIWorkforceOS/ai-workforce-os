# Fase 1 — Diagnóstico de Experiência (AlizoAI → "melhor equipe digital")

**Data:** 2026-08-19
**Escopo:** Diagnóstico apenas — nenhum código alterado nesta sessão.
**Baseline técnica estabelecida:** ver seção 0.

---

## 0. Baseline técnica (antes de qualquer mudança)

```
pnpm test        → 708 passed | 9 skipped  (85 arquivos de teste, 3 skipped)
pnpm run lint     → 0 erros, 4 warnings (todos em apps/web/.e2e-tmp/*, scripts
                    de debug de E2E fora do app, não é código de produto)
pnpm run typecheck → limpo, 0 erros
```

Este é o número real a usar como linha de base daqui pra frente (não o "591 testes"
citado em versões antigas do briefing — a suíte cresceu desde então).

### 0.1 — Achado urgente, fora do escopo de UX: estado do git precisa de decisão do Vinicius antes de qualquer nova mudança

O working tree está num estado misto perigoso, que já existia antes desta sessão
começar (não foi causado por ela — nenhum outro agente estava rodando nesta
sessão no momento em que foi observado):

- O **índice do git** (staged) tem ~89 arquivos marcados para deleção — exatamente
  o diff introduzido pelos 10 commits locais mais recentes (`4fbb2b9`..`eecd070`:
  payment provider, Termos/Privacidade, `legal_acceptances`, retry de enrichment,
  token de segurança do WhatsApp, 6 verticais novos, observabilidade). Se esse
  índice for commitado como está, ele reverte silenciosamente todo o trabalho de
  prontidão P0/P1/P2 feito nos últimos dias.
- Os **arquivos no disco continuam existindo** (aparecem como *untracked* nesses
  mesmos caminhos) e contêm a implementação real — por isso `pnpm test` acima
  passou normalmente (os testes leem o disco, não o índice).
- Combinação perigosa: se alguém rodar `git clean -fd` esses arquivos "novos"
  (untracked) somem de verdade; se alguém rodar `git commit` sem revisar, o
  histórico passa a mentir sobre o que está implementado.

**Não mexi nesse estado.** Recomendação: antes de iniciar a Fase 2, o Vinicius
(ou uma próxima sessão, com aprovação explícita) deve rodar `git status` e decidir
conscientemente — o conteúdo em disco é o correto (bate com os commits já
descritos no histórico), então o caminho mais provável é `git add -A` para
re-alinhar o índice, mas essa decisão não é técnica, é dele. Ver também a memória
`no-git-stash-with-concurrent-sessions` e `concurrent-session-autopush-gotcha` —
este repositório já teve incidentes de sessões concorrentes mexendo em git state.

---

## 1. O que já existe e funciona bem (não reconstruir)

Confirmado por leitura direta de código/schema (não documentação), consolidando os
dois diagnósticos já produzidos hoje pela sessão anterior
(`Alizo_Auditoria_Ponta_a_Ponta_19-08.docx`, `Alizo_Diagnostico_Gaps_19-08.docx`)
mais inspeção da árvore de navegação nesta sessão:

- **Provisionamento automático real**: checkout cria org + unit + Supabase Auth
  na hora, sem intervenção manual.
- **Entrevista de treinamento em linguagem natural**, sem campo técnico exposto,
  sempre fecha com pergunta aberta final.
- **Trava de ativação no banco** (`enforce_interview_before_activation`) —
  proteção real, não só de UI.
- **Retreinamento não destrutivo** — histórico anterior preservado.
- **Ações operacionais via extração estruturada** (`generateStructuredReply`):
  Recepcionista agenda/reagenda/cancela e cria cliente sozinha; Sales fecha
  negócio e atualiza perfil sozinho. É function-calling "artesanal" mas cumpre o
  papel.
- **RLS multi-tenant consistente** (26 migrations, helpers `can_access_unit` /
  `is_org_admin` / `is_org_member` reusados em todo o app).
- Os 10 commits locais (não pushed) já endereçam boa parte do que seria P0/P1 de
  confiança básica: payment gate deixou de bloquear cadastro sem processadora,
  Termos/Privacidade com aceite auditável, retry de enrichment, token no link
  público de WhatsApp, observabilidade de falhas silenciosas, pré-ativação para
  Tráfego/Conteúdo/SEO, 6 verticais novos.

**Implicação para as próximas fases:** a fundação funcional é sólida. O trabalho
daqui pra frente (Fases 2-14 do briefing) é predominantemente de **arquitetura de
experiência e coordenação**, não de reconstruir motor de conversação, agendamento
ou RLS.

---

## 2. Arquitetura de navegação atual — mapeamento e problemas

Fonte: `apps/web/src/components/dashboard/sidebar.tsx` (single source of truth da
navegação) + inspeção de `apps/web/src/app/dashboard/**/page.tsx`.

### 2.1 Estrutura hoje (5 grupos fixos, ~19 itens)

```
Principal            → Visão geral · Primeiros passos · Clientes (empresas)[super]
Funcionários digitais→ Contratar & ativar · AI Sales Rep · Recrutador · Tráfego · AI Receptionist
Seus clientes        → Conversas · Funil de vendas (CRM) · Contatos (leads) · E-mail marketing
Sua empresa          → Unidades · Operação de serviços · Canal de mensagens (SMS) ·
                        Equipe (pessoas) · Resultados · Cobranças[super] · Vendas Alizo[super] · Pagamentos[super]
+ grupo condicional "Gestão do dia a dia" (só se management_mode=full_management):
                        Clientes · Agenda · Operação & financeiro
```

### 2.2 Achados concretos

1. **Rotas órfãs, fora da navegação — achado novo desta sessão.**
   `/dashboard/content` e `/dashboard/seo` existem como páginas completas
   (`content/page.tsx`, `content/connect/page.tsx`, `seo/page.tsx`) mas **não têm
   nenhuma entrada no sidebar**. Só são alcançáveis por link direto ou passando
   pelo catálogo de contratação (`equipe-digital`). Um empresário que contratou
   Conteúdo ou SEO não tem como "achar" o funcionário depois — viola
   diretamente o critério de aceite #1 do briefing ("usuário novo entender a
   navegação sem explicação externa"). O funcionário "TI interno" (citado na
   memória do projeto) também não aparece no sidebar.

2. **Três telas competindo pelo mesmo conceito de "contato".**
   Conversas, Funil de vendas (CRM) e Contatos (leads) são três itens de menu
   separados no mesmo grupo, cada um mostrando uma fatia do mesmo funil
   (lead → conversa → oportunidade). Exatamente o padrão que o briefing pediu
   para consolidar. Nenhum dos três aponta pro outro contextualmente (não há,
   por ex., link "ver conversa" a partir de uma linha no funil).

3. **Agenda e Operação duplicadas por design, resolvidas só pela metade.**
   O código já tem um mecanismo de deduplicação: quando `management_mode` é
   `full_management`, o item "Operação" do grupo "Sua empresa" é filtrado pra não
   repetir o da "Gestão do dia a dia" (`sidebar.tsx:131`). Isso mostra que o time
   já reconheceu o problema — mas a solução é um `if` local, não uma
   arquitetura: "Agenda" no grupo condicional aponta pra `/dashboard/agenda`
   (hub multi-unidade) enquanto dono de unidade única é redirecionado pra
   `/dashboard/units/[id]/agenda/calendario` — dois destinos diferentes para o
   mesmo rótulo "Agenda", dependendo de um estado (`unitId`) que o usuário não
   vê. Mesmo padrão para "Operação".

4. **WhatsApp configurável em pelo menos 5 lugares diferentes**, sem um único
   dono: `units/[id]/page.tsx`, `units/[id]/agent/page.tsx`,
   `connect-whatsapp/[id]/page.tsx` (link público, sem login), `settings/page.tsx`,
   e o grupo aparece de novo em `messaging/connect` (que hoje é rotulado
   "Canal de mensagens (SMS)" mas historicamente cuidou de WhatsApp também — ver
   `copy-whatsapp-link.tsx`). Um usuário não técnico não tem como saber qual
   tela é "a" tela de conectar o WhatsApp da empresa.

5. **"Funcionários humanos" e "digitais" com nomenclatura ambígua.**
   O grupo "Sua empresa" tem "Equipe (pessoas)" (humanos, RH interno) ao lado de
   "Funcionários digitais" (outro grupo, IA). Nomes próximos o bastante pra
   confundir ("equipe" vs "funcionários" são sinônimos em português) — o
   briefing já havia identificado esse risco antes de eu olhar o código, e o
   código confirma.

6. **Menu muda com papel e modo, mas não com segmento (vertical).**
   O sidebar já varia por `role` (super_admin vê 4 itens extras) e por
   `management_mode` (grupo condicional). Não varia por vertical do negócio —
   um restaurante e uma consultoria de RH veem exatamente os mesmos rótulos
   genéricos ("Contatos (leads)", "Operação de serviços"), que é o oposto do
   "não parecer genérico" pedido no objetivo principal do briefing.

7. **Página inicial (`/dashboard`) é KPI-first, não tarefa-first.**
   `home-views.tsx` (769 linhas) e `management-home.tsx` (391 linhas) já
   implementam uma home rica, mas centrada em métricas financeiras (MRR
   recebido/pendente, faturas aguardando, a pagar à equipe) — não em uma lista
   de pendências acionáveis por prioridade (conversa aguardando humano, lead
   quente, candidato aguardando decisão, falha de WhatsApp, etc.) como a "Central
   do Dia" da Fase 3 do briefing pede. Não é um retrabalho do zero: é uma
   reestruturação de uma base que já existe e já busca os dados certos em boa
   parte (ex.: `teamPayPending`, `invoicesOutstanding` já existem como sinais).

### 2.3 Proposta de navegação simplificada (para validar na Fase 2, não implementada agora)

O esqueleto de 9 grupos sugerido no briefing é viável em cima do que já existe,
com estes mapeamentos diretos:

| Grupo novo | Absorve hoje |
|---|---|
| Início | `/dashboard` (redesenhado como Central do Dia — Fase 3) |
| Caixa de Entrada | Conversas + Funil (CRM) + Contatos (leads), unificados |
| Clientes e Vendas | Receptionist/customers + Sales/agents |
| Agenda e Operação | Agenda + Operação, com destino único resolvido no servidor (não dois hrefs por unitId) |
| Pessoas e Recrutamento | Employees + Recruiter |
| Marketing | Traffic + **Content (órfã)** + **SEO (órfã)** + Email marketing |
| Equipe Digital | Equipe-digital (contratar/ativar/treinar) |
| Relatórios | Results + Financial |
| Configurações | Settings + Units + WhatsApp (ponto único) |

---

## 3. Onboarding — estado atual

`onboarding/page.tsx` tem só 45 linhas (é um wrapper fino — a lógica pesada deve
estar num componente cliente não lido em profundidade nesta sessão). O que já
sabemos por memória/histórico: o onboarding decorativo de julho (`ux-audit-2026-07-14.md`,
P4 crítico — não persistia progresso, teste de conversa fake) foi substituído
num overhaul posterior (`ux-overhaul-2026-07-14.md` na memória — "onboarding
data-driven"). **Não está claro, sem ler o componente por completo, se o
onboarding hoje já varia por segmento** como a Fase 5 do briefing pede — os 3
Vertical Templates reais hoje (`cleaning_services`, `therapy_clinic`,
`general_maintenance`) sugerem que a infraestrutura de dado por vertical existe
(`catalog.ts`), mas o diagnóstico de gaps de hoje já apontou que
`interviewExtra.extraTopics` **não é consumido de fato pelas perguntas da
entrevista** — só afeta um score de completude. Ou seja: o onboarding *parece*
adaptativo (tem campo pra isso) mas a entrevista real ainda faz as mesmas
perguntas independente do segmento. Ação recomendada pra Fase 5: ler
`interview/engine.ts` a fundo antes de desenhar qualquer mudança.

---

## 4. Guardas contra invenção (Fase 7 do briefing) — estado observado

O diagnóstico de hoje já mapeou isso com profundidade maior do que eu
conseguiria em uma passada nova, então reaproveito sem duplicar trabalho:
guardrails de recrutamento já corrigidos (regex de promessa de contratação e
opt-out, commit `d73adbc`), mas **nenhum funcionário digital lança
entrada/saída financeira por conversa** — gap arquitetural total confirmado, e é
o oposto do que o objetivo do produto promete. Novo lead criado por iniciativa
própria do agente (fora dos pipelines batch) também não foi encontrado. Ambos
achados de hoje, credíveis, não re-verificados por mim nesta passada.

---

## 5. O que este diagnóstico NÃO cobriu (pendente para completar a Fase 1 antes de fechar)

Por orçamento de tempo desta sessão, os seguintes itens do checklist da Fase 1
do briefing ainda precisam de inspeção dedicada (recomendo uma sessão/subagente
por bloco, não tudo de uma vez):

- Fluxo real no navegador (screenshots desktop/mobile) — este diagnóstico foi
  100% leitura de código, não navegação real da aplicação.
- Estados vazios, de carregamento, sucesso e erro tela a tela.
- Acessibilidade (contraste, foco, labels, navegação por teclado).
- Portais externos (`/connect-whatsapp/[id]`, portal do cliente 360, página
  pública de vaga) — mapeados na memória do projeto mas não revisitados aqui.
- Experiência mobile real (resize + toque) — não testada nesta sessão.
- Conteúdo do onboarding wizard em profundidade (só o entry point foi lido).

---

## 6. Ordem recomendada para as fases seguintes

Não é uma reordenação do briefing — é uma sequência de execução que respeita
dependências reais encontradas no código:

1. **Resolver o achado 0.1 (git)** — bloqueia com segurança qualquer commit novo.
2. **Fase 2 (navegação)** antes da Fase 3 (Central do Dia) — a Central do Dia vai
   linkar para destinos que só existem se a navegação já estiver consolidada
   (ex.: não faz sentido a Central do Dia linkar pra 3 telas de contato
   diferentes).
3. **Fase 4 (Caixa de Entrada)** natural depois da Fase 2, já que ela literalmente
   fundir os 3 itens duplicados (Conversas/CRM/Leads) identificados na seção 2.2.
4. **Fase 7 (guardas contra invenção)** pode e deve ser paralela a qualquer
   fase de UI — é backend/prompt, baixo risco de conflito, e o gap financeiro
   já confirmado é sério o bastante para não esperar.
5. **Fase 5 (onboarding adaptativo)** depois de confirmar se `interview/engine.ts`
   precisa mudar (ver seção 3) — evitar tocar o engine duas vezes.
6. **Fases 6, 8, 9, 10** (treinamento, colaboração entre agentes, autonomia,
   agenda confiável) em seguida, nessa ordem, por serem incrementais sobre o que
   já existe.
7. **Fases 11-14** (mobile, ajuda contextual, segurança, observabilidade) como
   passada transversal final, tocando todas as telas já estabilizadas pelas
   fases anteriores — fazer antes seria retrabalho.

---

## 7. Itens que exigem decisão ou credenciais do Vinicius (não bloqueiam a Fase 1, mas bloqueiam fases futuras)

- Decisão sobre o estado do git (seção 0.1).
- Push dos 10 commits locais pendentes.
- Credenciais reais Asaas/Stripe para ativar cobrança de verdade.
- MX/DNS de recebimento no Resend + `RESEND_WEBHOOK_SECRET` em produção.
- Confirmação de App Review da Meta (`ads_management`) e nível de Developer
  Token do Google Ads, para validar o caminho de escrita real de campanhas.

---

## 8. Conclusão da Fase 1

Diagnóstico concluído com baseline técnica limpa (708 testes passando, lint e
typecheck sem erros) e mapeamento concreto de navegação com achados novos
(rotas órfãs de Conteúdo/SEO, WhatsApp em 5 lugares, home KPI-first em vez de
tarefa-first) somados aos dois diagnósticos funcionais já produzidos hoje. Não
implementei nenhuma mudança de código. Próximo passo recomendado: aprovação do
Vinicius sobre a ordem da seção 6 e resolução do achado 0.1 antes de iniciar a
Fase 2.
