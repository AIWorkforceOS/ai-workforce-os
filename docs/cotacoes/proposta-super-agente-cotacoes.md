# Alizo — Super Agente de Cotações para Facilities
## Proposta de arquitetura (Primeira Entrega) — 17/10/2026 — **Revisão 3** — arquitetura APROVADA (decisões finais parciais; ver §11)

> Nada foi implementado nem alterado no sistema para produzir este documento. Os preços e modelos da OpenAI abaixo vêm da documentação oficial consultada em 17/10/2026; custos por cotação são **estimativas por conta de tabela**, não medições — serão medidos nas Fases 8 e 9.

---

### Revisão 3 (17/10/2026) — decisões finais do Vinicius (mensagem recebida cortada na seção 2)
- **Arquitetura geral aprovada** (diagnóstico multimodal, materiais, fornecedores/preços, mão de obra, cálculos determinísticos, auditoria independente, revisão e aprovação humana, versões, integração com WO e documentos). Implementação **sobre o sistema atual**, sem reconstruir portal, fila offline, PWA nem Sign Off.
- **Teto de IA: US$ 0,60 por cotação** (todas as chamadas de IA + ferramentas de busca pagas) e **teto mensal inicial de US$ 50 por empresa** no piloto, com registro de custos. O sistema **não inicia chamada que possa ultrapassar o orçamento restante**; ao atingir o limite, preserva os resultados, indica o que ficou pendente e deixa o técnico continuar **manualmente**. Detalhe do mecanismo em §2.5.

**Continuação recebida (seções 3, 4 e início da 5; a mensagem foi cortada de novo em "Não exigir somente 2 fotos como…"):**
- **Regras comerciais da Mawi (seção 3):** cobra da Facilities 360 **US$ 40/h-homem** e paga aos técnicos **US$ 20/h-homem** — valores **exclusivamente administrativos**. Regras **configuráveis por empresa e, no futuro, por cliente; nada fixo no código**. Ainda não definidas e portanto **desligadas**: hora mínima (nenhuma regra automática), taxa de deslocamento (nenhuma cobrança automática), markup de materiais (não aplicar), impostos (não calcular sem configuração específica). **Precisão:** os cálculos mantêm alta precisão e o arredondamento monetário só acontece por regra financeira explícita. Nenhuma regra comercial é inventada para completar orçamento.
- **O que o técnico vê e edita (seção 4):** diagnóstico e evidências, fotos relacionadas, escopo, materiais/peças, quantidades e unidades, marcas/modelos/especificações, preços de compra estimados, subtotais e total de materiais, fornecedores, links reais, data e status da pesquisa, nº de técnicos, horas estimadas, horas-homem, justificativa técnica e pendências a confirmar. Pode editar materiais, quantidades, preços de compra, links, horas e nº de técnicos. **Nunca vê:** tarifa da 360, pagamento aos técnicos, custo interno de mão de obra, preço comercial, markup/margens, faturamento e lucro — **aplicado no backend, nas APIs e nas políticas de acesso** (já previsto em §2.4).
- **Fotos (seção 5, parcial):** padrão operacional de **5 fotografias por cotação**, com **exceções justificadas** quando o serviço não exigir tantas. **Não** exigir apenas 2 fotos (o texto cortou o complemento da frase). Detalhe em §2.6.

**PARTE 1 DE 3 recebida (seções 5, 6 e 7):**
- **5 Fotografias:** padrão 5 por cotação; exceção justificada; **nunca bloquear o salvamento da WO**; faltando evidência, a análise **solicita** fotos/etiquetas/medidas/modelos; **sem fotos**: só cotação manual ou organização do texto, **sem alegar diagnóstico visual** (a IA não pode dizer que "viu" algo que não tem foto).
- **6 Pesquisa:** pesquisa da OpenAI aprovada **inicialmente, depois de verificar o suporte real** (primeiro passo da Fase 4 = teste de suporte com a API real: modelo + `web_search` + filtro de domínios + citações, com resultado apresentado a você antes de construir em cima). Exibir material, quantidade, preço estimado de compra, fornecedor, **link específico**, data e status de verificação. **Nunca** inventar preço, SKU, estoque, link ou compatibilidade. **Fornecedor externo pago só com autorização expressa.**
- **7 Fluxo:** a análise assíncrona só começa **depois** de a descrição e as mídias estarem salvas no servidor; progresso e resultado abaixo do formulário; o técnico revisa e edita diagnóstico, materiais, preços de compra, links, horas e nº de técnicos; o sistema **recalcula os materiais**; o técnico **aprova a versão técnica** (histórico preservado); **versão aprovada nunca é sobrescrita**; offline: **analisar somente após a sincronização**.

**PARTE 2 DE 3 recebida (seções 8, 9 e 10):**
- **8 Permissões:** o **técnico responsável aprova a cotação técnica**; o **admin** pode solicitar correção, criar revisão e acessar dados financeiros internos. **Aprovação técnica ≠ aprovação comercial** (estados separados). Backend, APIs e RLS impedem o técnico de acessar tarifas, pagamentos, margens e faturamento; **preços de compra de materiais são permitidos**.
- **9 Documentos:** a cotação aprovada registra escopo, diagnóstico, fotos, materiais, quantidades, links, horas e técnicos. O **Sign Off não pode confundir orçamento com serviço executado**; **horas estimadas não substituem tempos reais** (estimado × real registrado pelo check-in ficam sempre rotulados à parte). **PDF técnico não mostra tarifas, pagamentos, margem nem lucro.** Preços de compra de materiais **só aparecem em documentos externos quando autorizados para o destinatário.** **Documento comercial é separado e gerado pelo admin.**
- **10 Piloto:** **modo sombra ≈ 2 semanas, só Mawi Pro**; **somente o admin vê as análises da IA** e o fluxo dos técnicos **permanece igual**; avaliar **30 casos reais** revisados por humano, **incluindo novos casos com fotos**; **sem aprovação automática**.

