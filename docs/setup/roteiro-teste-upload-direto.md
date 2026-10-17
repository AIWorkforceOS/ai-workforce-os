# Roteiro de teste real — upload direto de fotos/vídeos (Chrome/Android e Safari/iPhone)

Estado: o upload direto está LIGADO para todos desde 2026-10-17 (commit 03f2bdf). Não é preciso ligar nada no aparelho.

## 0. Preparo
1. Entrar no app com o login do técnico de teste e usar uma ordem de teste/real escolhida pelo Vinicius.
2. Para comparar com o fluxo antigo num aparelho: `…/portal-funcionario/sincronizacao?upload_direto=0` (faixa amarela avisa); para voltar: `?upload_direto=padrao`.

Registrar em cada caso: aparelho, navegador/versão, rede (Wi-Fi/4G), resultado, print da tela de Sincronização.

## 1. Fotos
| # | Caso | Esperado |
|---|------|----------|
| 1.1 | 1 foto da câmera (~3–6MB), "Salvar estas fotos agora" | "Fotos salvas"; foto aparece na ordem; Sincronização = "Nada pendente" |
| 1.2 | 8 fotos de uma vez (~40MB total) | todas salvas, sem erro 413; nenhuma duplicada |
| 1.3 | Foto da galeria em resolução máxima (>10MB) | salva |
| 1.4 | Salvar a mesma foto 2x (tocar duas vezes) | aparece 1 vez só |

## 2. Vídeo (Gravar vídeo / Escolher vídeo)
| # | Caso | Esperado |
|---|------|----------|
| 2.1 | Gravar e deixar passar de 15s | para sozinho aos 15s; tamanho exibido < 10MB |
| 2.2 | Parar manualmente aos 5s e salvar | salva e toca na ordem |
| 2.3 | Escolher vídeo da galeria de 40s | recusa com "Vídeo longo demais" |
| 2.4 | Escolher vídeo de 10s com >50MB | recusa com "Vídeo grande demais" |
| 2.5 | Negar permissão da câmera | mensagem pedindo permissão / usar "Escolher vídeo" |
| 2.6 | Safari/iPhone: gravar, salvar, abrir no Portal 360 | vídeo reproduz (mp4) |
| 2.7 | Chrome/Android: idem | vídeo reproduz (webm) |

## 3. Assinatura e finalização
| # | Caso | Esperado |
|---|------|----------|
| 3.1 | Finalizar com nome + assinatura + fotos | "Salvo com sucesso"; ordem Finalizada; PDF baixa com assinatura |
| 3.2 | Finalizar sem assinatura | bloqueado na tela (e o servidor também recusa) |
| 3.3 | Marcar Cotação sem assinatura | permitido |

## 4. Perda de conexão (o mais importante)
| # | Caso | Esperado |
|---|------|----------|
| 4.1 | Modo avião ANTES de salvar (fotos + assinatura) | "Salvo no aparelho — Aguardando internet"; Sincronização mostra o item |
| 4.2 | Tirar o modo avião | envia sozinho em até ~1 min (ou "Tentar sincronizar agora"); item some |
| 4.3 | Cortar a rede NO MEIO do envio de 8 fotos | item continua na fila; ao voltar a rede, só as fotos que faltam sobem; nada duplicado |
| 4.4 | Fechar o app/aba com item pendente, reabrir | item continua; sincroniza |
| 4.5 | Recarregar a página com formulário preenchido e não salvo | faixa "Rascunho salvo neste aparelho" com fotos/assinatura restauradas |
| 4.6 | iPhone: deixar o Safari em segundo plano 5+ min com item pendente | ao voltar, sincroniza (iOS não envia em segundo plano) |

## 5. Sessão expirada
| # | Caso | Esperado |
|---|------|----------|
| 5.1 | Apagar os cookies do site (ou esperar expirar) e salvar | mensagem "Sessão expirada — entre de novo no app (nada foi perdido)" — NÃO "Sem internet" |
| 5.2 | Entrar de novo | item sincroniza sem refazer nada |

## 6. Conferência no servidor (feita por mim, com o ID da ordem de teste)
- fotos/vídeo existem no bucket `service-orders` e estão em `service_order_photos` sem duplicata
- assinatura gravada; `signed_at` preenchido só com assinatura
- nenhuma foto "órfã" no bucket sem registro (anotar se houver)

## 7. Critério de validação
Todos os casos 1–5 passando em ao menos 1 Android/Chrome e 1 iPhone/Safari, 0 perda de dado e nenhum item preso na fila. Se falhar: rollback abaixo.

## Reverter
- Imediato (sem build): na Vercel, promover o deployment anterior `dpl_7CEcYZAUNar9zrTaNT1FBWMw683F` (commit c462d8f, upload direto desligado).
- Definitivo: criar `NEXT_PUBLIC_DIRECT_MEDIA_UPLOAD=false` (Production) e redeployar, ou `git revert 03f2bdf`.
- Um aparelho: `?upload_direto=0`.
- Dados já enviados ficam no Storage e na ordem; itens ainda na fila do aparelho continuam sendo reenviados pelo fluxo antigo.
