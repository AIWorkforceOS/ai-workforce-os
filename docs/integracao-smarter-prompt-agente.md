# Prompt para o agente do lado da Smarter — integração com o AlizoAI

> Como usar: copie TUDO abaixo da linha "INÍCIO DO PROMPT" e cole no agente que
> trabalha no repositório do Sistema Smarter. Antes, preencha os `<PLACEHOLDERS>`
> (tokens e IDs) — eles NÃO estão neste arquivo de propósito. Este documento só
> descreve contratos de API; nenhum segredo foi gravado aqui.

---------------------------------- INÍCIO DO PROMPT ----------------------------------

# Missão

Você é o agente de engenharia do **Sistema Smarter** (sistema.smarterestagios.com.br).
Sua tarefa: integrar a Smarter ao **AlizoAI** (plataforma de funcionários digitais) para que
a Smarter use, via API HTTP:

1. o **WhatsApp + Sales Rep (SDR) do Alizo** para contatar e conversar com leads;
2. a **prospecção do Google Maps do Alizo** (o Sales Rep captura leads sozinho);
3. o **Recrutador (RH) do Alizo** (vagas, triagem de candidatos).

## Regras de isolamento (obrigatórias)

- Trabalhe SOMENTE no repositório da Smarter. **Nunca** acesse, leia ou modifique o
  repositório, o banco Supabase ou o código do AlizoAI. A única ponte é HTTP, com os
  tokens fornecidos abaixo.
- Nunca grave tokens no código nem no git. Use variáveis de ambiente (nomes sugeridos
  abaixo) e falhe de forma graciosa (log + no-op) quando a variável não estiver definida.
- Não invente endpoints do Alizo. Use apenas os listados na seção "Contratos que EXISTEM
  hoje". O que está em "Lacunas" **não existe ainda** — não tente chamar; implemente do
  lado da Smarter só o que for possível e sinalize o restante.
- Toda mudança de schema na Smarter vai por nova migration (nunca editar migration aplicada).

## Dados gerais do Alizo

- URL base de produção: `https://app.alizoai.com` (usada nos callbacks OAuth do produto).
  Confirme com o responsável se o host da API em produção é `app.alizoai.com` ou
  `www.alizoai.com` antes de ir ao ar — ambos aparecem na documentação do Alizo.
  Variável sugerida na Smarter: `ALIZO_API_BASE_URL=<URL_BASE_CONFIRMADA>`.
- Todas as rotas abaixo respondem JSON, erros no formato `{ "error": "mensagem em pt-BR" }`.
- Modelo de tenancy do Alizo: **organização → unidades**. Cada unidade (loja/franquia)
  tem seu próprio WhatsApp, Sales Rep, Recrutador e tokens. A Smarter deve mapear
  **1 franquia/unidade Smarter ↔ 1 unidade Alizo**.
- Telefones: o Alizo normaliza removendo tudo que não é dígito; mínimo 10 dígitos
  (formato recomendado: DDI+DDD+número, ex.: `5511999990000`).

## Contratos que EXISTEM hoje (Smarter → Alizo)

### 1) Entregar lead ao Sales Rep do Alizo (usa o WhatsApp/e-mail do Alizo)

**Endpoint recomendado para a Smarter** — token público escopado por unidade:

```
POST {ALIZO_API_BASE_URL}/api/public/lead-intake
Authorization: Bearer <ALIZO_PUBLIC_LEAD_INTAKE_TOKEN_DA_UNIDADE>   # units.public_lead_intake_token
Content-Type: application/json

{ "name": "Maria Silva",        // obrigatório (string)
  "phone": "5511999990000",     // obrigatório (string, >=10 dígitos)
  "source": "smarter_site",     // obrigatório (string livre p/ rastrear origem)
  "note": "Quer estagiários de Direito" }  // opcional
```

Respostas:
- `200 { ok: true, lead_id, contacted }` — lead criado; `contacted` indica se o Sales Rep já
  disparou o primeiro contato (respeita agente ativo, horário ativo e limite diário).
- `200 { ok: true, lead_id, duplicate: true }` — telefone já existe na unidade (idempotente).
- `400` payload/telefone inválido · `401` token ausente/errado · `429` rate limit
  (10 req/min por token, em memória por instância — implemente retry com backoff).

**Alternativa** (mais campos, token por unidade OU global):

