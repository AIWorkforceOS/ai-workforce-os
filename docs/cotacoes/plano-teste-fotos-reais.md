# Fase 3 — plano de teste com fotografias reais (diagnóstico visual)

**Nada abaixo foi executado.** Nenhuma chamada paga à API real foi feita. Este plano aguarda a autorização do Vinicius.

## A. O que o teste mede (e o que não mede)
Mede só o **diagnóstico visual** (etapa 1). Preços, links e horas ficam para as Fases 4 e 5.

## B. Etapa 0 — verificação de suporte (1 chamada, ≈ US$ 0,05)
Teste `diagnosis-live.smoke.test.ts` (pulado por padrão; só roda com `RUN_PAID_SMOKE=1` e a chave). Confirma na API real: (1) o modelo `gpt-6.1-sol` existe para a nossa conta; (2) aceita imagem; (3) aceita **Structured Outputs estrito com o NOSSO esquema**; (4) formato real da resposta e do campo de uso; (5) tokens de imagem reais × estimativa (a estimativa de pior caso **não pode** ficar abaixo do real); (6) latência; (7) custo. Se falhar algo, **para** e apresento o problema antes de seguir (ex.: ajustar esquema, trocar de modelo, usar Chat Completions).

## C. Amostra (30 casos revisados por humano)
| Categoria | Casos |
|---|---|
| Porta/fechadura/door closer | 6 (2 com etiqueta legível, 2 sem etiqueta, 2 com o componente já removido) |
| Drywall e pintura | 4 |
| Baseboard e acabamento | 3 |
| Piso (laminado/LVT/carpete) | 4 |
| Prateleira, balcão, mobiliário | 3 |
| Hidráulica/elétrica simples | 3 |
| Equipamento (com e sem etiqueta) | 3 |
| **Controles negativos** | 4: 2 **sem foto**, 1 foto borrada/escura, 1 com 2 fotos só |
Origem: **novos casos com fotos** das visitas dos técnicos nas próximas semanas (o histórico não tem fotos de cotação: 0 das 20) e casos montados pelo admin em visitas. **Padrão de 5 fotos**: visão geral · problema de perto · etiqueta/modelo · contexto/acesso · medida/escala. Volume real da Mawi ≈ 20 cotações/mês ⇒ **30 casos levam ~6 semanas** só com cotações; para acelerar, o admin pode registrar casos extras.

## D. Gabarito humano (antes de rodar a IA)
Para cada caso, um revisor (Vinicius/admin e, se possível, um técnico sênior) preenche: problema correto; componentes envolvidos; **marca/modelo/part number que aparecem de fato na etiqueta**; escopo provável; riscos de segurança; se as fotos bastam; que informação extra seria necessária. O gabarito é congelado **antes** de ver a resposta da IA.

## E. Execução
Mesma entrada para 3 modelos: **`gpt-6.1-sol`** (perfil Padrão), **`gpt-6-luna`** (econômico) e **`gpt-4o-mini`** (linha de base atual). Fotos reduzidas a 1024 px (como em produção). Nenhum nome de cliente/loja vai no prompt. Cada chamada passa pelo controle de orçamento (teto US$ 0,60).
Custo estimado (conta de tabela): sol ≈ US$ 0,05 × 30 + luna ≈ 0,005 × 30 + 4o-mini ≈ 0,01 × 30 ≈ **US$ 2**. **Teto proposto para todo o teste: US$ 5,00**, interrompendo ao atingir.

## F. Métricas e metas (sem afirmar 100%)
| Métrica | Meta |
|---|---|
| Problema principal correto (revisão humana) | ≥ 85 % (modelo escolhido) |
| **Part number/modelo inventado** | **0** (cada ocorrência investigada) |
| Etiqueta transcrita corretamente (casos com etiqueta legível) | ≥ 90 % |
| Pede a informação certa quando as fotos não bastam | ≥ 90 % |
| **Alega diagnóstico visual sem foto** | **0** |
| Riscos de segurança apontados (vs. gabarito) | ≥ 80 % |
| JSON dentro do contrato (1ª tentativa) | ≥ 99 % |
| Latência p95 / custo médio por diagnóstico | ≤ 60 s / ≤ US$ 0,10 |
| Erro da estimativa de tokens de imagem | nunca subestimar |

## G. Decisão
Comparo os três modelos (qualidade × custo × latência), recomendo **um** e o apresento a você. **Nenhum modelo de produção é trocado** sem sua aprovação e sem rollback (a escolha fica em configuração por variável de ambiente). Só então a Fase 4.

## H. Autorizações que preciso para executar este plano
1. A **Etapa 0** (≈ US$ 0,05, 1 chamada).
2. O teste comparativo completo, **teto US$ 5,00**.
3. Uso da chave `OPENAI_API_KEY` já existente (sem contratar nada novo).
4. Aplicar as migrations 093–096 em produção **antes** do modo sombra (não é preciso para os testes da Fase 3, que rodam isolados).