### Revisão 2 (17/10/2026) — correções do Vinicius incorporadas
1. **Visibilidade financeira (nova §2.4):** o técnico VÊ preços de compra dos materiais (unitário, subtotal, total de materiais, fornecedor, link, data) e a IA distingue **preço verificado** de **estimativa não confirmada**. O técnico **NÃO** vê: valor/hora cobrado da Facilities 360, valor/hora pago ao técnico, custo interno e preço de venda da mão de obra, markup, margens, faturamento e lucro. A cotação técnica mostra técnicos, horas de serviço e horas-homem, **sem nenhum valor monetário de mão de obra**.
2. **Teto de custo de IA + buscas pagas: US$ 0,60 por cotação** (antes proposto US$ 1,00).
3. Modelo de dados e rotas separados em duas camadas (técnico × comercial/admin) — §2.4 e §5.

---

## 1. Auditoria do que já existe

### 1.1 Cotação hoje
| Peça | Estado real |
|---|---|
| Entrada do técnico | Campo de texto livre ("Material necessário", em português) + **um** valor de material + **um** número de horas + **um** link de compra. Sem lista de itens, sem quantidades, sem técnicos. |
| IA da cotação | `lib/service-orders/quote-composer.ts`: pega só o texto + valor + horas + link e **reescreve** em inglês e português (`quote_en` / `quote_pt`). **Não vê fotos.** Não pesquisa peça, não calcula, não audita. Usa `gpt-4o-mini` via `chat.completions`, `response_format: json_object` (garante JSON válido, **não** o esquema). |
| Gatilho | `autoGenerateQuoteOnSave` roda dentro da rota PATCH ao salvar como cotação (síncrono, com service role) + botão manual no painel admin e no Portal 360. |
| PDF | `drawQuotePage` (página extra do Sign Off quando `service_order_status = 'quote'`): metade inglês / metade português, valor + horas + 1 link clicável. |
| Estados | `service_order_status`: pending / completed / quote. **Não existe** estado separado de "cotação aprovada tecnicamente" nem de "aprovada pelo cliente". |
| Dados reais | 20 cotações: 12 com texto de IA, 9 com valor, 5 com horas, 5 com link, **0 com fotos**. As fotos de cotação nunca foram usadas — a câmera/upload direto só ficou confiável agora. |

### 1.2 Integração OpenAI (`lib/openai.ts`, `lib/api-usage.ts`)
- `fetch` direto em Chat Completions; modelo padrão `gpt-4o-mini`; visão com **uma** imagem por chamada (`generateStructuredReplyFromImage`); sem Responses API, sem `web_search`, sem Structured Outputs com esquema.
- Registro de uso: `api_usage_events` (tokens + custo estimado por chamada, org/unit). A tabela de preços no código só conhece `gpt-4o-mini`, `gpt-4o` e embeddings — **desatualizada** para os modelos atuais.
- Sem limite de custo por cotação nem por empresa. Sem fila: tudo roda dentro da requisição.
- Gasto OpenAI real dos últimos 30 dias (todo o sistema): 210 chamadas, **US$ 3,12** (152 de texto, 58 de imagens de marketing).

### 1.3 O que NÃO existe e é pré-requisito
1. **Regras comerciais de cobrança.** Só existem `services.price` (catálogo da agenda) e `employees.default_pay` (o que se paga ao técnico). **Não há** valor/hora cobrado do cliente, hora mínima, taxa de deslocamento, markup de material, imposto nem regra de exibição de preço por cliente. O pedido diz "usar os valores configurados na Alizo": hoje não há nada a usar → precisa de uma tabela de regras (item 5) **e valores definidos por você**.
2. **Processamento assíncrono.** Os crons atuais são diários; as rotas mais longas têm `maxDuration` até 300 s. Não há fila de trabalhos.
3. **Itens estruturados** (material, quantidade, unidade, fornecedor, preço, link).

### 1.4 O que será reaproveitado sem reconstruir
Empresas/unidades e RLS, Portal do funcionário e página da ordem, formulário de cotação (continua existindo), fotos/vídeos e upload direto, Storage, fila offline e PWA (a intenção "pedir cotação" viaja nos campos da fila existente), assinatura, agenda, viagem/check-in, financeiro, Sign Off e `pdf.ts`, relatório fotográfico, `api_usage_events`, papéis admin/técnico/cliente (Portal 360).

---

## 2. Arquitetura proposta