```
POST {ALIZO_API_BASE_URL}/api/intake/lead
Authorization: Bearer <units.intake_token DA UNIDADE>  (ou INTAKE_SECRET global, só se combinado)
{ "unit_slug": "<slug-da-unidade>",  // obrigatório
  "phone": "...",                    // obrigatório
  "name": "...", "email": "...", "source": "smarter", "notes": "...",
  "send_whatsapp": true }            // false = só cadastra, sem primeiro contato
```
Resposta: `{ ok: true, lead_id, duplicate? }` · `404` slug inexistente · `401`.

Efeito: o Sales Rep do Alizo pesquisa a empresa, escreve o primeiro contato e envia pelo
WhatsApp da unidade (Evolution API) e/ou e-mail; as respostas do lead são atendidas pela IA
automaticamente, com escalação para humano por palavra-chave.

### 2) Candidatura pública a uma vaga do Recrutador

```
GET  {ALIZO_API_BASE_URL}/api/public/job-application/<PUBLIC_APPLICATION_TOKEN_DA_VAGA>
     -> { job: {id,title}, company, accepting_applications }

POST {ALIZO_API_BASE_URL}/api/public/job-application/<TOKEN_DA_VAGA>
     multipart/form-data: name (obrig.), email?, phone?, resume? (PDF, máx. 15 MB)
```
O candidato entra no pipeline da vaga (pontuação automática). Rate limit 10/min por token.
Token por vaga (`job_openings.public_application_token`); há também a página pública
`{ALIZO_API_BASE_URL}/vaga/<token>` que a Smarter pode linkar para os alunos.

### 3) Conexão do WhatsApp da unidade (QR code) — link público

```
POST {ALIZO_API_BASE_URL}/api/public/units/<UNIT_ID>/whatsapp/connect?token=<WHATSAPP_CONNECT_TOKEN>
     body opcional: { "agentType": "sdr" | "receptionist" | ... }  -> { qrCode, pairingCode }
GET  {ALIZO_API_BASE_URL}/api/public/units/<UNIT_ID>/whatsapp/status?token=<WHATSAPP_CONNECT_TOKEN>[&agentType=...]
```
Serve para a Smarter exibir/embutir o pareamento do número do franqueado. `token` =
`units.whatsapp_connect_token` (obrigatório; sem ele, 401).

## Contratos que o Alizo JÁ consome da Smarter (Alizo → Smarter)

Estes endpoints são **da Smarter**; o Alizo já os chama. A Smarter deve **manter a
compatibilidade** (não quebrar o contrato) e pode reaproveitá-los:

| Finalidade | Endpoint Smarter | Auth |
|---|---|---|
| Espelhar leads do Sales Rep no CRM de parceiros | `POST /api/partners/leads`, `PATCH /api/partners/leads/{id}` (campos: empresa, contato, email, telefone, whatsapp, cidade, uf, setor, origem, prioridade, anotacao, valorNegociado; etapa/situacao/proximaAcao no PATCH) | Bearer = token de parceiro **por unidade** |
| Leads do CRM de Franquias (leitura) | `GET /api/partners/franquia-leads` | Bearer = token escopo `franquia_crm` (nível rede) |
| Candidatos (sourcing do Recrutador) | `GET /api/partners/candidates?course=&city=&updated_since=&limit=` | Bearer = token de parceiro; só candidatos com consentimento |
| Publicar vaga e associar candidatos (modo `smarter`) | cliente em `smarter-recruiting-client` do Alizo (criar vaga + adicionar candidato à vaga, usando `companyId`) | Bearer = token de parceiro + `companyId` por unidade |

> Observação: os caminhos de vagas/associação (último item) devem ser conferidos no
> código da própria Smarter — o Alizo os trata como contrato de parceria com campos
> opcionais tolerados.

## Prospecção do Google Maps (Sales Rep)

- Roda **sozinha no Alizo** (cron manhã/meio-dia/tarde) por unidade, lendo
  `agent_configs.prospecting_profile` (tipos de negócio/ramo, região). Teto de **15 leads
  novos/dia/unidade**, separado do limite diário de mensagens. Não há endpoint para
  disparar uma busca sob demanda.
- Como a Smarter “usa” isso hoje: **configurar o perfil de prospecção no painel do Alizo**
  da unidade e, se `crm_integration_mode = 'smarter'`, os leads capturados já são
  **espelhados no CRM da Smarter** (item "Espelhar leads" acima) — a Smarter só precisa
  garantir que `POST/PATCH /api/partners/leads` aceite e deduplique esses leads.

## ATUALIZAÇÃO — API de parceiro do Alizo (`/api/partner/v1`)

