# API de parceiro do AlizoAI — `/api/partner/v1`

Permite que um sistema externo autorizado (ex.: Sistema Smarter) use os funcionários
digitais do Alizo por HTTP: Sales Rep (WhatsApp + prospecção Google Maps) e Recrutador.
Migration: `20261113000003_partner_api.sql` (**ainda não aplicada** — ver "Ativação").

## Autenticação

```
Authorization: Bearer alz_live_<prefixo>_<segredo>
```

- Chave **por organização**; opcionalmente **restrita a uma unidade**. Nunca enxerga outra org.
- Cada chave tem **escopos** (menor privilégio). Sem o escopo → `403`.
- Só o hash SHA-256 é guardado; a chave completa aparece **uma única vez** ao criar.
- Limite: 120 req/min por chave (`429`). Erros: `{ "error": "mensagem em pt-BR" }`.
- Chave revogada/expirada → `401`.

### Escopos

| Escopo | Permite |
|---|---|
| `units:read` | listar unidades |
| `leads:read` / `leads:write` | listar/ler / criar leads |
| `messages:read` / `messages:send` | ler conversa / enviar mensagem pelo Sales Rep |
| `prospecting:run` | disparar rodada do Google Maps |
| `prospecting:write` | ler/alterar o perfil de prospecção |
| `jobs:read` / `jobs:write` | ler / criar vagas e adicionar candidatos |
| `events:read` | polling de eventos |
| `webhooks:manage` | cadastrar/remover webhooks |

## Gerenciar chaves (admin do Alizo, com sessão)

| Método | Rota | |
|---|---|---|
| `POST` | `/api/admin/partner-keys` | `{ name, scopes[], unitId?, orgId?, expiresAt? }` → devolve `key` (uma vez) |
| `GET` | `/api/admin/partner-keys` | lista (prefixo, escopos, último uso) — nunca a chave |
| `DELETE` | `/api/admin/partner-keys/{id}` | revoga na hora |

Quem pode: super admin ou administrador completo da empresa (`canManageUserAccess`). Dono de unidade só cria chave da própria unidade.
Ainda **não há tela** — por enquanto é via API (ou peça ao Claude para criar).

## Endpoints

### Unidades
`GET /units` → `{ units: [{ id, slug, name, city, state, whatsapp_phone, timezone }] }`

### Leads (Sales Rep + WhatsApp)
- `POST /leads` — `{ unit_id|unit_slug, name, phone, email?, source?, notes?, external_id?, first_contact? }`
  - **Idempotente**: mesmo telefone na unidade, ou mesmo `(source, external_id)` → `200 { duplicate: true, lead }`, sem novo contato.
  - `first_contact` (padrão `true`): o Sales Rep faz o 1º contato, respeitando agente ativo, horário e limite diário. `contacted` na resposta diz se já foi.
  - `first_contact:false` → lead entra `paused`, fora de toda automação (útil p/ contato de empresa do Recrutador).
- `GET /leads?unit_id=&status=&updated_since=&before=&limit=` (≤100) → `{ leads, next_before }`
- `GET /leads/{id}`
- `GET /leads/{id}/messages?before=&limit=` — conversa (mais recentes primeiro)
- `POST /leads/{id}/messages` — `{ text }` (≤2000). Header recomendado `Idempotency-Key`.
  Envia pelo canal do Sales Rep; **conta no limite diário** do agente (`429` se estourar); `409` se o agente não está ativo. A resposta do lead continua sendo atendida pela IA.

### Google Maps
- `POST /prospecting/run` — `{ unit_id|unit_slug }`: roda **agora** uma rodada. Mesmas travas dos crons: teto de **15 leads novos/dia/unidade**, horário ativo, limite diário, e prospecção fria só por **e-mail**. `503` se o Alizo não tem Google Maps configurado.
- `GET|PUT /prospecting/profile` — `{ mode, business_types[], region, general_sector, headcount_range }`. Não ativa o agente nem muda limites.
- Leads capturados pelo Maps aparecem em `GET /leads?source…` (filtre por `source=google_maps` no seu lado) e são espelhados no CRM da Smarter se a unidade estiver em modo `smarter`.

### Recrutador
- `POST /jobs` — `{ unit_id, title, lead_id?, urgency?, hiring_deadline?, target_shortlist_size?, profile? }` → vaga em `draft` + `public_application_url`. Com `lead_id` (contato da empresa) o cron do Recrutador inicia o intake no horário ativo.
- `GET /jobs?unit_id=&status=` · `GET /jobs/{id}`
- `GET /jobs/{id}/candidates` — pipeline (stage, `match_score`, `ai_score`, `rank`).
- `POST /jobs/{id}/candidates` — `{ name, email?|phone?, notes?, resume_url? (https), consent: true }`. **`consent:true` é obrigatório** (LGPD: o parceiro declara que o candidato autorizou contato). Mesma pontuação do sourcing.

### Webhooks e eventos
- `POST /webhooks` — `{ url (https público), events?: ["*"] }` → devolve `secret` **uma vez**. Máx. 5 por chave.
- `GET /webhooks` · `DELETE /webhooks/{id}`
- `GET /events?since=&before=&type=&limit=` — mesmo conteúdo por polling (recupera entregas perdidas).

**Eventos:** `lead.created` (via API), `lead.message.received`, `lead.message.sent`, `lead.deal_won`.
Leads capturados pelo Maps **não** geram `lead.created` — use `GET /leads`.

**Entrega:** `POST` JSON `{ id, type, created_at, org_id, unit_id, data }` com headers
`Alizo-Event`, `Alizo-Event-Id` e `Alizo-Signature: t=<unix>,v1=<hex>`, onde
`v1 = HMAC-SHA256(secret, "<t>.<corpo bruto>")`. Valide a assinatura e rejeite `t` com mais de 5 min.
Timeout 5 s, sem redirecionamento. **Sem retry automático** (best-effort): use `GET /events` para reconciliar. Idempotência do lado do parceiro pelo `id` do evento.

## Ativação (checklist)

1. **Aplicar a migration 20261113000003** (Vinicius) — sem ela as rotas respondem 401/erro.
2. Criar a chave: `POST /api/admin/partner-keys` logado como admin, escopos mínimos necessários.
3. Entregar a chave à Smarter por canal seguro (nunca no git/chat).
4. Confirmar o host de produção da API e `NEXT_PUBLIC_APP_URL` (usado em `public_application_url`).

## Limitações conhecidas

- Sem retry de webhook (best-effort) e sem fila; entregas rodam no mesmo request que gerou o evento (até 5 s a mais na resposta ao lead quando há endpoint).
- Rate limit e proteção anti-SSRF são básicos (memória por instância; sem resolução de DNS).
- Não há tela de chaves/webhooks no painel.
- Eventos só do Sales Rep (conversation-engine). Recrutador não emite evento ainda.