### 2.1 Visão geral
```
 Técnico salva como COTAÇÃO (online ou fila offline)
          │  (PATCH existente — a fila já garante envio e idempotência)
          ▼
 Rota de salvar ordem ── confere mídia registrada ── cria JOB (idempotente) ── responde na hora
          │
          ▼                       dispara (não espera)                 rede de segurança
 quote_analysis_jobs  ◄────────  POST /api/quote-jobs/{id}/run  ◄──── cron a cada minuto
   (estado + etapa + tentativas)         (maxDuration 300 s, retoma de onde parou)
          │
          ▼  etapas com resultado gravado a cada passo (retomável)
 1 Diagnóstico visual → 2 Materiais → 3 Fornecedores/preços → 4 Mão de obra → 5 Custos (código) → 6 Auditor (regras + checagem independente)
          │
          ▼
 quote_drafts (versão editável) ── técnico revisa/edita (recalcula no servidor) ── APROVA ── versão imutável
          │                                                                             │
          ▼                                                                             ▼
 seção "AI Quotation Team" abaixo do formulário                          PDF: seção "Quotation Assessment"
```
- **Não são seis chamadas de IA.** Etapas 1, 2 e 4 são chamadas de modelo; 3 usa a ferramenta de busca; **5 é código**; 6 é código + (opcional) uma checagem de IA independente. Resultados são compartilhados via o próprio rascunho (sem reprocessar fotos).
- **Idempotência:** chave `(appointment_id, hash(notas + fotos registradas + regra comercial))`. Salvar duas vezes ou reenviar da fila não cria job duplicado.
- **Tentativas e prazos:** cada etapa tem timeout (60–90 s) e até 3 tentativas com espera; o job guarda `locked_until` (lease) para dois workers nunca rodarem o mesmo job; passou de 240 s, o worker devolve o job e o cron/cliente retomam.
- **IA nunca bloqueia o salvamento:** o job é criado depois do salvamento ter sucesso; qualquer falha deixa a cotação manual como está hoje.
- **Offline:** o campo `requestQuote` viaja no item da fila; só a rota do servidor (depois de confirmar o salvamento e as mídias) cria o job.
- **Reanálise:** novo job com `parent_job_id`; nunca sobrescreve rascunho aprovado (a aprovada é imutável; reanálise gera nova revisão em rascunho).

### 2.2 Feature flags e rollback
`units.quote_ai_team_enabled` (padrão **falso**, ligado só na Mawi Pro no piloto) + interruptor global `QUOTE_TEAM_ENABLED`. Desligado, tudo funciona como hoje (botão manual e texto de IA atuais). Modo **sombra** (Fase 8): roda em ordens reais, mas só o admin vê o resultado.

### 2.3 Fluxo de aprovação (resumo)
Aprovar = servidor valida permissão e campos → **recalcula** tudo → grava versão aprovada (copia o rascunho, congela) → guarda `ai_original` intocado e a lista de campos alterados pelo técnico → atualiza os documentos da ordem. Estado técnico (`draft / approved / superseded`) e estado comercial (`not_sent / sent / client_approved / client_rejected`) são **colunas separadas**.

### 2.4 Visibilidade financeira — duas camadas separadas

**Regra:** o que é *custo de compra de material* é camada **técnica** (visível ao técnico). O que é *dinheiro de mão de obra, markup, margem, faturamento e lucro* é camada **comercial** (somente administrador). As duas **nunca compartilham tabela, rota nem objeto de resposta**.

| Dado | Camada | Técnico | Admin |
|---|---|---|---|
| Material: nome, qtd, unidade, preço unitário estimado, subtotal, fornecedor, link, data da pesquisa, selo "verificado/estimativa" | Técnica | ver e **editar** | ver/editar |
| Total estimado de materiais (e quanto está verificado × estimado) | Técnica | ver | ver |
| Nº de técnicos, horas de serviço, horas-homem, tempo de deslocamento **(em horas, não em dinheiro)**, justificativa | Técnica | ver e editar | ver/editar |
| US$ 40/h-homem cobrado da 360 · US$ 20/h-homem pago ao técnico · custo interno da mão de obra · preço de venda da mão de obra · markup · margem · taxas/impostos comerciais · faturamento · lucro | **Comercial** | **nunca** (nem em resposta de API, nem no PDF, nem no log) | ver/editar |

**Como o backend garante isso (defesa em profundidade, não só "esconder na tela"):**
1. **Tabelas separadas.** Camada técnica: `quote_drafts`, `quote_items`, `quote_item_options`, `quote_labor_plan` (só horas/técnicos, **nenhuma coluna monetária de mão de obra**). Camada comercial: `quote_rate_cards` (inclui os US$ 40 e US$ 20) e `quote_commercial` (custo interno, preço de venda, markup, margem, impostos, totais comerciais). **RLS:** as duas tabelas comerciais **não têm policy de leitura para técnico** (só admin da empresa/unidade e super admin).
2. **Rotas separadas.** `/api/quote-drafts/...` devolve **apenas** a visão técnica, montada por um serializador de **lista permitida** (campo a campo, nunca `select *` nem espalhar a linha do banco). `/api/admin/quote-drafts/.../commercial` exige papel admin (verificado no servidor **e** pela RLS).
3. **A IA nunca recebe valores comerciais.** Valor/hora, markup e margem **não entram em nenhum prompt** (a IA só estima horas e técnicos; preços de material vêm da pesquisa). Assim também não podem vazar nos textos gerados em inglês/português.
4. **Cálculo comercial roda só no servidor, só no contexto admin.** Total técnico (materiais) ≠ total comercial. O recálculo na edição do técnico usa apenas a função de materiais.
5. **PDF por papel.** O "Quotation Assessment" que o técnico visualiza/baixa **não contém** nenhum campo comercial (o PDF já é gerado na rota com o usuário logado; ela passará a decidir o conteúdo pelo papel). A versão comercial (se houver) só é gerada para admin.
6. **Histórico por visibilidade.** `quote_events` tem `visibility` ('technician' | 'admin'); alterações de campos comerciais são sempre 'admin' e a RLS filtra.
7. **Trava de regressão em teste automático:** (a) o serializador técnico é testado com uma lista de chaves proibidas (`labor_rate`, `hourly`, `markup`, `margin`, `profit`, `billed`, `internal_cost`, `commercial`…) e com varredura dos valores 40/20; (b) teste de RLS simulando um técnico tentando ler `quote_rate_cards`/`quote_commercial` (deve falhar); (c) teste que gera o PDF como técnico e verifica ausência de qualquer valor comercial.