Foi implementada uma API de parceiro com chave Bearer (`alz_live_...`), escopos e
webhooks assinados (HMAC-SHA256). **Referência completa e contratos: `docs/partner-api.md`**
(cole o conteúdo desse arquivo junto com este prompt). Ela cobre o que as "Lacunas" abaixo
listavam: enviar mensagem pelo Sales Rep, ler conversas, disparar/configurar prospecção do
Google Maps, criar vagas e candidatos no Recrutador e receber eventos
(`lead.message.received`, `lead.message.sent`, `lead.deal_won`, `lead.created`).
Prefira essa API aos endpoints públicos acima. Ela só passa a existir em produção depois
que a migration 20261113000003 for aplicada e uma chave for emitida pelo admin do Alizo.

## Lacunas antigas (resolvidas pela API acima — mantidas só como histórico)

1. **Sem API autenticada por chave para a Smarter**: enviar mensagem WhatsApp arbitrária,
   ler/ouvir conversas, listar leads/conversas, ou disparar prospecção Maps/Recrutador sob
   demanda. As rotas `/api/leads`, `/api/jobs`, `/api/units/*` exigem **sessão de usuário
   logado** (cookie Supabase), não token de parceiro.
2. **Sem webhook de saída do Alizo → Smarter** para eventos (resposta do lead, handoff de
   venda, shortlist pronta). Hoje a Smarter só vê mudanças via o espelho do CRM (PATCH de etapa).
3. **Sem endpoint de listagem de vagas/candidatos do Recrutador por token.**

Se o objetivo é a Smarter “comandar” os funcionários do Alizo (não só alimentar), é
necessário construir no Alizo uma **API de parceiro com chave por organização/unidade**
(escopos: `leads:write`, `messages:send`, `prospecting:run`, `jobs:read/write`, mais
webhooks assinados com HMAC de saída). Isso deve ser feito **no repositório do Alizo**, por
outro agente/tarefa. **Não tente contornar usando sessão de usuário ou o banco do Alizo.**

## O que implementar do lado da Smarter (entregáveis)

1. Módulo `alizo-client` (HTTP) com: `createLead(unit, {name, phone, source, note})`,
   `getJobApplicationInfo(token)`, `submitJobApplication(token, formData)`,
   `getWhatsappConnectStatus(unitId)`. Timeout 10 s, retry com backoff em 429/5xx,
   mapeamento de erros pelo `error` em pt-BR, log sem vazar tokens.
2. Tabela/config por franquia: `alizo_unit_id`, `alizo_unit_slug`,
   `alizo_public_lead_intake_token` (criptografado), `alizo_whatsapp_connect_token`
   (criptografado), vagas ↔ `public_application_token`. Migration nova.
3. Gatilhos: ao criar/qualificar um lead de estágio/vaga na Smarter com consentimento
   (opt-in) → `createLead` com `source` rastreável; gravar o `lead_id` do Alizo no registro.
   Idempotência: tratar `duplicate: true` como sucesso. **Respeitar LGPD**: só enviar leads
   com base legal/consentimento para contato.
4. Para o Recrutador: botão/URL na Smarter que leva o aluno a `.../vaga/<token>` ou envia
   candidatura via `submitJobApplication` (PDF até 15 MB).
5. Garantir que `POST/PATCH /api/partners/leads` e `GET /api/partners/candidates` continuem
   estáveis (o Alizo depende deles) — adicionar testes de contrato.
6. Testes automatizados com o cliente HTTP mockado, mais um script de smoke test
   (`ALIZO_API_BASE_URL` + token de homologação) que cria 1 lead e confirma `ok:true`.
7. Rode lint, typecheck, testes e build da Smarter antes de qualquer commit; commits em
   português (Conventional Commits).

## Variáveis de ambiente sugeridas (Smarter)

```
ALIZO_API_BASE_URL=<URL_BASE_CONFIRMADA>
# por unidade, guardados no banco da Smarter (criptografados), NÃO em env:
#   ALIZO_PUBLIC_LEAD_INTAKE_TOKEN, ALIZO_WHATSAPP_CONNECT_TOKEN, ALIZO_UNIT_ID, ALIZO_UNIT_SLUG
```

## Pendências que dependem de pessoas (não resolva sozinho — pergunte)

- Quais unidades Smarter ↔ quais unidades Alizo (IDs/slugs).
- Quem fornece os tokens por unidade (Alizo → painel Configurações da unidade /
  Vinicius) e o host definitivo da API.
- Decisão de produto: criar a API de parceiro completa no Alizo (ver "Lacunas")?

----------------------------------- FIM DO PROMPT -----------------------------------
