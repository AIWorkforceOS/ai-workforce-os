# PWA / modo offline — roteiro de validação real

**Pré-requisito:** a versão do PWA precisa estar publicada (hoje está só em commits locais). Use uma ordem de teste, não uma ordem real do dia.
Anote em cada caso: aparelho, navegador/versão, resultado e print. Para cada envio, confira no Supabase os arquivos no bucket `service-orders` e o vínculo com a WO certa.

## 0. Antes de instalar no iPhone — fila do Safari zerada (OBRIGATÓRIO)
O app instalado na tela inicial tem **armazenamento separado** do Safari. Tudo que estiver pendente no Safari **não aparece** no app novo.
1. No Safari (pelo ícone atual), abra **Portal → Sincronização** (`/portal-funcionario/sincronizacao`) com internet.
2. Toque em **Tentar sincronizar agora** até aparecer "Nada pendente".
3. No cartão "Instalar a Alizo como app", deve aparecer em verde: **"Tudo enviado neste navegador: fila vazia, sem erros e sem rascunhos. Pode instalar."**
   - Se aparecer "NÃO troque o ícone ainda", resolva cada motivo listado (itens aguardando, itens com erro, rascunhos). Rascunho = formulário preenchido e nunca salvo: abra a ordem e salve, ou confirme que pode descartar.
4. Só então: segure o ícone antigo → Remover da Tela de Início (isso **não** apaga os dados do Safari).
5. No Safari: alizoai.com → Compartilhar → **Adicionar à Tela de Início** (deixe "Abrir como app" ligado).
6. Abra o ícone novo, entre com a conta, abra a agenda **online** e, em Sincronização, toque em **Preparar para uso offline**.
7. Confirme: "Ordens disponíveis offline: N" e "Última atualização da agenda" com a hora de agora.

## 1. iPhone — app instalado
| # | Passo | Esperado |
|---|-------|----------|
| 1.1 | Abrir o ícone online, ver a agenda | Abre em tela cheia (sem barra do Safari) |
| 1.2 | Sincronização → Preparar para uso offline | "Pronto: N ordem(ns) guardada(s)" |
| 1.3 | Fechar o app por completo (deslizar para cima) | — |
| 1.4 | Ativar modo avião | — |
| 1.5 | Abrir o ícone | Abre a agenda guardada, com faixa amarela "Sem internet… dados guardados neste aparelho — última sincronização: dd/mm hh:mm" |
| 1.6 | Abrir uma WO que estava na lista | Mostra "Ordem exibida a partir de dados locais (sincronizada em …)", descrição, escopo e formulário |
| 1.7 | Abrir uma WO que NUNCA foi aberta online (peça outra ao admin) | "Esta ordem não está disponível offline" (não finge que existe) |
| 1.8 | Digitar nome, tirar 2 fotos (Tirar foto), gravar 1 vídeo curto, assinar, salvar | "Salvo no aparelho — Aguardando internet"; em Sincronização aparecem os arquivos pendentes |
| 1.9 | Fechar e reabrir o app (ainda em avião) | Itens continuam; o rascunho reaparece |
| 1.10 | Desligar o modo avião | Em até ~1 min os itens somem da fila; "Última sincronização confirmada" atualiza |
| 1.11 | Conferir no servidor | Fotos/vídeo no Storage, vinculados à WO, sem duplicata; assinatura gravada |

## 2. Android / Chrome (instalar pelo menu ⋮ → Instalar app)
Repetir 1.1 a 1.11. Diferença esperada: o Chrome oferece "Instalar app" e o app mantém o mesmo armazenamento do navegador (a fila do Chrome aparece no app).

## 3. Casos extras
| Caso | Como testar | Esperado |
|---|---|---|
| Sessão expirada | Online, apague os cookies do site, salve algo | Fica na fila como "Sessão expirada — entre de novo (nada foi perdido)"; ao entrar, envia |
| Navegador reiniciado | Salve offline, feche tudo, reinicie o aparelho, reabra | Fila e rascunho intactos |
| Atualização do PWA com pendências | Com 1 item pendente, publicar versão nova e abrir o app | A versão nova **não** assume enquanto houver pendência; fila intacta |
| Duas tentativas de envio | Toque 2x em "Tentar sincronizar agora" | Um único envio, sem foto duplicada |
| Armazenamento quase cheio | Em aparelho com pouco espaço, tentar guardar vídeo | Aviso "O celular está sem espaço… Nada foi salvo ainda"; nunca "salvo" falso |
| Troca de usuário | Sair da conta A com item pendente (o app avisa), entrar com a conta B | Itens de A aparecem como "de OUTRA conta", não são enviados por B nem apagados; ao voltar A, enviam |
| Falha temporária do Supabase/servidor | (simulada) | Itens ficam; tentam de novo sozinhos |
| Dados antigos (>14 dias) | Aparelho sem abrir online por 14 dias | Agenda guardada não é exibida ("dados antigos"); fila e rascunhos NÃO são apagados |
| Ordem reatribuída/removida | Admin muda a ordem enquanto o técnico está offline | Na reconexão o servidor recusa (404/403): o item fica como "com erro", guardado e visível |

## 4. Limites que o técnico deve conhecer
- Só abre offline a ordem que **já foi aberta/sincronizada** naquele aparelho.
- Miniaturas de fotos já salvas no servidor **não** aparecem offline (só o que foi tirado no aparelho).
- Iniciar viagem/check-in funcionam offline (ficam na fila); abrir o Google Maps precisa de internet.
- Os dados locais não são criptografados; o bloqueio de tela do aparelho é a proteção. O navegador pode apagar armazenamento local em situações extremas (falta de espaço, limpar dados do site) — por isso envie assim que houver internet.
