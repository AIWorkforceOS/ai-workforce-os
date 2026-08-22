# Setup de credenciais — Login com Facebook (Gestor de Conteúdo)

Pedido do Vinicius (2026-08-22): em vez de o cliente compartilhar a Página manualmente com o
Business Manager da Alizo (método que já existia e continua disponível como alternativa em
"Prefiro o método manual"), ele clica **"Conectar com Facebook"**, faz login com a própria conta e
escolhe a Página — sem colar nenhum ID nem token.

Este documento cobre a configuração **global** (o app da Meta que faz esse login funcionar). O
fluxo em si já está implementado (`lib/content/meta-oauth.ts` +
`app/api/content/accounts/oauth/{start,callback,finalize}/route.ts`) — o que falta é só a
configuração no lado da Meta.

## O que você (Vinicius) precisa obter, uma vez só

| Env var | O que é |
|---|---|
| `META_APP_ID` | ID do app da Meta (não é secreto, mas fica só server-side por simplicidade) |
| `META_APP_SECRET` | Chave secreta do app — nunca no repo, só em Vercel → Settings → Environment Variables |
| `META_LOGIN_CONFIG_ID` | ID da "Configuração de Login" do app (ver passo 6) — não é secreto |

## Passo a passo

1. **Usar o mesmo app da Meta do módulo de Tráfego** (`docs/setup/traffic-apis-setup.md`), ou criar
   um novo em [developers.facebook.com/apps](https://developers.facebook.com/apps) → *Create App*
   → tipo **Business**.
2. **Adicionar o produto "Facebook Login for Business"** ao app (Painel do app → Adicionar produto).
3. **Configurar a URL de redirecionamento válida** (Facebook Login → Configurações):
   ```
   https://www.alizoai.com/api/content/accounts/oauth/callback
   ```
   Tem que ser EXATAMENTE essa URL (a Meta exige correspondência exata). Se um dia o domínio
   mudar, atualizar aqui também.
4. **Pegar o App ID e o App Secret** (Painel do app → Configurações → Básico) → colar em
   `META_APP_ID` e `META_APP_SECRET` no Vercel.
5. **Associar o app a um Portfólio Empresarial (Business Manager)** — Configurações do app →
   Portfólio empresarial, ou pelo próprio Business Manager (business.facebook.com → Configurações
   → Contas → Apps → Adicionar → Conectar um ID do app). Sem isso, as permissões de Página/
   Instagram nem aparecem como opção na Configuração de Login (passo 6) — é uma exigência da
   própria Meta, não uma escolha nossa. **Nunca associe a um Business Manager do ecossistema
   Smarter** — use um dedicado à Alizo (ou o pessoal do dono, se ainda não existir um da Alizo).
6. **Adicionar as 6 permissões aos casos de uso do app** (Painel do app → Casos de uso →
   Personalizar → Permissões e recursos, em cada um: "Gerenciar tudo na sua Página" e "Gerenciar
   mensagens e conteúdo no Instagram"): `pages_show_list`, `pages_manage_posts`,
   `pages_read_engagement`, `instagram_basic`, `instagram_content_publish`, `business_management`
   — clicar "Adicionar" em cada uma até o Status virar "Pronto para teste".
7. **Criar a Configuração de Login** (Login do Facebook para Empresas → Configurações → Criar
   configuração): nome livre, variação "General", token "Token de acesso do usuário" (login
   pessoal do cliente — não "usuário do sistema"), e nas Permissões marcar as mesmas 6 do passo 6.
   A Meta mostra um **"Identificação da configuração"** ao final — esse número vai em
   `META_LOGIN_CONFIG_ID`. Diferente do Login do Facebook clássico, este app **não usa
   `scope=...` na URL de login** — a Configuração de Login é o que define as permissões pedidas.
8. **Colocar o app em modo "Live"** (não "Development") quando for usar com clientes de verdade —
   em Development, só administradores/desenvolvedores/testers cadastrados no próprio app
   conseguem fazer login.

## ⚠️ App Review — provavelmente necessário antes de qualquer cliente real usar

As permissões pedidas no login (`pages_manage_posts`, `instagram_content_publish`) são
permissões avançadas da Meta. Com o app em modo Live, **qualquer conta de terceiro que tentar
logar vai precisar que essas permissões estejam em Advanced Access, aprovado via App Review** —
diferente do módulo de Tráfego, que consegue operar em Standard Access porque usa o padrão de
"conta compartilhada com o system user" (sem tela de login pra terceiros). Aqui, como é login de
verdade de qualquer cliente, o caminho padrão da Meta é exigir revisão.

**Isso não bloqueia testar agora:** enquanto o App Review não sai, o login funciona perfeitamente
com contas cadastradas como Admin/Developer/Tester do próprio app da Meta — é exatamente o
suficiente pra testar o fluxo de ponta a ponta com uma Página sua antes de qualquer cliente real
usar. Pra liberar geral, submeter App Review pedindo `pages_manage_posts` e
`instagram_content_publish`, com um vídeo de demonstração do fluxo (a Meta pede isso).

## Testar com uma conta de teste (recomendado antes de liberar geral)

1. No painel do app da Meta → Funções → adicionar você mesmo (ou quem for testar) como
   Administrador/Tester.
2. Ter uma Página do Facebook de teste com uma Conta Comercial do Instagram vinculada.
3. Em `/dashboard/content/connect`, clicar "Conectar com Facebook", logar com essa conta, escolher
   a Página.
4. Gerar um post (ou usar um já pendente) e clicar "Aprovar e publicar" — confirma que o post sai
   de verdade na Página/Instagram de teste, nunca numa Página de cliente real.

## Diferença de arquitetura vs. o método manual (Business Manager Partner)

O método manual continua existindo (`app/api/content/accounts/connect/route.ts`,
`docs/setup/traffic-apis-setup.md` seção 2) e usa `META_BUSINESS_MANAGER_ID` +
`META_SYSTEM_USER_TOKEN` — nenhuma dessas env vars é usada pelo login OAuth, são apps/fluxos
independentes que podem coexistir. O login com Facebook grava o token de Página do próprio
usuário (`social_accounts.page_access_token`), exatamente na mesma coluna que o método manual já
usava — o resto do pipeline (geração de post, fila de aprovação, publicação via Graph API) é
idêntico pros dois caminhos.
