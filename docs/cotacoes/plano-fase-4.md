# Plano da Fase 4 — Super Agente de Cotações (proposta, 19/10/2026)

**Estado:** infraestrutura publicada e **inerte** (módulo desligado, 5/5 unidades `off`, `handlers.ts` vazio). **Nada da Fase 4 foi iniciado.** Cada entrega abaixo é pequena, nasce desligada, tem testes com simulação (sem custo) e só passa para o próximo degrau com **autorização separada**:
`A) código + testes simulados (local) → B) deploy inerte → C) teste pago com teto explícito → D) modo sombra na Mawi Pro (só admin vê)`.
**Limites invioláveis:** US$ 0,60 por cotação e US$ 50 por mês por empresa (reserva antes de gastar, 3 baldes, idempotência — já implementados e testados). Técnico nunca vê tarifas/margem. Sem preço, SKU, link ou compatibilidade inventados. Sem aprovação automática.

## Estimativa de custo por cotação (a medir; referência dos testes de 18/10)
Diagnóstico (luna, 1–5 fotos) ≈ US$ 0,001–0,003; (sol) ≈ US$ 0,01–0,03 · materiais ≈ US$ 0,002–0,01 · **pesquisa de preços** (busca US$ 0,01/chamada + tokens) ≈ US$ 0,08–0,25 (maior risco; será medida antes de fixar) · mão de obra e auditoria ≈ US$ 0,005–0,02. **Ordem de grandeza: US$ 0,10–0,35 por cotação**, dentro do teto de 0,60 com folga para escalar o diagnóstico para o modelo maior; ≈ 150–400 cotações/mês no teto de US$ 50.

## Entrega 4.0 — Pipeline por etapas (pré-requisito, sem custo) · pequena
- Hoje o job só roda com as 6 etapas registradas. Passa a aceitar **etapas habilitadas** (configuração), concluindo com pendências "etapa não habilitada" para as demais — permite entregar uma etapa por vez em sombra.
- Gravação do resultado em `quote_drafts` (diagnóstico, `ai_original` imutável), `quote_draft_media` (referência às fotos, sem duplicar) e `quote_events`; leitura **só admin** em sombra.
- Tela mínima do admin na ordem ("Análise IA — modo sombra"): estado, etapas, pendências, **gasto confirmado / não confirmado / teto restante**, botão "reanalisar" (respeita 3/dia).
- **Aceite:** testes de retomada/concorrência com etapas parciais; técnico recebe 0 linhas (RLS) e a tela não aparece para ele; `off` continua não gastando nada.

## Entrega 4.1 — Diagnóstico visual · pequena (o código base existe)
- Registrar o handler de diagnóstico (fotos redimensionadas, prompt anti-invenção, esquema estrito, pós-processamento que remove part numbers sem etiqueta). **luna** por padrão; escalonar para **sol** só se a confiança vier baixa/ambígua **e** couber no orçamento (regra determinística, registrada no evento).
- Sem fotos: só organização do texto, `visual_confidence = none`. Foto não carregada vira pedido ao técnico.
- **Teste pago (autorização + teto, ex. US$ 3):** os **casos reais de defeito** que o Vinicius está reunindo (+ a revisão humana do gabarito). Métricas: precisão, informação inventada, pedidos de confirmação, tempo, custo.
- **Aceite:** 0 part number/marca inventados; evidência sempre cita foto válida; custo p95 ≤ US$ 0,05 (luna); falhas ambíguas ficam "não confirmadas".

## Entrega 4.2 — Identificação de materiais · pequena/média
- Etapa `materials`: a partir do diagnóstico + descrição → itens (nome EN, descrição PT, quantidade, unidade, obrigatório/condicional, marca/modelo **só se lidos na etiqueta**, desperdício só com justificativa, `needs_confirmation`). Ferramenta não é cobrável automaticamente.
- Grava em `quote_items` com `price_status = pending` (sem preço).
- **Aceite:** em casos reais revisados, cobertura de itens ≥ meta combinada com o Vinicius e 0 item sem justificativa; nenhum preço aparece; consumo ≤ US$ 0,01.