**Selos de preço (técnico vê):**
| Selo | Quando |
|---|---|
| ✔ **Verificado** (data/hora) | Página de produto com link validado + preço extraído da citação da própria fonte |
| ≈ **Estimativa não confirmada** | Preço de fonte secundária, de cache antigo, sem citação completa ou com link que não pôde ser conferido automaticamente |
| ✎ **Corrigido pelo técnico** | Valor editado manualmente (guarda o valor original da IA) |
| ⚠ **Pesquisa pendente** | Sem resultado confiável — sem preço (nunca inventado) |
O total técnico mostra a composição: ex.: *Total estimado de materiais US$ 53,00 (US$ 41,00 verificados + US$ 12,00 estimados)*; com item pendente, vira **parcial**.

**Exemplo (o seu):** Caulk 1 × US$ 4,00 + Tinta 1 gal × US$ 37,00 + Joint Compound 1 × US$ 12,00 = **US$ 53,00**; mão de obra aparece como "1 técnico · 3,0 h de serviço · 3,0 h-homem · deslocamento 0,5 h", **sem dinheiro**.

### 2.5 Controle de orçamento (por cotação e por empresa)
**Regra de ouro: reservar antes de gastar.** Nenhuma chamada começa sem reservar o **pior caso** dela no orçamento; se não couber, a chamada **não é feita**.
1. **Dois orçamentos medidos em dólares, a cada chamada:** (a) por cotação — `quote_analysis_jobs.budget_usd = 0,60`; (b) por empresa/mês — US$ 50 no piloto (soma do mês em `api_usage_events` com `metadata.job_id` + reserva dos jobs em andamento).
2. **Reserva (pré-checagem):** custo máximo da chamada = tokens de entrada medidos (imagens: tokens calculados pelo tamanho; texto: contagem) × preço de entrada + `max_output_tokens` (sempre definido) × preço de saída + taxa fixa da busca (US$ 0,01) + tokens de conteúdo recuperado no pior caso (limite configurado por busca). Se `gasto + reservas + pior_caso > teto`, a etapa é **pulada** e marcada como pendente.
3. **Acerto:** ao fim da chamada, a reserva vira custo real (tokens reais da resposta) e o saldo volta ao orçamento. Cada chamada grava uma linha em `api_usage_events` (modelo, tokens, custo, `job_id`, etapa) — o custo da cotação é a soma, visível ao admin.
4. **Ordem de prioridade quando o orçamento aperta** (para gastar onde mais vale): diagnóstico → lista de materiais → busca dos itens mais caros/críticos primeiro → mão de obra → checagem extra do auditor. Etapas opcionais (buscas extras, segunda opinião) param em ~80% do teto; em 100% tudo para.
5. **Ao atingir o limite (cotação):** o job termina como **"necessita confirmação — orçamento de IA esgotado"**; guarda tudo que já foi produzido; lista exatamente o que ficou pendente (ex.: "3 itens sem pesquisa de preço"); o técnico completa **à mão** (preços, quantidades, horas) com a mesma tela e os mesmos cálculos. Reanálise manual só pode ser pedida se houver orçamento (novo job tem orçamento próprio de US$ 0,60, mas conta no teto mensal).
6. **Ao atingir o teto mensal da empresa:** novos jobs **não iniciam**; o técnico vê "Análise por IA indisponível este mês — continue manualmente"; o admin é avisado (e-mail/painel); a cotação manual e o salvamento da ordem **nunca** são afetados. O teto é editável só por administrador da plataforma.
7. **Sem chave/sem orçamento/OpenAI fora do ar** → mesmo caminho manual. Nenhuma dessas condições bloqueia salvar a ordem.
8. **Controles complementares de custo:** máx. de buscas por cotação (8–10), cache de produtos 7–30 dias, imagens redimensionadas antes de enviar, `max_output_tokens` em toda chamada, e **trava de repetição** (mesma entrada ⇒ mesmo job, sem gasto duplicado).

### 2.6 Regras comerciais configuráveis, precisão e fotos

**Regras comerciais (somente admin, por empresa; preparado para por cliente):**
- `quote_rate_cards` guarda, por `org_id` (e `client_company` opcional, para o futuro), com vigência e histórico: valor/hora cobrado (**inicialmente US$ 40**, cadastrado por admin na tela — nunca no código), valor/hora pago ao técnico (**inicialmente US$ 20**), e as regras opcionais **todas nulas/desligadas** de início: `min_billable_hours`, `travel_fee`, `materials_markup_pct`, `tax_rules`, `rounding_rule`.
- A função de custos **só aplica o que estiver configurado**: campo nulo = regra não existe (sem hora mínima, sem deslocamento, sem markup, sem imposto). Sem tarifa cadastrada, o valor comercial fica "não calculado" — nunca é completado com palpite.
- **Resolução da regra:** cliente específico > empresa; a versão usada fica gravada no job e na aprovação (auditável).
- O técnico não recebe nem a tabela nem os números derivados (§2.4).

**Precisão numérica:** valores monetários e horas em **decimal de alta precisão** (inteiros em micro-dólares / frações exatas, sem ponto flutuante). O sistema **não arredonda no meio do cálculo**; o arredondamento monetário só ocorre se existir `rounding_rule` explícita. A tela pode exibir 2 casas apenas como formatação, sem alterar o valor guardado nem os somatórios.

**Fotos — padrão de 5, com exceção justificada:**
- A tela de cotação pede **5 fotos** com guia do que cada uma deve mostrar (sugestão: 1 visão geral do local · 2 o problema de perto · 3 etiqueta/modelo/código · 4 contexto e acesso · 5 medida ou referência de escala).
- Com menos de 5, o técnico pode seguir **informando o motivo** (lista curta + texto livre, ex.: "serviço simples", "acesso limitado"); o motivo é gravado no job. Nunca se bloqueia o salvamento da ordem nem se exige um mínimo menor arbitrário (ex.: 2).
- A IA também pode pedir **fotos específicas adicionais** (etiqueta, medida) quando o diagnóstico depender delas. Sem foto nenhuma, a IA só reorganiza o texto, como hoje, e sinaliza a limitação.

