# Setup de credenciais — Google Search Console (Especialista em SEO)

Pedido do Vinicius (2026-08-23): "o funcionário de SEO precisa de fato trabalhar, buscar
resultados... fazer análises nos Sites indicados". O Search Console é a fonte OFICIAL e gratuita
de desempenho real de busca (cliques, impressões, posição média) — dado que vem do próprio Google,
não de scraping/estimativa de terceiro (diferente do rank tracking via SerpApi, que é pago e nunca
foi configurado neste projeto).

Este documento cobre a configuração **global** (o app Google que faz esse login funcionar). O
fluxo em si já está implementado (`lib/seo/search-console-oauth.ts`, `lib/seo/search-console.ts` +
`app/api/seo/gsc/oauth/{start,callback,finalize}/route.ts`, cron em `app/api/cron/seo/route.ts`) —
o que falta é só a configuração no Google Cloud Console.

## O que você (Vinicius) precisa obter, uma vez só

| Env var | O que é |
|---|---|
| `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` | ID do cliente OAuth 2.0 (não é secreto) |
| `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` | Chave secreta do cliente — nunca no repo, só em Vercel → Settings → Environment Variables |

Deliberadamente um cliente OAuth **dedicado** (não o mesmo `GOOGLE_ADS_CLIENT_ID` do módulo de
Tráfego) — o cliente do Google Ads está registrado com o redirect do OAuth Playground
(`docs/setup/traffic-apis-setup.md`), não do domínio da Alizo, e pede um escopo diferente
(`adwords`). Criar um cliente novo evita reconfigurar algo que já está em produção.

## Passo a passo

1. **Criar (ou reaproveitar) um projeto no [Google Cloud Console](https://console.cloud.google.com)**
   — pode ser o mesmo projeto já usado pro Google Ads (`docs/setup/traffic-apis-setup.md`), ou um
   novo dedicado à Alizo. **Nunca misture com projetos do ecossistema Smarter.**
2. **Ativar a API "Google Search Console API"** — APIs e serviços → Biblioteca → buscar "Search
   Console API" → Ativar. Sem isso, toda chamada da integração falha com erro de API desativada.
3. **Configurar a Tela de consentimento OAuth** (APIs e serviços → Tela de consentimento OAuth),
   se ainda não existir uma pro projeto: tipo "Externo", nome do app (ex: "Alizo — SEO"), e-mail de
   suporte. Não precisa de verificação do Google pra uso interno/com poucos clientes (fica em modo
   "Teste" ou "Em produção" com aviso de app não verificado — ver seção abaixo).
4. **Criar um Cliente OAuth 2.0** (APIs e serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth):
   - Tipo de aplicativo: **Aplicativo da Web**
   - Nome livre (ex: "Alizo SEO — Search Console")
   - **URI de redirecionamento autorizado** (tem que ser EXATAMENTE esta, o Google exige
     correspondência exata):
     ```
     https://www.alizoai.com/api/seo/gsc/oauth/callback
     ```
5. **Copiar o Client ID e o Client Secret** exibidos após criar → colar em
   `GOOGLE_SEARCH_CONSOLE_CLIENT_ID` e `GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET` no Vercel.

## ⚠️ App "não verificado" — o que esperar antes de liberar geral

Enquanto a Tela de consentimento OAuth estiver em modo "Teste" (ou "Em produção" mas sem passar
pela verificação do Google, que exige revisão para escopos sensíveis), o Google mostra um aviso
"Este app não foi verificado pelo Google" na tela de login — o usuário precisa clicar em
"Avançado" → "Acessar [nome do app] (não seguro)" pra continuar. Isso **não impede o fluxo de
funcionar**, só exige esse clique extra. Duas formas de resolver:

- **Modo "Teste"**: adicionar manualmente os e-mails Google de cada cliente como "Usuário de
  teste" na Tela de consentimento (APIs e serviços → Tela de consentimento OAuth → Usuários de
  teste) — só esses e-mails conseguem logar, sem aviso configurável, mas continua mostrando o
  aviso de não verificado. Bom pra testar com poucos clientes reais.
- **Verificação do Google**: submeter o app pra revisão (exige vídeo de demonstração, política de
  privacidade pública) — só necessário quando o número de clientes crescer o suficiente pra
  incomodar. O escopo usado aqui (`webmasters.readonly`) é classificado como "sensível" (não
  "restrito"), a barra de revisão é mais baixa que a de escopos restritos.

## Testar com uma propriedade de teste (recomendado antes de liberar geral)

1. Ter um site já verificado no [Search Console](https://search.google.com/search-console) com a
   conta Google que vai ser usada pra testar.
2. Em `/dashboard/seo`, clicar "Conectar Google Search Console", logar com essa conta, autorizar.
3. Se a conta tiver mais de uma propriedade verificada, escolher qual na tela seguinte.
4. Confirmar que a seção "Desempenho de busca (Search Console)" aparece como conectada — os
   números reais (cliques/impressões/posição) só chegam no próximo ciclo do cron diário (a
   primeira coleta não é imediata), já que a API do Google tem ~3 dias de atraso nos dados mais
   recentes.

## Cadência e renovação de token

O cron (`app/api/cron/seo/route.ts`) consulta o desempenho uma vez por semana por unidade
conectada (dado da API já tem atraso de ~3 dias, não faz sentido consultar todo dia) — renova o
`access_token` a partir do `refresh_token` salvo antes de cada consulta, o refresh token em si não
expira sozinho enquanto o acesso não for revogado pelo usuário em
[myaccount.google.com/permissions](https://myaccount.google.com/permissions).