## Entrega 4.3 — Pesquisa de produtos e preços reais · média/grande (a mais arriscada)
Dividida em duas para medir antes de gastar:
- **4.3a — Busca e extração (mock → teste pago curto):** ferramenta `web_search` da OpenAI (verificar suporte/custo reais antes: ~US$ 10 por 1.000 buscas + tokens); no máx. N buscas por item e M por cotação; resultado só vale com **https**, preço, data da consulta e trecho de evidência. Lista de fornecedores permitidos/bloqueados definida pelo Vinicius. Fornecedor pago externo **só com autorização**.
- **4.3b — Verificação e cache:** checagem do link (abre? mostra o preço? estoque?), `product_price_cache` (TTL, dado público), múltiplas opções, marcação **verificado × estimado × pendente**; item sem prova fica "pesquisa pendente" — nunca preenchido por chute.
- Orçamento: reserva do pior caso por busca; etapa opcional para em **80%** do teto; esgotou ⇒ guarda o que tem e lista o que falta (técnico segue manual).
- **Aceite:** 100% das opções com link real e evidência; 0 preço sem fonte; custo médio medido e p95 ≤ US$ 0,30; falha de busca nunca derruba a cotação.

## Entrega 4.4 — Mão de obra, custos e auditoria · média
- **Mão de obra** (sem dinheiro): técnicos, horas de serviço, **horas-homem calculadas em código**, deslocamento/espera separados; 2+ técnicos só com justificativa concreta; a IA nunca recebe valores.
- **Custos** (função determinística, **só admin**): usa a tabela de tarifas cadastrada pelo admin (US$ 40/h cobrado e US$ 20/h pago configuráveis, nunca no código; hora mínima, deslocamento, markup, imposto só se configurados; arredondamento só por regra explícita).
- **Auditoria:** regras + checagem independente ⇒ `ready_for_review / needs_confirmation / blocked`.
- **Aceite:** testes de contas exatas (micro-dólares), técnico não vê tarifas por RLS/API/PDF; auditor bloqueia item sem justificativa.

## Entrega 4.5 — Revisão humana · média
- **Técnico** (quando houver modo ao vivo): vê preços de compra de materiais (fornecedor, link, data, verificado/estimado), horas-homem **sem valores**; edita/aprova a versão técnica; versão aprovada **nunca é sobrescrita** (096) e o histórico fica.
- **Admin:** pede correção, cria revisão, vê financeiro; aprovação técnica ≠ comercial; PDF do técnico sem tarifas/pagamentos/margem; documento comercial separado.
- **Modo sombra (≈ 2 semanas, só Mawi Pro, só admin):** 30 casos reais revisados por humano; **sem aprovação automática**; só depois decidir "ao vivo" por unidade.
- **Aceite:** meta de concordância definida com o Vinicius; 0 vazamento financeiro; nenhum aprovado alterado.

## Transversal (cada entrega)
Painel de custo do admin (confirmado × não confirmado × mensal, alerta em 80%); rotina de **reconciliação** com o custo real da OpenAI; kill switch `QUOTE_TEAM_ENABLED=false` e chave por unidade; testes simulados antes de qualquer centavo; relatório por entrega.

## Dependências do Vinicius
1. **Fotos reais de defeitos** das próximas ordens + a descrição do defeito (gabarito) → habilita 4.1.
2. **Fornecedores permitidos/bloqueados** e política de fornecedor pago → 4.3.
3. **Tabela de tarifas** (valores, hora mínima, deslocamento, markup, imposto — só o que existir) → 4.4.
4. Metas de aceite (cobertura de materiais, concordância) e datas da janela em sombra.
5. Autorizações por degrau: deploy inerte, cada teste pago (com teto), ligar sombra.
6. Pendente fora da Fase 4: correção do 400 do reenvio sem fotos novas (acima) e teste de campo da fila offline no celular.

## Ordem sugerida
4.0 → 4.1 (já com fotos reais) → 4.2 → 4.4 (mão de obra/custos, sem custo de IA relevante) → 4.3a → 4.3b → 4.5. A busca de preços (4.3) fica por último entre as de IA porque é a que mais gasta e a que mais exige verificação; 4.4 antes dela entrega valor sem esse risco.