---

## 3. Modelos OpenAI recomendados e custos (documentação oficial, 17/10/2026)

Preços por 1M de tokens (padrão, contexto curto):
| Modelo | Entrada | Saída | Posicionamento (doc oficial) |
|---|---|---|---|
| `gpt-6-luna` | $0,10 | $0,50 | alto volume, sensível a custo |
| `gpt-6.1-sol` | $2,00 | $10,00 | equilíbrio inteligência/custo, perto do topo |
| `gpt-6-astra` | $10,00 | $50,00 | mais capaz (raciocínio/código complexos) |
| `gpt-5.4-mini` | $0,75 | $4,50 | geração anterior |
| `gpt-4o-mini` (atual) | $0,15 | $0,60 | usado hoje |
Ferramenta `web_search` (Responses API): **US$ 10 por 1.000 chamadas** + tokens do conteúdo recuperado cobrados na taxa do modelo. Imagem: tokens por retalhos de 32×32 (ex.: 1024×1024 ≈ 1.229 tokens nos modelos novos).

**Recomendação em camadas (a confirmar por teste comparativo antes de adotar — não troco o modelo de produção sem isso):**
| Etapa | Modelo candidato | Por quê |
|---|---|---|
| Diagnóstico visual (várias fotos) | `gpt-6.1-sol` (comparar com `gpt-6-luna`) | Precisão visual e raciocínio importam mais aqui |
| Lista de materiais | `gpt-6-luna` | Tarefa estruturada, barata |
| Busca de produtos | `gpt-6-luna` + `web_search` | Custo dominante é a busca, não o modelo |
| Mão de obra (justificativa) | `gpt-6-luna` | Os números vêm das regras; o modelo só explica |
| Custos | **nenhum — código** | Aritmética nunca vai para IA |
| Auditor | **regras em código** + `gpt-6-luna` para checagem independente | Barato e independente |
Todos os modelos ficam em configuração (`quote_ai_models`), versionados e com troca por flag. Saídas com **Structured Outputs** (`json_schema`, `strict: true`) validadas no servidor (Zod). Dois pontos da documentação que preciso confirmar na Fase 2: suporte a Structured Outputs por modelo (a página de modelos não lista) e os limites do esquema.

---

## 4. Estratégia verificável de pesquisa de produtos

Princípio: **o modelo de linguagem nunca é a fonte de preço**. A fonte é uma ferramenta de busca; o servidor valida o resultado e rotula honestamente.

**Opções avaliadas**
| Opção | Prós | Contras / riscos | Custo |
|---|---|---|---|
| **A. OpenAI `web_search`** (Responses API, `filters.allowed_domains` até 100 domínios, citações `url_citation`, lista de fontes) | Sem novo fornecedor, dentro da conta OpenAI já usada, filtra por Home Depot/Lowe's/Grainger/Ace/fabricantes | Não é feed estruturado de preço; preço vem de trechos de página; **não verifica estoque**; o modelo pode pular a busca (usar `tool_choice: required`) | US$ 10/1.000 chamadas + tokens |
| **B. SerpApi (motor Home Depot)** | Dados estruturados (título, preço, id, link) para Home Depot | **Pago e exige sua aprovação**; planos citados por terceiros variam (≈US$ 25–75/mês) — **preço oficial não confirmado**; cobertura de Lowe's/Grainger não confirmada | a confirmar |
| **C. APIs oficiais** | Mais confiável e permitido | Home Depot: não achei API pública; Lowe's: portal de desenvolvedores citado por diretório (acesso não confirmado); Grainger: sem API pública encontrada | contato comercial |
| **D. Raspagem (Oxylabs/Apify etc.)** | Dados completos | Risco de termos de uso/legal; **não recomendo sem revisão jurídica** | variável |

**Recomendação:** começar pela **A**, com uma **camada de verificação própria**, e só propor B/C se a medição ficar abaixo da meta (ver §10). Nada pago é contratado sem sua autorização.

**Camada de verificação (código, por item):**
1. Domínio do link está na lista permitida (por empresa).
2. O link é de **página de produto** (padrão de URL por fornecedor), não de busca/categoria; links de busca são rejeitados.
3. O servidor testa o link (GET com timeout; 200 = válido; 403/429 de bloqueio de robô = "não verificado automaticamente", nunca "inválido" nem "confirmado").
4. Preço vem com a **citação** (trecho + URL); sem citação ⇒ preço descartado.
5. Registra fornecedor, URL, preço, moeda, **data e hora da consulta**, e `stock_verified = false` (só vira verdadeiro se a fonte afirmar estoque de forma estruturada).
6. Marca/modelo/especificação do produto precisam bater com o item (pontuação de correspondência); abaixo do limite ⇒ "Pesquisa pendente — revisão humana".
7. Cache de resultados públicos por 7–30 dias (chave = fornecedor + consulta normalizada), sempre mostrando a data da consulta; o técnico pode pedir "nova pesquisa".
8. Limites: máx. 8–10 buscas por cotação; só pesquisa itens com identificação suficiente; sem identificação ⇒ pede foto da etiqueta/modelo.

---

## 5. Modelo de dados e migrations (todas aditivas; 093+)

