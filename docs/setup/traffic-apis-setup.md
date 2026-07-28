# Setup de credenciais — Meta Ads + Google Ads (Traffic Specialist)

Este documento cobre a configuração **global** (Business Manager/MCC da Alizo, developer token,
app OAuth). Para conectar a conta de anúncio **de um cliente específico**, use o fluxo
self-service em `/dashboard/traffic/connect` (implementado em
`src/app/api/traffic/accounts/connect/route.ts` +
`src/lib/traffic/connection-test.ts`) — o próprio cliente cola as credenciais e o sistema testa
com uma chamada real antes de salvar. Este passo a passo abaixo é o que **só o Vinicius (ou o
dono da conta de anúncio)** precisa fazer uma vez para liberar as integrações reais.

## Diferença de complexidade entre as três integrações (self-service)

- **Meta Ads e Facebook/Instagram (Página) — o caminho padrão não pede nenhum token do
  cliente.** A Alizo opera um Business Manager (`META_BUSINESS_MANAGER_ID`) e um usuário do
  sistema global (`META_SYSTEM_USER_TOKEN`). O cliente só precisa compartilhar a conta de
  anúncio (ou a Página) como Parceiro desse Business Manager — sem gerar nada. Para a conta de
  anúncio, `getMetaConfig` (`lib/traffic/meta-ads.ts`) já usa o `META_SYSTEM_USER_TOKEN` global
  direto (o system user acessa a conta compartilhada sem precisar trocar de token). Para a
  Página, `resolveSocialConfig` (`lib/content/meta-content.ts`) troca o `META_SYSTEM_USER_TOKEN`
  por um token de Página em tempo real (`GET /{page-id}?fields=access_token`), o que só funciona
  depois que a Página foi compartilhada com o Business da Alizo. Os campos `access_token`
  (`ad_accounts`) e `page_access_token` (`social_accounts`) continuam existindo só para o caso
  avançado (raro) de alguém que já tem seu próprio token de longa duração e não quer depender do
  compartilhamento.
- **Google Ads — o caminho padrão também não pede nenhum token do cliente.** Como a Alizo já
  opera uma MCC (conta gerenciadora), o cliente só precisa (1) aceitar o convite de vínculo da
  MCC dentro do próprio Google Ads e (2) colar o Customer ID. `getGoogleAdsConfig`
  (`lib/traffic/google-ads.ts`) já cai nos fallbacks globais (`GOOGLE_ADS_REFRESH_TOKEN`,
  `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID/SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`)
  quando a conta não tem overrides próprios. Os campos `google_developer_token` /
  `google_client_id` / `google_client_secret` em `ad_accounts` só existem para o caso avançado
  (raro) de um cliente que já opera sua própria credencial de app OAuth da Google Ads API e não
  quer depender do vínculo com a MCC da Alizo.

