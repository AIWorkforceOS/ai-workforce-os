# Comparativo de modelos — diagnóstico visual (2026-10-18)

Autorizado: teto GLOBAL US$ 5. **Gasto total: ≈ US$ 0,24** (Etapa 0 ≈ 0,03 + comparativo 0,208, ledger em arquivo, nenhuma chamada falhou). Nenhuma escrita no banco.

Mesmas fotos e mesmas descrições para os 3 modelos, mesmo prompt/esquema estrito. Fotos: apenas as 16 reais existentes (2 ordens de teste do Vinicius). **O gabarito foi escrito pelo assistente olhando as fotos — precisa ser confirmado pelo Vinicius.** Não há ainda casos reais de cliente com defeito visível: este comparativo mede *honestidade e disciplina*, não precisão de diagnóstico de defeito real (isso exige os 30 casos revisados do piloto).

| Caso | Fotos | Esperado (gabarito preliminar) |
|---|---|---|
| C1 cadeira (PT) | 1 | cadeiras azuis visíveis; dano/modelo não visíveis |
| C2 trava do portão | 4 | cerca/piscina; portão e trava NÃO aparecem |
| C3 idem | 8 | mesmo que C2 |
| C4 quarto | 3 | criado-mudo e ventilador parcial; dano não visível |
| C5 borda da piscina | 5 | azulejo/degrau, noturnas; defeito não confirmável |
| C6 sem foto | 0 | só texto; sem evidência visual |
| C7 descasada | 2 | fotos de quarto, nota fala de bomba de piscina |

| Modelo | Custo/chamada (4 fotos) | Latência | Resultado |
|---|---|---|---|
| gpt-6.1-sol | US$ 0,019 (0,009–0,028) | 17–30 s | 7/7 válidos; nenhuma peça/marca inventada; descreveu o que via e disse o que faltava; mais detalhado (C4 viu o puxador e o ventilador parcial); C7 reconheceu corretamente que não era bomba |
| gpt-6-luna | US$ 0,001 (0,0004–0,0013) | 7–14 s | 7/7 válidos; nenhuma peça/marca inventada; ~20× mais barato; um pouco menos preciso (C2 falou "fence or gate" — o portão não aparece; C7 citou "escada" que não existe; menos pedidos de confirmação: 1–4 vs 3–6) |
| gpt-4o-mini | US$ 0,016 (4 fotos = 103 mil tokens) | 2–5 s | **Reprovado**: disse "falta de fotos" com fotos presentes (C2, C4, C7), ignorou as imagens (evidência 0), tratou "puxador danificado" como hipótese média só pelo texto; 5+ fotos estoura o contexto de 128k |

Em todos: 0 part numbers inventados, 0 marcas/modelos inventados, 0 evidências com foto inexistente, `photos_analyzed` correto, esquema estrito aceito.

## Recomendação (provisória)
- Diagnóstico: **gpt-6-luna como padrão** (custo desprezível, honestidade equivalente), com **gpt-6.1-sol como escalonamento** quando o caso for ambíguo/muitas fotos, ou como padrão se o Vinicius preferir mais detalhe: com sol, 5 fotos ≈ US$ 0,022, bem dentro do teto de US$ 0,60.
- **Não usar gpt-4o-mini** para visão.
- Decisão final só depois de revisão humana (gabarito) e casos reais com defeito visível no modo sombra.

## Reproduzir
`__tests__/model-comparison.experiment.test.ts` (pulado por padrão; exige `RUN_EXPERIMENT=1`, chave e `EXP_DIR`). Ledger local com trava em US$ 4,50.