| Migration | Conteúdo |
|---|---|
| **093** `quote_rate_cards` + flags (**somente admin**) | Regras comerciais versionadas por empresa/unidade/cliente: valor/hora cobrado (**US$ 40** da Facilities 360), valor/hora pago ao técnico (**US$ 20**), hora mínima, deslocamento, markup, imposto, arredondamento. **RLS sem leitura para técnico.** `units.quote_ai_team_enabled`. |
| **094** núcleo | `quote_analysis_jobs` (estado, etapa, tentativas, lease, custo, tokens, erro, `idempotency_key`, `parent_job_id`, `budget_usd`), `quote_drafts` (**camada técnica**: versão, status técnico, status comercial, diagnóstico, totais de **materiais**, textos EN/PT, auditoria, `ai_original` imutável, campos editados, aprovador/data), `quote_items` (selo de preço: verificado/estimativa/corrigido/pendente), `quote_item_options` (fornecedor, URL, preço, moeda, `retrieved_at`, evidência, verificação do link, `stock_verified`), `quote_labor_plan` (técnicos, horas de serviço, horas-homem, deslocamento em horas, justificativa — **sem colunas de dinheiro**), **`quote_commercial` (somente admin: custo interno, preço de venda, markup, margem, impostos, totais comerciais, lucro)**, `quote_draft_media` (referência às mídias existentes — **sem duplicar arquivos**), `quote_events` (histórico, com `visibility` técnico/admin). |
| **095** infraestrutura | `product_price_cache`; função de "pegar job" com lease (`FOR UPDATE SKIP LOCKED`); índices. |
| **096** aprovação | Função de aprovar (recalcula no servidor, congela versão) + trigger que **proíbe alterar ou apagar versão aprovada**. |
Todas com `org_id`/`unit_id`/`appointment_id`, RLS por empresa e unidade (técnico só vê as próprias ordens e **somente a camada técnica**; admin da unidade vê as da unidade, camadas técnica + comercial; cliente do Portal 360 sem acesso). Escritas só por rotas de servidor. Custos continuam em `api_usage_events` (com `job_id` e etapa no metadata).

---

## 6. Interface de revisão (abaixo do formulário, mobile primeiro)

```
┌─ AI Quotation Team — Análise da Cotação ────────────────┐
│ ● Diagnóstico ✓  ● Materiais ✓  ◐ Preços…  ○ Mão de obra │  ← progresso ao vivo
│ Status: NECESSITA CONFIRMAÇÃO                      v1    │
├──────────────────────────────────────────────────────────┤
│ DIAGNÓSTICO                                              │
│ Door closer com braço solto (provável). [foto 1][foto 3] │
│ Fato: fixação do corpo frouxa · Hipótese: óleo vazando   │
│ Pendente: foto da etiqueta do closer  [+ Adicionar foto] │
├──────────────────────────────────────────────────────────┤
│ MATERIAIS                         [+ Adicionar material] │
│ ┌ Door closer, surface mount, ANSI Grade 1 ───────────┐  │
│ │ Qtd [ 1 ] un   Preço US$ [ 78,40 ]  Subtotal 78,40  │  │
│ │ Home Depot · consultado 17/10 14:32 · [abrir link]  │  │
│ │ Confiança: média · confirmar modelo  [Trocar][Pesquisar de novo][✕] │
│ └─────────────────────────────────────────────────────┘  │
│ ┌ Parafusos #12 × 1-1/2" (consumível) … ⚠ preço pendente ┐│
├──────────────────────────────────────────────────────────┤
│ MÃO DE OBRA  Técnicos [1▾]  Serviço [1,5 h]  Horas-homem 1,5 │
│ Deslocamento 0,5 h · Justificativa: …   (sem valores em US$) │
├──────────────────────────────────────────────────────────┤
│ MATERIAIS  Total estimado US$ 83,10 (✔ 78,40 · ≈ 4,70)    │
│ ⚠ 1 item sem preço confirmado — total PARCIAL             │
├──────────────────────────────────────────────────────────┤
│ DOCUMENTAÇÃO  EN (cliente) / PT (justificativa) · avisos  │
│ [Salvar rascunho] [Reanalisar] [ Aprovar cotação ]        │
└──────────────────────────────────────────────────────────┘
```
Cada edição recalcula na hora (mesma função pura do servidor, duplicada só para exibição); o servidor **sempre** recalcula ao salvar e aprovar. Barra inferior fixa com total e "Aprovar". **Admin** vê, abaixo, um painel extra "Comercial (somente admin)" com mão de obra cobrada, custo interno, markup, margem e total comercial. O técnico **não** recebe esse painel nem os dados dele. Estados: não iniciado / em análise / precisa de informação / pronto / falhou (cai no formulário manual) / aprovado (somente leitura + "criar revisão").

---

## 7. Riscos e proteções