> **Business Manager da Alizo:** ainda não existe — é criado manualmente no
> [business.facebook.com](https://business.facebook.com) (fora deste repositório) e o ID vai em
> `META_BUSINESS_MANAGER_ID`. Enquanto essa env var não está configurada, as telas de conexão
> mostram um aviso "integração ainda não disponível" em vez de quebrar (ver `lib/integrations.ts`
> e o painel "Saúde das integrações").

> Enquanto não houver credenciais: `TRAFFIC_USE_MOCK=1` roda tudo com dados de demonstração
> e `TRAFFIC_DRY_RUN=1` impede qualquer escrita nas plataformas (útil nas primeiras semanas).

---

## 1. Meta Ads (Meta Marketing API v25.0)

### O que você (Vinicius) precisa obter, uma vez só

| Env var | O que é |
|---|---|
| `META_BUSINESS_MANAGER_ID` | ID do Business Manager da Alizo — mostrado na tela de conexão para o cliente compartilhar a conta como Parceiro |
| `META_SYSTEM_USER_TOKEN` | Token de system user com acesso às contas de anúncio compartilhadas (fallback global; alternativa: token por conta no campo `access_token` de `ad_accounts`, para quem não usa parceria) |

### Passo a passo (setup único da Alizo)

1. **Criar o Business Manager da Alizo (se ainda não existir):**
   [business.facebook.com](https://business.facebook.com) → criar negócio. O ID aparece em
   Configurações do negócio → Informações do negócio. Esse valor vai em
   `META_BUSINESS_MANAGER_ID`.
2. **Criar o app na Meta:** [developers.facebook.com/apps](https://developers.facebook.com/apps)
   → *Create App* → tipo **Business**. Vincule ao Business Manager da Alizo.
3. **Adicionar o produto Marketing API** ao app.
4. **System User (recomendado para produção):** Business Manager → Configurações do negócio
   → Usuários → **Usuários do sistema** → criar system user *Admin* → **Gerar token** com
   escopos `ads_read`, `ads_management`, `business_management`. Tokens de system user não
   expiram como tokens de usuário. Esse valor vai em `META_SYSTEM_USER_TOKEN` (Vercel →
   Settings → Environment Variables).
5. **App Review / Advanced Access (para escalar):** com *Standard Access* da Marketing API o
   system user já opera qualquer conta de anúncio compartilhada como Parceiro do Business
   Manager da Alizo (passo a passo do cliente abaixo) — suficiente para o caminho padrão. Para
   operar contas de terceiros fora dessa estrutura de parceria, o app precisaria de *Advanced
   Access* em `ads_management` (App Review + Business Verification) — não é necessário para o
   fluxo recomendado.

### Passo a passo do cliente (caminho padrão, sem gerar token)

Isso é o que a tela `/dashboard/traffic/connect` já guia passo a passo — documentado aqui para
referência:

1. No Meta Business Suite da empresa do cliente → Configurações do negócio → Parceiros →
   Adicionar → colar o `META_BUSINESS_MANAGER_ID` da Alizo.
2. Escolher a conta de anúncio e marcar a permissão "Gerenciar campanhas".
3. No OS, colar só o ID da conta de anúncio (`external_account_id`) e testar — nenhum token é
   necessário; o `META_SYSTEM_USER_TOKEN` global da Alizo já acessa a conta compartilhada.

### Caminho avançado (token manual, exceção)

Para clientes que preferem não usar a parceria (ou casos em que o compartilhamento não é
viável), o formulário tem uma seção "Avançado" que aceita um token colado diretamente
(`access_token` em `ad_accounts`), gerado em Configurações do negócio → Usuários → Usuários do
sistema → atribuir a conta → gerar token com escopos `ads_read` + `ads_management`. Esse valor
tem prioridade sobre o `META_SYSTEM_USER_TOKEN` global para aquela conta específica.

### Registro no OS
```
POST /api/traffic/accounts
{ "unit_id": "<uuid>", "platform": "meta", "external_account_id": "act_1234567890",
  "name": "Cliente X — Meta", "access_token": "<token avançado, opcional — normal é ficar de fora>",
  "strategy": { "target_cpa_cents": 3000, "target_roas": 3 } }
```

---

## 2. Facebook/Instagram — Página (Content Specialist)

Mesmo modelo do Meta Ads: o cliente compartilha a Página com a Alizo, sem gerar nenhum token.

### Por que compartilhamento direto na Página (não Parceiros do Business Manager)

Existem dois jeitos de dar acesso de negócio a uma Página no Meta: (a) o dono da Página
compartilha via **Configurações do negócio → Parceiros** do próprio Business Manager dele, ou
(b) direto na **Página → Configurações → Acesso à Página (Nova experiência de Páginas) → Acesso
de parceiros**, colando o Business ID de quem vai gerenciar. Escolhemos **(b)** como caminho
padrão porque a maioria dos donos de Página pequena administra a Página com o perfil pessoal e
**não tem um Business Manager próprio** — a opção (a) exigiria criar um primeiro. A opção (b)
funciona mesmo sem o cliente ter Business Manager: qualquer administrador da Página consegue
atribuir acesso de parceiro por Business ID direto na tela da própria Página.

### Setup único da Alizo

Mesmas env vars do Meta Ads (`META_BUSINESS_MANAGER_ID` + `META_SYSTEM_USER_TOKEN`) — nenhuma
credencial adicional. `resolveSocialConfig` (`lib/content/meta-content.ts`) troca o token do
system user por um token de Página em tempo real via `GET /{page-id}?fields=access_token`,
assim que a Página tiver sido compartilhada.

### Passo a passo do cliente (caminho padrão, sem gerar token)

Guiado na tela `/dashboard/content/connect`:

1. Na Página do Facebook → Configurações → Acesso à Página (Nova experiência de Páginas).
2. Em "Acesso de parceiros" → Atribuir um novo parceiro → colar o `META_BUSINESS_MANAGER_ID`
   da Alizo.
3. Conceder acesso de conteúdo (publicar/gerenciar posts) para essa Página.
4. No OS, colar só o ID da Página (`page_id`) e testar — o Instagram Business vinculado (se
   houver) é detectado automaticamente.

### Caminho avançado (token manual, exceção)

Formulário tem seção "Avançado" que aceita um `page_access_token` de longa duração colado
diretamente (Meta Business Suite / Graph API Explorer, escopos `pages_manage_posts`,
`pages_read_engagement`, `instagram_basic`, `instagram_content_publish`). Tem prioridade sobre
a troca via system user para aquela Página específica.

### Registro no OS
```
POST /api/content/accounts/connect
{ "unit_id": "<uuid>", "page_id": "1234567890",
  "page_access_token": "<token avançado, opcional — normal é ficar de fora>" }
```

---

## 3. Google Ads (Google Ads API v24)

### O que você precisa obter
| Env var | O que é |
|---|---|
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Token de desenvolvedor da API (aprovado pelo Google) |
| `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` | Credencial OAuth 2.0 do app no Google Cloud |
| `GOOGLE_ADS_LOGIN_CUSTOMER_ID` | Customer ID da MCC da Alizo (sem hífens) — necessário quando a MCC opera contas de clientes |
| `GOOGLE_ADS_REFRESH_TOKEN` | (opcional, fallback global) refresh token OAuth; o normal é um por conta em `ad_accounts.refresh_token` |

### Passo a passo

1. **Criar uma conta de administrador (MCC):** [ads.google.com/home/tools/manager-accounts](https://ads.google.com/home/tools/manager-accounts).
   As contas dos clientes serão vinculadas a ela (a MCC envia convite; o cliente aceita
   em Administração → Acesso e segurança).
2. **Developer token:** na MCC → Ferramentas → **Central de API** → solicitar token.
   - Nasce em *Test Account Access* (só contas de teste).
   - Solicite **Basic Access** preenchendo o formulário (caso de uso: gestão de campanhas
     dos próprios clientes). Aprovação típica: 1–3 dias úteis.
3. **Projeto no Google Cloud Console:** [console.cloud.google.com](https://console.cloud.google.com)
   → criar projeto → **APIs & Services → Library → Google Ads API → Enable**.
4. **OAuth consent screen:** tipo *External*, escopo `https://www.googleapis.com/auth/adwords`.
   Em produção, publicar o app (em *Testing*, refresh tokens expiram em 7 dias!).
5. **Credencial OAuth:** APIs & Services → Credentials → **Create Credentials → OAuth client ID**
   → *Web application* (redirect `https://developers.google.com/oauthplayground` para o passo 6)
   → guarde Client ID e Client Secret.
6. **Gerar o refresh token** (uma vez por conta Google que administra os anúncios):
   [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground) →
   ⚙️ → *Use your own OAuth credentials* (cole ID/Secret) → autorize o escopo
   `https://www.googleapis.com/auth/adwords` logado na conta Google com acesso à MCC →
   *Exchange authorization code for tokens* → copie o **refresh_token**.
7. **Customer IDs:** o da MCC (ex: `123-456-7890` → `1234567890`) vai em
   `GOOGLE_ADS_LOGIN_CUSTOMER_ID`; o da conta do cliente vai em `external_account_id`
   no registro da conta no OS.

### Registro no OS
```
POST /api/traffic/accounts
{ "unit_id": "<uuid>", "platform": "google", "external_account_id": "1234567890",
  "name": "Cliente X — Google", "refresh_token": "<refresh token do passo 6 (opcional se global)>",
  "strategy": { "target_cpa_cents": 3000, "target_roas": 3 } }
```

---

## 4. Envs de controle do agente

| Env | Efeito |
|---|---|
| `CRON_SECRET` | já existe — protege `/api/cron/traffic` |
| `TRAFFIC_USE_MOCK=1` | pipeline com dados mockados (demo/validação) |
| `TRAFFIC_DRY_RUN=1` | execuções registradas em `ad_actions_log` como `dry_run`, sem chamada real |
| `OPENAI_API_KEY` | já existe — habilita o resumo executivo gerado por IA (sem ela, resumo determinístico) |

## 5. Ordem recomendada de go-live com cliente pagante

1. Aplicar a migration `20260713000007` no Supabase (via CLI ou SQL editor).
2. Criar `agent_configs` com `agent_type='traffic_specialist'`, `is_active=true` na unidade.
3. Conectar a conta com credenciais reais + `TRAFFIC_DRY_RUN=1`.
4. Rodar sync manual, conferir métricas e decisões no dashboard por alguns dias
   (modo `suggestion`, sem executar nada).
5. Remover `TRAFFIC_DRY_RUN`, manter modo `suggestion` — aprovar manualmente cada ação.
6. Só depois de confiança estabelecida, avaliar `optimization_mode='autonomous'` por conta.
