# Integração de suporte de um sistema parceiro

Este contrato permite que outro produto abra chamados no funcionário TI da
Alizo sem compartilhar banco, sessão, código ou credenciais internas.

## No AI Workforce

1. Aplicar a migration `20261028063701_ti_support_cases.sql`.
2. Criar um segredo forte em `SUPPORT_PARTNER_API_TOKEN` no ambiente da Vercel.
3. Cadastrar previamente no AI Workforce a organização e, opcionalmente, a
   unidade que representam o cliente do sistema parceiro.

## No repositório do sistema parceiro

Abra uma tarefa separada no repositório correto e peça:

> Implementar um conector server-side de suporte para `POST
> https://www.alizoai.com/api/integrations/support/cases`. Guardar o token
> somente no servidor como `SUPPORT_PARTNER_API_TOKEN`; nunca enviá-lo ao
> navegador. Mapear o cliente autenticado para `orgId`/`unitId` previamente
> cadastrados no AI Workforce, enviar um `externalReference` idempotente por
> chamado e nunca permitir que esse endpoint execute reparos.

Corpo JSON:

```json
{
  "orgId": "uuid",
  "unitId": "uuid-ou-null",
  "externalReference": "identificador-unico-do-chamado-na-origem",
  "reporterName": "Nome",
  "reporterEmail": "email@empresa.com",
  "reporterPhone": "+5511999999999",
  "category": "bug",
  "title": "Resumo curto",
  "description": "Relato completo, caminho percorrido e erro exibido"
}
```

Autorização: `Authorization: Bearer <SUPPORT_PARTNER_API_TOKEN>`.

Resposta `201` cria um chamado; `200` devolve o chamado já existente para o
mesmo `externalReference`. A resposta contém `id`, `protocol` e `created`.

Este endpoint é somente de entrada. Diagnóstico, proposta de reparo,
autorização explícita e execução são etapas separadas e auditadas.
