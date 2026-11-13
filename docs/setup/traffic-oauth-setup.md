# Setup de credenciais — Login com Facebook (Tráfego Pago)

Pedido do Vinicius (2026-08-28): o cliente testou o método manual (compartilhar a conta de
anúncio como Parceiro do Business Manager) e recebeu "falta permissão", mesmo achando que tinha
feito tudo certo — muito passo manual, fácil de errar. Mesma solução que já existe pro Gestor de
Conteúdo (ver `docs/setup/content-oauth-setup.md`): o cliente clica **"Conectar com Facebook"**,
faz login com a própria conta e escolhe a conta de anúncio numa lista — sem colar nenhum ID nem
token. O método manual continua existindo como alternativa em "Prefiro o método manual".

Este documento cobre a configuração **global** (o app da Meta que faz esse login funcionar). O
fluxo em si já está implementado (`lib/traffic/meta-ads-oauth.ts` +
`app/api/traffic/accounts/oauth/{start,callback,finalize}/route.ts`) — o que falta é só a
configuração no lado da Meta.

## ⚠️ Achado real (2026-09-01): são DOIS apps diferentes na Meta, não um só

A primeira versão deste documento assumia que o Tráfego reaproveitaria o mesmo app da Meta já
usado pelo login do Conteúdo. **Isso estava errado** — confirmado direto no Business Manager
(Configurações do negócio → Apps): existem dois apps separados —

- **"AlizoAI Content"** — de propriedade **pessoal de Vinicius Miranda**, usado pelo login do
  Gestor de Conteúdo (`META_APP_ID`/`META_APP_SECRET`/`META_LOGIN_CONFIG_ID`).
- **"Alizo Trafego Ads"** (ID `1723742265568719`) — de propriedade do Business Manager **"Smarter
  one"**, já com o caso de uso "Criar e gerenciar anúncios com a API de Marketing" configurado e
  testado (é o mesmo app do `META_SYSTEM_USER_TOKEN`/`META_BUSINESS_MANAGER_ID` do método manual).

Por isso o login OAuth de Tráfego usa credenciais **próprias**, nunca as do Conteúdo:

## O que você (Vinicius) precisa obter, uma vez só

| Env var | O que é | Status em 2026-09-01 |
|---|---|---|
| `META_ADS_APP_ID` | ID do app "Alizo Trafego Ads" | ✅ `1723742265568719` — já pode ir pro Vercel |
| `META_ADS_APP_SECRET` | Chave secreta desse app (Configurações do app → Básico → Mostrar) | ⏳ exige sua senha da Meta pra revelar — a Claude nunca digita senha em nenhum campo, esse passo é só seu |
| `META_ADS_LOGIN_CONFIG_ID` | ID da Configuração de Login já criada | ✅ `1366240232340507` — já pode ir pro Vercel |

## O que já foi feito (2026-09-01, direto no navegador com acesso ao seu Chrome já logado)

1. ✅ Adicionada a URL de redirecionamento válida em Login do Facebook para Empresas →
   Configurações → URIs de redirecionamento do OAuth válidos:
   `https://www.alizoai.com/api/traffic/accounts/oauth/callback`
2. ✅ Criada a Configuração de Login "Traffic Pago - contas de anunc" (variação General, token de
   acesso do usuário, permissões `ads_management` + `ads_read` + `business_management`) — ID
   `1366240232340507`.
3. ⏳ **Falta só**: revelar `META_ADS_APP_SECRET` (exige senha) e colar as 3 env vars no Vercel.
4. ⏳ Colocar o app "Alizo Trafego Ads" em modo "Live" quando for liberar geral (ver seção de App
   Review abaixo) — hoje está "Não publicado".

## Passo a passo restante (só o que falta)

1. **Revelar o App Secret**: [developers.facebook.com/apps/1723742265568719/settings/basic](https://developers.facebook.com/apps/1723742265568719/settings/basic/)
   → campo "Chave Secreta do Aplicativo" → **Mostrar** → digite sua senha da Meta quando pedir.
2. **Colar as 3 env vars no Vercel** (Settings → Environment Variables, Production e Preview):
   - `META_ADS_APP_ID` = `1723742265568719`
   - `META_ADS_APP_SECRET` = (o valor revelado no passo 1)
   - `META_ADS_LOGIN_CONFIG_ID` = `1366240232340507`
3. Pronto — o botão "Conectar com Facebook" em `/dashboard/traffic/connect` liga sozinho no
   próximo request, sem precisar de novo deploy.

## ⚠️ App Review — provavelmente necessário antes de qualquer cliente real usar

`ads_management` é uma permissão avançada da Meta. Com o app em modo Live, **qualquer conta de
terceiro que tentar logar vai precisar que essa permissão esteja em Advanced Access, aprovado via
App Review** — diferente do método manual (compartilhar como Parceiro do system user), que já
opera em Standard Access sem revisão (ver `docs/setup/traffic-apis-setup.md`, seção "Meta Ads").

**Isso não bloqueia testar agora:** enquanto o App Review não sai, o login funciona perfeitamente
com contas cadastradas como Admin/Developer/Tester do próprio app da Meta (ex.: a sua) — suficiente
pra testar o fluxo de ponta a ponta antes de qualquer cliente real usar. Pra liberar geral,
submeter App Review pedindo `ads_management`, com um vídeo de demonstração do fluxo (a Meta pede
isso).

## Testar com uma conta de teste (recomendado antes de liberar geral)

1. No painel do app "Alizo Trafego Ads" → Funções do app → confirmar que você (ou quem for testar)
   já está como Administrador/Tester.
2. Ter uma conta de anúncio de teste (a sua própria já serve).
3. Em `/dashboard/traffic/connect`, clicar "Conectar com Facebook", logar com essa conta, escolher
   a conta de anúncio.
4. Confirmar que a conta aparece como "Conectada" na lista — não precisa rodar nenhuma campanha
   real pra validar o login em si.

## Diferença de arquitetura vs. o método manual (Business Manager Partner)

O método manual continua existindo (`app/api/traffic/accounts/connect/route.ts`,
`docs/setup/traffic-apis-setup.md`) e usa `META_BUSINESS_MANAGER_ID` + `META_SYSTEM_USER_TOKEN` —
essas env vars pertencem ao MESMO app "Alizo Trafego Ads", mas são um fluxo tecnicamente
independente do login OAuth (não compartilham código). O login com Facebook grava o token de
usuário de longa duração do próprio cliente (`ad_accounts.access_token`), na mesma coluna que o
campo "Avançado" do método manual já usava — o resto do pipeline (sync de campanhas, motor de
estratégia, execução de ações) é idêntico pros dois caminhos. Diferença em relação ao Conteúdo:
`GET /me/adaccounts` não devolve um token por conta (diferente de `GET /me/accounts` pra Páginas)
— o mesmo token de usuário acessa qualquer conta de anúncio que ele administra, por isso a sessão
de escolha (`traffic_oauth_sessions`) guarda o token uma vez só, não por conta candidata (ver
`lib/traffic/meta-ads-oauth.ts`).
