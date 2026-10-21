# Alizo × Mawi — análise da estrutura atual e plano para o atendimento em massa de Facilities (20/10/2026)

**Objetivo:** a Mawi Pro (laboratório do Alizo) atender novos clientes Facility em massa, com experiência perfeita do primeiro contato (CRM/CML) até o relatório, a cotação e o financeiro, com a marca da Mawi em todos os painéis. O que for feito aqui vira o modelo para os clientes Alizo colocarem a própria marca.

Dados reais da base em 20/10/2026 (produção): 4 organizações (Mawi Pro, Mawi Cleaning, Smarter Estágios, AlizoAI); usuários: 3 super_admin, 4 admin, 3 employee, **0 client**; 373 leads (358 novos, 15 em contato, 2 responderam); 121 ordens da Mawi Pro (92 vindas da Facil-IT, 22 manuais/PDF, 7 sem ordem).

## 1. O que já existe (e serve de base)
| Área | Estado hoje |
|---|---|
| Login e papéis | 5 papéis no código: `super_admin`, `admin`, `viewer`, `employee`, `client`. Dono de unidade = admin com `unit_id`. RLS por organização/unidade. |
| Criar usuário | `/api/admin/users` cria **admin/viewer** (+ e-mail de boas-vindas com link). Funcionário é cadastrado em `/dashboard/employees/new` com "cargo" e acesso ao Portal do Funcionário. |
| CRM | `/dashboard/crm`: funil com 6 etapas (Novo, Em Contato, Respondeu, Negociando, Convertido, Perdido), notas e conversão em cliente. Leads vêm de prospecção (Google Maps), formulários e CRM da Smarter. `conversations` guarda mensagens por canal. |
| Portal do cliente (Portal 360) | `role=client` + `client_company`: anexa PDF da ordem + dia solicitado, vê Agenda/Concluídas, detalhe com fotos, PDF e cotação (inglês). A ordem entra direto como agendada, com horário provisório. |
| Entrada de ordens no painel interno | Anexar PDF com leitura por IA, importação em lote de várias ordens, sincronização Facil-IT (6x/dia). |
| Agenda e técnico | Agenda, atribuição, Portal do Funcionário (PWA offline, fotos, vídeo, assinatura, check-in GPS), Sign Off em PDF, Super Agente de Cotações (piloto). |
| Financeiro | Faturas (PDF), operação de serviços, pagamento parcial à equipe, relatórios por profissional e mês. |
| Marca | `units.logo_url` e `email_accent_color`: usados em fatura PDF, e-mails e brand kit de conteúdo. |
| E-mail recebido | Webhook Resend/Svix existe, mas só para conversas de leads/agentes. |

## 2. Lacunas frente ao que você pediu
1. **Permissões por função.** Não existem papéis Financeiro, Comercial (CML), Operacional/Despacho, Técnico como perfis de acesso; só admin/viewer/employee/client. Não há tela "novo usuário" com escolha de função e módulos, nem matriz de permissões aplicada em menu, API e banco.
2. **CRM completo.** Faltam: agendar retorno (follow-up) com lembrete, tarefas, responsável pelo lead, linha do tempo única (notas, ligações, mensagens), anexos, datas importantes, filtro "meus leads" para o CML, métricas por vendedor, importação CSV.
3. **Portal exclusivo por cliente Facility.** Hoje é um único cliente ("360") fixo em constantes e **nenhum usuário client existe**. Faltam: cadastro do cliente + usuários dele, criar ordem **manual** (sem PDF) com **urgência, fotos e observações**, e o **aceite/recusa** do administrador antes de ir para a agenda e para o técnico (hoje entra direto), com aviso ao cliente.
4. **Visão completa do cliente.** Ver status, fotos, relatórios e cotações já existe parcialmente; falta o **financeiro do cliente** (faturas, pagamentos, extrato), sempre sem custo interno nem pagamento de técnico.
5. **Ordem por e-mail.** Não existe e-mail → ordem. O painel interno anexa PDF manualmente; falta endereço de recebimento, leitura do PDF anexo por IA e ordem criada como "aguardando aceite", com proteção contra duplicidade e spam.
6. **Marca da Mawi.** Os cabeçalhos do painel, do Portal do Funcionário e do Portal 360 usam a logo e as cores do Alizo fixas. Só fatura/e-mail usam a logo da unidade. Não há marca por organização reutilizável.

## 3. Plano em fases (cada fase = entregas pequenas, migration aditiva validada em transação desfeita, testes, deploy controlado)
- **Fase 1 — Marca Mawi (baixo risco, rápida).** Tabela/colunas de marca por organização (logo clara/escura, cor principal, nome exibido). Componente único de cabeçalho com a logo da organização nos painéis admin, funcionário e cliente. Estrutura e menus inalterados.
- **Fase 2 — Usuários e permissões.** Modelo de funções (Admin, Financeiro, Comercial/CML, Operacional, Técnico, Visualização, Cliente) + módulos por função; tela "Novo usuário" com função e módulos; guardas no menu, nas APIs e no banco (RLS). Ninguém perde acesso atual.
- **Fase 3 — CRM completo.** Funil configurável, follow-ups com lembrete, tarefas, responsável, linha do tempo, anexos, métricas, importação CSV; o CML só vê o que lhe cabe.
- **Fase 4 — Cliente Facility multi-cliente.** Cadastro do cliente e usuários dele; criar ordem por PDF **ou manual** (urgência, fotos, observações); fila "Aguardando aceite" no painel interno (aceitar/recusar com motivo) → agenda → técnico; avisos ao cliente.
- **Fase 5 — Financeiro do cliente.** Faturas, pagamentos e extrato por cliente, com função Financeiro.
- **Fase 6 — Ordem por e-mail.** Endereço de recebimento por cliente/unidade, leitura do PDF por IA, ordem "aguardando aceite", anti-duplicidade e limites de custo de IA.
- **Fase 7 — Marca completa para outros clientes Alizo.** Cores e logo em PDFs, e-mails e relatórios; auto-atendimento para a empresa trocar a própria marca.

## 4. Decisões necessárias antes de começar
1. **Sign Off em PDF:** é o formulário da 360 (modelo fixo, sem marca da Mawi por decisão anterior). Colocar a logo da Mawi nele altera um documento do cliente. Manter sem logo, ou só nos demais arquivos (faturas, relatórios, cotações)?
2. **Funções:** confirmar a lista (o que é "CML"? Comercial?) e quais módulos cada uma vê, principalmente quem enxerga valores financeiros.
3. **Aceite de ordem:** quem aceita (admin/operacional)? Haverá aceite automático para clientes de confiança? Ordens da Facil-IT continuam entrando sem aceite?
4. **Cliente e financeiro:** o cliente vê só o valor faturado e o status de pagamento (nunca custo interno nem pagamento do técnico). Confirma?
5. **Organização:** a estrutura nova vale para a Mawi Pro (Facilities) apenas, mantendo a Mawi Cleaning separada?

## 5. Riscos e cuidados
- Mudança de permissões toca RLS: cada migration é validada em transação desfeita com JWT reais (como feito na 098) e nenhuma conta atual perde acesso.
- E-mail em massa → ordens: limites de custo de IA, anti-spam e anti-duplicidade desde o primeiro dia.
- Marca por organização não pode vazar entre empresas (isolamento por organização).
- O Super Agente de Cotações ainda não rodou com IA real; o primeiro teste é prioridade e independe destas fases.
