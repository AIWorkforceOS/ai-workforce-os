# Piloto MAWI — Super Agente de Cotações: como funciona, como ligar, como desligar (19/10/2026)

**Estado: tudo implementado LOCALMENTE e testado; NADA novo foi publicado, aplicado no banco ou ativado.** O que já está em produção é só a infraestrutura inerte (migrations 093–097, cron por minuto).

## 1. Fluxo do técnico (dentro da WO)
1. Abre a WO → escolhe **Cotação** → fotografa o defeito (ideal: 5 fotos) → descreve em poucas palavras → toca em **Salvar ordem** (as fotos entram pela fila offline de sempre).
2. Aparece o painel **Super Agente de Cotações** → **Gerar Cotação com IA** (só começa no clique; antes disso o servidor confere descrição, fotos no Storage, permissões, unidade em modo ativo e o limite mensal).
3. O processamento roda **no servidor** (disparo imediato + cron por minuto): pode fechar o app. Estados: Preparando análise → Analisando fotografias → Identificando materiais → Pesquisando produtos → Calculando mão de obra → **Aguardando informações** / **Aguardando revisão do técnico** / Falha recuperável.
4. Se faltar dado crítico o agente **pergunta** (agrupado). O técnico responde com texto + foto (câmera ou galeria), ou "não tenho essa informação — continuar sem ela". A análise é refeita com a conversa e as fotos novas, gerando nova versão.
5. Relatório com 14 pontos (fatos × hipóteses × desconhecido; materiais com preço de compra/fornecedor/link/data/estado; equipe, tempo e horas-homem; ferramentas; alertas). O técnico **edita**, **solicita revisão à IA** ("a peça funciona, é só alinhamento", "reparar em vez de substituir", "dois técnicos porque a porta é pesada") ou **aprova e salva**.
6. **PDF técnico** na hora (sem preços de compra, tarifas, custo interno, margem ou lucro; preços de compra só com autorização do admin). Aprovar **não** conclui o serviço, não muda o status da WO e **nada é enviado ao cliente**.

## 2. O que o técnico vê e o que NÃO vê
Vê/edita: preços de COMPRA dos materiais, quantidades, subtotais, fornecedores, links, técnicos, tempo e horas-homem. Nunca vê: tarifa comercial, custo interno do técnico, margem, lucro, receita, preço faturado. Aplicado em **banco (tabelas admin-only + RLS), API (listas permitidas + detector de vazamento) e PDF** — testado com JWT reais (funcionário, admin da empresa, admin de outra empresa).

## 3. Limites de custo
US$ 0,60 por **cotação inteira** (diagnóstico + perguntas + revisões + buscas; um job por WO ⇒ nenhuma revisão reinicia o orçamento) e US$ 50/mês por empresa. Reserva do pior caso antes de cada chamada, três baldes (confirmado/ativo/não confirmado), reservas idempotentes, parada em 80% para etapas opcionais, esgotou ⇒ guarda o que tem, avisa o motivo e o técnico continua manualmente. Modelos: `gpt-6-luna` por padrão; `gpt-6.1-sol` só no diagnóstico quando a confiança vem baixa e há orçamento.

## 4. Painéis do administrador (vinny29lp@gmail.com — admin da organização Mawi Pro, identidade conferida no Supabase Auth)
- **Super Agente — Piloto MAWI** (botão "Super Agente" na Agenda): cotações por estado, tempo médio, diagnósticos corretos/parciais/incorretos, materiais/links pendentes, custo por cotação, consumo do mês, alertas; lista de cotações com detalhe completo (conversa, versões, custos, camada comercial, PDFs); avaliação humana por cotação; regra comercial (US$ 40/h cobrado e US$ 20/h pago são **dados cadastrados por você**, nunca código); **liga/desliga imediato** e escolha dos técnicos autorizados.
- **Consumo de IA**: crédito real (a OpenAI **não** tem API oficial de saldo pré-pago ⇒ "Saldo indisponível" + link do Billing; estimativa só se você informar crédito carregado e data), consumo real (Costs API com `OPENAI_ADMIN_KEY`), por agente, por cotação, por empresa, limite mensal, alertas, última atualização, status da integração. Sem recarga automática nem pagamentos.