| Risco | Proteção |
|---|---|
| Custo descontrolado | **Teto rígido de US$ 0,60 por cotação** (IA + buscas pagas, incluindo a taxa de US$ 0,01 por chamada de busca) e por empresa/mês (proposta: US$ 50), contador por job, máx. de buscas, cache. Ao chegar a ~80% do teto o job **encerra as etapas opcionais** (mais buscas, checagem extra); ao chegar a 100% **para**, entrega o que tem marcado como "necessita confirmação" — nunca estoura |
| Peça/preço inventado | Preço só com citação; link validado; "Pesquisa pendente" no lugar de chute; part number nunca inventado |
| Cotação "bonita" e errada | Auditor independente; status "Bloqueada por informação crítica" não vira "tecnicamente validada" |
| Aritmética errada | Todo cálculo em código com decimais de alta precisão (sem float), sem arredondar no meio do caminho; testes de propriedade |
| Injeção de prompt (foto com texto, página web) | Conteúdo externo tratado como dado; saída só por esquema estrito; modelo sem acesso a escrita no banco |
| **Vazamento de valores comerciais para o técnico** | Duas camadas (tabelas, rotas e RLS separadas), serializador de lista permitida, nada comercial em prompts/PDF técnico/logs, testes automáticos de RLS e de conteúdo |
| Vazamento entre empresas | RLS por empresa; cache só de dado público de produto; nada de nome de cliente/loja enviado à OpenAI (regra já existente no prompt atual) |
| Duplicidade / corrida | Chave de idempotência, lease por job, versões imutáveis |
| Limites da Vercel | Etapas curtas, estado no banco, cron de retomada, nada depende da tela aberta |
| Imagens públicas no Storage | Fotos hoje são URLs públicas enviadas à OpenAI; aceitável no piloto; migração para Storage privado (já no plano) passará a usar URL assinada ou base64 |
| Termos de uso de fornecedores | Preferir busca com citação/API oficial; raspagem só após revisão jurídica |
| Descontinuação de modelo | IDs em configuração, versão fixada, testes de regressão antes de trocar |
| OpenAI fora do ar | Job fica "falhou, tente de novo"; cotação manual intacta |

---

## 8. Plano de implementação por fases (cada fase: testes + commits locais + sua autorização antes de publicar)
| Fase | Entrega | Critério para seguir |
|---|---|---|
| 1 ✔ | Auditoria (este documento) | Sua aprovação |
| 2 | Migrations 093–096 (aplicadas só em desenvolvimento/flag desligada), contratos Zod, fila/worker/cron, flags, teto de custo | Testes de fila: duplicidade, retomada, timeout |
| 3 | Diagnóstico visual (várias fotos, fatos × hipóteses, pedido de foto adicional) | Teste com fotos de referência |
| 4 | Materiais + busca de produtos + camada de verificação | Meta de links/preços (§10) numa amostra de 30 itens |
| 5 | Mão de obra e composição de custos (código) | Testes de propriedade e casos reais |
| 6 | Auditor + tela editável abaixo do formulário | Teste em iPhone/Android |
| 7 | Aprovação, versões, seção "Quotation Assessment" no PDF | PDF revisado por você |
| 8 | **Modo sombra** na Mawi Pro (2 semanas), comparação com cotações humanas | Métricas de §10 |
| 9 | Otimização de custo/tempo/confiabilidade; decisão sobre fornecedor pago | Metas atingidas |

Esforço estimado (ordem de grandeza, com revisões suas entre as fases): **5 a 7 semanas** de trabalho contínuo até o fim da Fase 8.

---

## 9. Estimativa de custo por cotação (conta de tabela — será medida)
Premissas: 6 fotos ≈ 7.400 tokens de imagem; 6 itens a pesquisar, ~10 buscas, ~10 mil tokens recuperados por busca; saída de raciocínio incluída de forma conservadora.
| Perfil | Diagnóstico | Materiais | Buscas (10) | Mão de obra | Auditor | **Total típico** |
|---|---|---|---|---|---|---|
| **Padrão** (Sol no diagnóstico, Luna no resto) | ≈ US$ 0,05 | ≈ 0,001 | ≈ 0,11 | ≈ 0,001 | ≈ 0,002 | **≈ US$ 0,17** (faixa 0,08–0,45) |
| Econômico (tudo Luna) | ≈ 0,004 | ≈ 0,001 | ≈ 0,11 | ≈ 0,001 | ≈ 0,002 | **≈ US$ 0,12** |
| Premium (Sol em tudo) | ≈ 0,06 | ≈ 0,02 | ≈ 0,30 | ≈ 0,015 | ≈ 0,02 | **≈ US$ 0,42** (faixa até 0,7) |
**A busca é o custo dominante** (US$ 10/1.000 chamadas + tokens), por isso cache, limite de buscas e "só itens identificados". Com o volume atual (20 cotações em 30 dias) o perfil Padrão custaria **menos de US$ 5 por mês**. **Teto: US$ 0,60/cotação.** O perfil Padrão (≈ US$ 0,17, até ≈ 0,45) cabe com folga; o **Premium (≈ 0,42, até 0,7) pode encostar no teto** — por isso ele só roda se o teto permitir, e o job degrada para o Padrão antes de estourar.

---

## 10. Critérios de validação (sem afirmar 100% de precisão)
Conjunto de referência: 30 cotações reais da Mawi revisadas por humano, cobrindo os casos do pedido (fechadura, door closer, drywall, baseboard, laminado, prateleira, etiqueta legível, equipamento sem etiqueta, produto indisponível, foto insuficiente, dois técnicos, offline, reanálise, aprovação + PDF).
| Métrica | Meta para sair do modo sombra |
|---|---|
| Itens de material aceitos sem alteração | ≥ 85% (e erros de compatibilidade medidos separadamente) |
| Links que abrem em página de produto certa | ≥ 90% |
| Preço dentro de ±10% do preço no site na data | ≥ 80% dos itens com preço |
| "Invenções" (peça/preço/SKU sem fonte) | **0** toleradas — cada ocorrência investigada |
| Horas estimadas × realizadas (viagem/loja medidas pelo check-in) | erro mediano ≤ 25% |
| Cotações que exigem correção do técnico | medida e reportada (sem meta fixa na 1ª rodada) |
| Custo médio por cotação / máximo / p95 de tempo | ≤ US$ 0,30 médio, **nunca acima de US$ 0,60** / ≤ 4 min |
| Falhas que bloqueiam o salvamento da ordem | **0** |
Relatório semanal com esses números durante o modo sombra; decisão de ligar para técnicos só com sua aprovação.

---

