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

## O que você (Vinicius) precisa obter, uma vez só

| Env var | O que é |
|---|---|
| `META_APP_ID` | Mesmo app da Meta já usado pelo login do Gestor de Conteúdo (`docs/setup/content-oauth-setup.md`) — não precisa criar um novo app |
| `META_APP_SECRET` | Idem — já configurado |
| `META_ADS_LOGIN_CONFIG_ID` | ID de uma "Configuração de Login" **separada** da do Conteúdo (ver passo abaixo) — não é secreto |

## Por que uma Configuração de Login separada (`META_ADS_LOGIN_CONFIG_ID` ≠ `META_LOGIN_CONFIG_ID`)

No painel da Meta, uma Configuração de Login empacota um conjunto fixo de permissões pra um caso
de uso específico. O caso de uso do Conteúdo ("Gerenciar tudo na sua Página"/Instagram) e o de
Tráfego (Marketing API/`ads_management`) são categorias diferentes na Meta — mais simples (e mais
alinhado ao que a própria Meta espera no App Review) manter duas configurações separadas dentro do
mesmo app, cada uma só com as permissões que o respectivo fluxo realmente usa.

## Passo a passo

1. **Usar o mesmo app da Meta já criado** (`docs/setup/content-oauth-setup.md` / `traffic-apis-setup.md`)
   — não criar um app novo.
2. A **URL de redirecionamento** deste fluxo é diferente da do Conteúdo — adicionar às URLs
   válidas do Facebook Login (Facebook Login → Configurações), sem remover a do Conteúdo:
   ```
   https://www.alizoai.com/api/traffic/accounts/oauth/callback
   ```
   Tem que ser EXATAMENTE essa URL.
3. **Adicionar as permissões ao caso de uso "Marketing API"** (Painel do app → Casos de uso →
   Personalizar → Permissões e recursos): `ads_management`, `ads_read`, `business_management` —
   clicar "Adicionar" em cada uma até o Status virar "Pronto para teste".
4. **Criar uma NOVA Configuração de Login** (Login do Facebook para Empresas → Configurações →
   Criar configuração): nome livre (ex.: "Tráfego Pago — contas de anúncio"), variação "General",
   token "Token de acesso do usuário", e nas Permissões marcar as 3 do passo 3. A Meta mostra um
   **"Identificação da configuração"** ao final — esse número vai em `META_ADS_LOGIN_CONFIG_ID`
   (Vercel → Settings → Environment Variables).
5. **Colocar o app em modo "Live"** (se ainda não estiver) — em Development, só
   administradores/desenvolvedores/testers cadastrados no próprio app conseguem fazer login.

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

1. No painel do app da Meta → Funções → confirmar que você (ou quem for testar) já está como
   Administrador/Tester (mesmo cadastro usado pro teste do login de Conteúdo).
2. Ter uma conta de anúncio de teste (a sua própria já serve).
3. Em `/dashboard/traffic/connect`, clicar "Conectar com Facebook", logar com essa conta, escolher
   a conta de anúncio.
4. Confirmar que a conta aparece como "Conectada" na lista — não precisa rodar nenhuma campanha
   real pra validar o login em si.

## Diferença de arquitetura vs. o método manual (Business Manager Partner)

O método manual continua existindo (`app/api/traffic/accounts/connect/route.ts`,
`docs/setup/traffic-apis-setup.md`) e usa `META_BUSINESS_MANAGER_ID` + `META_SYSTEM_USER_TOKEN` —
nenhuma dessas env vars é usada pelo login OAuth, são fluxos independentes que podem coexistir. O
login com Facebook grava o token de usuário de longa duração do próprio cliente
(`ad_accounts.access_token`), na mesma coluna que o campo "Avançado" do método manual já usava —
o resto do pipeline (sync de campanhas, motor de estratégia, execução de ações) é idêntico pros
dois caminhos. Diferença em relação ao Conteúdo: `GET /me/adaccounts` não devolve um token por
conta (diferente de `GET /me/accounts` pra Páginas) — o mesmo token de usuário acessa qualquer
conta de anúncio que ele administra, por isso a sessão de escolha (`traffic_oauth_sessions`) guarda
o token uma vez só, não por conta candidata (ver `lib/traffic/meta-ads-oauth.ts`).
