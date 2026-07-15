# Setup de credenciais — Meta Ads + Google Ads (Traffic Specialist)

Este documento cobre a configuração **global** (Business Manager/MCC da Alizo, developer token,
app OAuth). Para conectar a conta de anúncio **de um cliente específico**, use o fluxo
self-service em `/dashboard/traffic/connect` (implementado em
`src/app/api/traffic/accounts/connect/route.ts` +
`src/lib/traffic/connection-test.ts`) — o próprio cliente cola as credenciais e o sistema testa
com uma chamada real antes de salvar. Este passo a passo abaixo é o que **só o Vinicius (ou o
dono da conta de anúncio)** precisa fazer uma vez para liberar as integrações reais.

## Diferença de complexidade entre as duas plataformas (self-service)

- **Meta Ads — o cliente sempre precisa gerar uma credencial** (token de usuário do sistema).
  Não tem como o cliente conectar a conta sem gerar esse token, então o formulário sempre pede
  ID da conta + token.
- **Google Ads — o caminho padrão não pede nenhum token do cliente.** Como a Alizo já opera uma
  MCC (conta gerenciadora), o cliente só precisa (1) aceitar o convite de vínculo da MCC dentro
  do próprio Google Ads e (2) colar o Customer ID. `getGoogleAdsConfig` (`lib/traffic/google-ads.ts`)
  já cai nos fallbacks globais (`GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
  `GOOGLE_ADS_CLIENT_ID/SECRET`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID`) quando a conta não tem
  overrides próprios — por isso o fluxo self-service de Google é o mais simples dos dois, apesar
  da API ser mais complexa por baixo do capô. Os campos `google_developer_token` /
  `google_client_id` / `google_client_secret` em `ad_accounts` só existem para o caso avançado
  (raro) de um cliente que já opera sua própria credencial de app OAuth da Google Ads API e não
  quer depender do vínculo com a MCC da Alizo.

> Enquanto não houver credenciais: `TRAFFIC_USE_MOCK=1` roda tudo com dados de demonstração
> e `TRAFFIC_DRY_RUN=1` impede qualquer escrita nas plataformas (útil nas primeiras semanas).

---

## 1. Meta Ads (Meta Marketing API v25.0)

### O que você precisa obter
| Env var | O que é |
|---|---|
| `META_SYSTEM_USER_TOKEN` | Token de system user com acesso às contas de anúncio (fallback global; alternativa: token por conta no campo `access_token` de `ad_accounts`) |

### Passo a passo

1. **Criar o app na Meta:** [developers.facebook.com/apps](https://developers.facebook.com/apps)
   → *Create App* → tipo **Business**. Vincule ao Business Manager da Alizo.
2. **Adicionar o produto Marketing API** ao app.
3. **Modo desenvolvimento (funciona hoje, sem review):** com *Standard Access* da Marketing
   API você já opera contas de anúncio das quais o app/Business é dono ou parceiro — é o
   suficiente para testar com a própria conta e com clientes que aceitarem a Alizo como
   **Parceiro** no Business Manager deles (Configurações do negócio → Parceiros →
   compartilhar a conta de anúncio com permissão "Gerenciar campanhas").
4. **System User (recomendado para produção):** Business Manager → Configurações do negócio
   → Usuários → **Usuários do sistema** → criar system user *Admin* → atribuir as contas de
   anúncio → **Gerar token** com escopos `ads_read`, `ads_management`, `business_management`.
   Tokens de system user não expiram como tokens de usuário. Esse valor vai em
   `META_SYSTEM_USER_TOKEN` (Vercel → Settings → Environment Variables).
5. **App Review / Advanced Access (para escalar):** para operar contas de terceiros fora da
   estrutura de parceria, o app precisa de *Advanced Access* em `ads_management` — App Review
   com caso de uso descrito, vídeo de demonstração e Business Verification da Alizo
   (CNPJ + documento). Prazo típico: dias a poucas semanas.
6. **Conferir a conta:** o id usado no OS é o numérico (com ou sem prefixo `act_`), visível
   no Ads Manager (canto superior) ou em Configurações do negócio → Contas de anúncio.

### Registro no OS
```
POST /api/traffic/accounts
{ "unit_id": "<uuid>", "platform": "meta", "external_account_id": "act_1234567890",
  "name": "Cliente X — Meta", "access_token": "<token do system user (opcional se global)>",
  "strategy": { "target_cpa_cents": 3000, "target_roas": 3 } }
```

---

## 2. Google Ads (Google Ads API v24)

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

## 3. Envs de controle do agente

| Env | Efeito |
|---|---|
| `CRON_SECRET` | já existe — protege `/api/cron/traffic` |
| `TRAFFIC_USE_MOCK=1` | pipeline com dados mockados (demo/validação) |
| `TRAFFIC_DRY_RUN=1` | execuções registradas em `ad_actions_log` como `dry_run`, sem chamada real |
| `OPENAI_API_KEY` | já existe — habilita o resumo executivo gerado por IA (sem ela, resumo determinístico) |

## 4. Ordem recomendada de go-live com cliente pagante

1. Aplicar a migration `20260713000007` no Supabase (via CLI ou SQL editor).
2. Criar `agent_configs` com `agent_type='traffic_specialist'`, `is_active=true` na unidade.
3. Conectar a conta com credenciais reais + `TRAFFIC_DRY_RUN=1`.
4. Rodar sync manual, conferir métricas e decisões no dashboard por alguns dias
   (modo `suggestion`, sem executar nada).
5. Remover `TRAFFIC_DRY_RUN`, manter modo `suggestion` — aprovar manualmente cada ação.
6. Só depois de confiança estabelecida, avaliar `optimization_mode='autonomous'` por conta.