## 11. Decisões — situação após a Revisão 2
**Já definidas por você:** técnico vê preços de compra de material (e edita); técnico **não** vê nada de mão de obra em dinheiro nem comercial; **valor/hora cobrado da 360 = US$ 40**, **valor/hora pago ao técnico = US$ 20** (guardados só na camada admin); **teto de US$ 0,60 por cotação**.
**Aprovadas na Revisão 3:** arquitetura geral; teto US$ 0,60/cotação; teto mensal inicial US$ 50 por empresa; reserva de orçamento antes de cada chamada.
**Ainda em aberto — a mensagem de decisões chegou cortada; preciso das seções seguintes ou da sua resposta (sugiro o padrão entre parênteses):**
1. ~~Regras comerciais restantes~~ — **definido:** US$ 40 cobrado / US$ 20 pago (somente admin, configuráveis); hora mínima, deslocamento, markup e impostos **desligados**; arredondamento só por regra explícita.
2. O que o **cliente final (360)** recebe: só a descrição técnica + materiais, ou também o valor comercial? Quem emite o documento comercial (admin)? *(Padrão: PDF do técnico = técnico/sem comercial; documento comercial gerado só pelo admin.)*
3. Aprovar o teste do perfil **Padrão** de modelos.
4. Começar pela busca da OpenAI e só avaliar fornecedor pago depois de medir.
5. ~~Teto mensal por empresa~~ — **aprovado: US$ 50** no piloto.
6. Modo sombra de 2 semanas só na Mawi Pro.
7. ~~Fotos~~ — **definido (parcial):** padrão de 5 fotos, exceções justificadas; não exigir só 2 (frase cortada — aguardo o complemento).
8. Aprovação: técnico da ordem aprova; admin pode pedir correção ou criar nova revisão *(padrão: sim)*.


---

## 12. FASE 2 — entregue em commits locais (17/10/2026) — sem push, sem deploy, migrations NÃO aplicadas

**O que foi feito**
| Item | Onde |
|---|---|
| Migrations aditivas 093–096 (chave por unidade `off/shadow/live`, regras comerciais admin-only, núcleo em duas camadas, jobs, rascunhos/itens/opções/mão de obra/mídias/comercial/eventos, limites por empresa, cache de produtos, funções atômicas de fila e de orçamento, imutabilidade da versão aprovada) | `supabase/migrations/20261017000093…096` |
| Contratos Zod das saídas dos modelos (diagnóstico sem foto ⇒ sem alegar visão; part number nunca obrigatório; desperdício só com justificativa; 2+ técnicos só com justificativa; horas-homem calculadas em código) | `lib/quote-team/contracts.ts` |
| Barreira de visibilidade financeira (serializadores de lista permitida + detector de vazamento) | `lib/quote-team/visibility.ts` |
| Controle de orçamento: reservar pior caso → executar → liquidar; teto US$ 0,60/cotação e US$ 50/mês; etapas opcionais param em 80% | `lib/quote-team/budget.ts` + funções SQL `reserve_quote_budget`/`settle_quote_budget` |
| Fila assíncrona: criação idempotente, lease, retomada, tentativas com espera, timeout por etapa, limite de tempo por passada, `needs_input`, `budget_exhausted` | `jobs.ts`, `runner.ts`, `job-store.ts` (+ cópia em memória p/ teste) |
| Rotas: status do job (técnico × admin), disparo/retomada, cron por minuto | `api/quote-jobs/[id]`, `…/run`, `api/cron/quote-jobs` (+ `vercel.json`) |
| Gancho no salvamento da ordem (só depois de salvar; nunca lança) | `service-order/route.ts` → `maybeEnqueueQuoteAnalysis` |

**Por que nada muda hoje (inerte por construção):** o registro de etapas (`handlers.ts`) está **vazio** até as Fases 3–6; sem etapas, `enqueue` recusa (`pipeline_not_ready`), o cron e o disparo respondem na hora sem tocar no banco, e o gancho do salvamento retorna antes de qualquer consulta. Interruptor global: `QUOTE_TEAM_ENABLED=false`.

**Validação realizada**
- 4 migrations aplicadas **dentro de uma transação desfeita** no banco real, com testes de segurança simulando técnico, admin da Mawi e admin de outra empresa (ver abaixo). **Nada foi gravado**: depois do teste, 0 tabelas/colunas/funções novas existem em produção.
- Resultados do teste de banco: técnico lê 0 linhas de `quote_rate_cards`, `quote_commercial` e `quote_analysis_jobs`; lê só o próprio rascunho `live` (rascunho `shadow` e o de outro técnico: invisíveis), só eventos `technician`; **não** insere itens, **não** executa funções de fila/orçamento; admin da Mawi vê tudo da empresa; **admin de outra empresa vê 0**; `quote_labor_plan` sem nenhuma coluna monetária; restrições (2 técnicos sem justificativa, preço em item "pendente", quantidade 0, URL http) bloqueadas; reserva de orçamento respeita US$ 0,60 e o teto mensal; fila: 2º worker não pega job travado e retoma após expirar o lease; versão aprovada: editar/apagar/alterar itens bloqueados, estado comercial livre, nova revisão marca a anterior como `superseded`, reaprovar bloqueado.
- 41 testes novos (orçamento, idempotência, runner, visibilidade, contratos, acesso, gancho). Suíte completa 1440 passando; typecheck, lint e build OK.

**Para aplicar (só com sua autorização):** `apply_migration` 093 → 096 em ordem; depois cadastrar a regra comercial da Mawi (US$ 40 / US$ 20) como **dado** pela tela admin (Fase 5/6) — não vai em migration. Depois da Fase 3, ligar a unidade Mawi Pro em `shadow`.
