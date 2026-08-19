# Setup de recebimento de e-mail (Resend Receiving) — resposta do lead ao Sales

Este documento cobre a configuração **global**, que só o Vinicius (dono da conta Resend/DNS)
precisa fazer uma vez, pra fechar o gap encontrado na auditoria de 18-19/08/2026: o Sales envia
e-mail de prospecção fria, mas hoje a resposta do lead **não chega em lugar nenhum** — nem na IA,
nem em nenhum humano. A causa raiz **não é bug de código**: o webhook (`src/app/api/webhooks/email/route.ts`)
e o roteamento (`src/lib/inbound-router.ts`) já estão implementados e testados. Falta só a
configuração operacional abaixo, em produção.

## Por que a resposta não chega hoje

`getEmailReplyTo` (`src/lib/channels/messaging-channel.ts`) decide o endereço de resposta de
cada e-mail enviado:

```ts
export function getEmailReplyTo(unit: Unit): string | null {
  const inboundDomain = process.env.EMAIL_INBOUND_DOMAIN
  if (inboundDomain) return `reply+${unit.id}@${inboundDomain}`
  return unit.email_reply_to
}
```

Sem a env `EMAIL_INBOUND_DOMAIN` configurada em produção, ele cai no fallback `unit.email_reply_to`
— que está `null` em todas as unidades ativas hoje. Resultado: o e-mail de prospecção sai **sem
nenhum Reply-To**, e a resposta do lead vai pro endereço "from" técnico (`EMAIL_FROM_DOMAIN`), uma
caixa que ninguém monitora e que não tem recebimento configurado.

## Passo a passo

### 1. Escolher/criar o domínio de recebimento

Use um subdomínio dedicado só pra isso (recomendado, não obrigatório), por exemplo
`inbound.alizoai.com` ou `mail.alizoai.com` — não precisa ser o mesmo domínio do site.

### 2. Configurar o domínio no Resend

No [dashboard do Resend](https://resend.com/domains) → **Domains** → **Add Domain**:
- Cadastre o domínio escolhido.
- O Resend vai pedir registros **SPF/DKIM** (pro envio, provavelmente já configurados se o envio
  outbound já funciona) e um registro **MX** específico de **Receiving** (recebimento) — é esse
  MX que falta. Adicione-o no provedor de DNS do domínio.
- Aguarde a verificação (o próprio dashboard mostra o status; pode levar até algumas horas por
  causa de propagação de DNS).

### 3. Cadastrar o webhook no Resend

No dashboard do Resend → **Webhooks** → **Add Endpoint**:
- URL: `https://<seu-domínio-de-produção>/api/webhooks/email`
- Eventos a assinar: **`email.received`** (obrigatório), e opcionalmente `email.bounced` e
  `email.complained` (já tratados no código — ficam registrados em System Events/painel de
  observabilidade, sem ação automática).
- O Resend vai gerar um **Signing Secret** — copie ele.

### 4. Configurar as env vars em produção (Vercel)

| Env var | Valor |
|---|---|
| `EMAIL_INBOUND_DOMAIN` | o domínio escolhido no passo 1 (ex.: `inbound.alizoai.com`) |
| `RESEND_WEBHOOK_SECRET` | o Signing Secret gerado no passo 3 |

Sem `RESEND_WEBHOOK_SECRET`, o webhook continua funcionando (não quebra o produto), mas processa
requisições sem validar se vieram mesmo do Resend — o próprio sistema já loga um aviso disso em
System Events (`email_webhook_unsigned`) até a env ser configurada.

### 5. Verificar

- Depois de configurar, o card **"Resend Receiving (resposta do lead por e-mail)"** no painel
  "Saúde das integrações" (Dashboard → Configurações → Integrações) passa a aparecer como
  configurado.
- Teste real: peça pra alguém responder um e-mail de prospecção de verdade (ou crie um lead de
  teste com seu próprio e-mail e responda) — a resposta deve aparecer como mensagem inbound na
  conversa do lead em até alguns segundos.

## O que já está pronto no código (não precisa mexer)

- Verificação de assinatura Svix do webhook.
- Extração da unidade certa via plus-addressing (`reply+{unitId}@EMAIL_INBOUND_DOMAIN`), com
  validação de formato UUID.
- Corte automático do texto citado (histórico da conversa anterior) antes de mandar pro agente.
- Deduplicação de reentrega do mesmo e-mail (nível de aplicação + índice único no banco,
  migration `20260819000065`).
- Log de bounce/reclamação de spam em System Events.
- Isolamento por tenant: a unidade é sempre resolvida pelo endereço de destino do e-mail, nunca
  por dado que o remetente controla.
