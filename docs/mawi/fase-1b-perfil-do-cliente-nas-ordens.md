# Fase 1b — Perfil do cliente nas ordens de serviço (21/10/2026)

**Pedido:** as ordens de serviço (PDF da WO / Sign Off) saíam sempre com os dados da 360. Agora cada cliente Facility tem cadastro com **logo e informações próprias**, e todas as ordens daquele cliente saem com elas. **A invoice não muda** (continua com a logo e os dados da unidade).

## Como funciona
- **Menu → Clientes Facility** (administrador): cadastra o cliente (nome, endereço em 2 linhas, telefone, e-mail, site, observações internas) e envia a logo dele (PNG/JPEG/WebP até 2 MB, reprocessada no servidor).
- O **nome** do cliente é o vínculo com as ordens (o mesmo `customers.client_company` que a 360 já usa) e não muda depois de criado. Ao cadastrar, o sistema cria o "cliente" em cada unidade da empresa para as ordens poderem apontar para ele.
- **PDF da WO:** o cabeçalho (logo + bloco de endereço) vem do perfil do cliente da ordem. **Sem perfil ou sem logo**, o PDF segue como hoje: dados e logo da 360 (ou selo com as iniciais do cliente, se ele não tiver logo).
- **Importação de ordens em lote:** novo seletor "Cliente das ordens" (padrão 360). As ordens importadas saem com os dados do cliente escolhido.
- Vale para o PDF baixado pelo técnico, pelo administrador e pelo Portal do Cliente.

## Migration 101 (aditiva; validada em produção em transação desfeita; NÃO aplicada até autorização)
Tabela `client_company_profiles` com RLS: leitura por quem é da empresa (o técnico precisa dos dados para baixar o PDF), escrita só administrador da empresa ou super admin; nome único por empresa sem diferenciar caixa; logo só `https`. Rollback: `supabase/rollbacks/20261021_101_client_company_profiles_rollback.sql`.

**Depois de aplicar**, cadastrar a 360 (dados que hoje estão no código) para ela aparecer na lista e poder ser editada:
```sql
insert into public.client_company_profiles (org_id, name, address_line1, address_line2, phone)
select id, '360 Service Provider', '11098 Biscayne Boulevard, Suite 305', 'Miami, FL 33161', '786-281-3413' from public.organizations where name = 'Mawi Pro'
on conflict do nothing;
```

## Compatibilidade
O código tolera a tabela ausente (o PDF sai como hoje), então publicar antes ou depois da migration não quebra nada.

## Não mudou
Invoice (logo da unidade + dados de cobrança), Sign Off com modelo da 360 quando o cliente é a 360, e o restante do documento (campos, assinatura, fotos).