## 5. Sequência de ativação (cada passo exige a sua autorização explícita)
| # | Passo | Quem | Reversível? |
|---|---|---|---|
| 1 | Aplicar a migration **098** no banco (aditiva; validada em transação desfeita) | assistente, com autorização | sim (rollback) |
| 2 | Push + deploy do código (cron já existe; sem a 098 o painel fica oculto, nada quebra) | assistente, com autorização | Instant Rollback |
| 3 | Teste de fumaça pós-deploy (agente ainda OFF) | assistente | — |
| 4 | **Cadastrar a regra comercial** (US$ 40/US$ 20) no painel | você (admin) | sim |
| 5 | Informar **quais 2 técnicos** participam (marcar no painel) | você | sim |
| 6 | **Lote pago 1** (sem pesquisa de preços) — ver §6, com teto e nº de casos | você autoriza | — |
| 7 | **Ativar o piloto** na unidade Mawi Pro (modo "ativo") | você | sim: "Desligar agora" |
| 8 | Lote pago 2 + ligar `QUOTE_PRICE_SEARCH_ENABLED=true` (pesquisa real de preços) | você autoriza | sim: variável |
| 9 | 7 dias de operação → relatório (acerto, problemas, custos, recomendações) | assistente | — |

**Desligar** (qualquer momento): botão **Desligar agora** no painel (unidade → off; análises em andamento são canceladas; nada se apaga; WOs/fotos/assinaturas/PDF/PWA/offline não dependem do agente) ou `QUOTE_TEAM_ENABLED=false` na Vercel.

## 6. Proposta do primeiro lote pago (para autorização — NADA foi executado)
- **Lote 1 — validar o pipeline sem busca de preços:** até **10 casos reais** (as próximas WOs com fotos de defeito) · modelos: `gpt-6-luna` (diagnóstico, materiais, mão de obra) com escalonamento para `gpt-6.1-sol` só em baixa confiança · **teto total US$ 3,00** (já protegido por US$ 0,60/cotação; esperado US$ 0,05–0,15 cada) · métricas: precisão, informação inventada, perguntas, tempo, custo.
- **Lote 2 — pesquisa real de preços (Home Depot, Lowe's, Grainger):** até **5 casos** · `web_search` da OpenAI (≈ US$ 10 por 1.000 buscas + tokens) · modelo `gpt-6-luna` · **teto total US$ 3,00** · confirma que a busca devolve links/preços verificáveis e que o esquema estrito funciona junto com a ferramenta (se não, plano B em 2 passos). Sem fornecedor pago externo.
Total máximo dos dois lotes: **US$ 6,00**.

## 7. Verificações que dependem de você / de um aparelho real
- **iPhone com conta de técnico**: fila offline (modo avião → salvar fotos e resposta → voltar a rede), reenvio de fotos já salvas (agora vira sucesso idempotente), rascunho de resposta preservado, PDF técnico. Roteiro: `docs/setup/roteiro-teste-upload-direto.md` + casos do painel do agente (responder com foto offline; fechar e reabrir o app durante o processamento).
- Confirmar os **2 técnicos** do piloto (hoje há 3 com login: Murilo, Vinicius Paiva e Edi Clau).
- Variáveis opcionais (você cria na Vercel): `OPENAI_ADMIN_KEY` (consumo real), `OPENAI_PREPAID_LOADED_USD` + `OPENAI_PREPAID_LOADED_AT` (estimativa de saldo), `OPENAI_LOW_CREDIT_USD` (alerta), `QUOTE_PRICE_SEARCH_ENABLED=true` (só no lote 2).
