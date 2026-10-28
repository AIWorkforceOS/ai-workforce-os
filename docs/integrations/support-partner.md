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
  "description": "Relato completo, caminho percorrido e erro exibido",
  "mediaConsent": true,
  "media": [
    {
      "kind": "image",
      "mimeType": "image/jpeg",
      "base64": "conteudo-base64",
      "caption": "Tela enviada pelo cliente",
      "sourceMessageId": "id-da-mensagem-no-parceiro"
    }
  ]
}
```

`media` é opcional, aceita no máximo três imagens ou áudios e exige
`mediaConsent: true`. Imagens têm limite de 8 MB e áudios de 16 MB. Os arquivos
são enviados ao provedor de IA para leitura e descartados ao fim da requisição;
o banco guarda somente a descrição da imagem ou a transcrição do áudio.

Autorização: `Authorization: Bearer <SUPPORT_PARTNER_API_TOKEN>`.

Resposta `201` cria um chamado; `200` devolve o chamado já existente para o
mesmo `externalReference`. A resposta contém `id`, `protocol` e `created`.

Para acompanhar o chamado, o servidor parceiro pode consultar:

```text
GET /api/integrations/support/cases?orgId=<uuid>&externalReference=<referência>
Authorization: Bearer <SUPPORT_PARTNER_API_TOKEN>
```

A resposta contém `id`, `protocol`, `status`, `repairProposal`, `resolution`,
`updatedAt` e `resolvedAt`. O parceiro deve consultar periodicamente enquanto o
chamado estiver aberto e, quando `status` for `resolved`, entregar `resolution`
ao cliente na conversa original.

Este endpoint não autoriza nem executa reparos. Uma proposta criada pelo TI
muda o chamado para `awaiting_authorization`; a autorização deve ser feita por
um administrador autenticado no painel da Alizo. Só depois disso o TI pode
registrar a resolução final. Todo o fluxo fica auditado.

## Estados relevantes para a Kai

- `open` ou `investigating`: informar que o TI está analisando.
- `awaiting_authorization`: informar que existe uma proposta aguardando uma
  autorização humana no painel.
- `authorized` ou `repairing`: informar que o reparo autorizado está em curso.
- `resolved`: responder ao cliente com o texto de `resolution`.
- `closed`: informar que o atendimento foi encerrado.
