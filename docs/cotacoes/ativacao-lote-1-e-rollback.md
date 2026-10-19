# Super Agente de Cotações — ativação do lote 1 e rollback (19/10/2026)

**Situação:** migration 098 APLICADA em produção (20261019154215 `quote_agent_pilot`). Código do piloto **não publicado**. Todas as unidades em `off`; todos os funcionários com `quote_agent_enabled=false`; pesquisa de preços desligada (`QUOTE_PRICE_SEARCH_ENABLED` ausente/≠ `true`).

## Técnicos do piloto (confirmados pelo Vinicius)
Murilo (`murilo_maestri82@gmail.com`) e Vinicius Paiva (`viniciusmpaiva91@gmail.com`), unidade Mawi Pro — Principal. **Edi Clau está desativado**: a rota de configuração ignora tentativas de autorizá-lo e a checagem de disponibilidade exige funcionário ativo.

## Limites do lote 1
- Por cotação: **US$ 0,60** (cotação inteira, somando revisões). Por empresa: **US$ 50/mês** (teto da plataforma).
- Lote: **até 10 cotações** (`pilot_max_quotes=10`) e **US$ 3,00 agregados** (`monthly_cap_usd=3.00`, que o painel nunca deixa passar de 50).
- **Sem pesquisa automática de preços** (preços ficam pendentes; técnico preenche). Revisão humana obrigatória; nada é enviado à Facilities 360; aprovar não conclui o serviço.

## Sequência (cada passo com autorização explícita)
1. Push + deploy do código (agente ainda OFF). Smoke: login, WO, foto, assinatura, PDF, fila offline; painel `/dashboard/units/<id>/super-agente` abre para vinny29lp@gmail.com.
2. No painel, como vinny29lp: cadastrar regra comercial (US$ 40 cobrado / US$ 20 pago); definir **limite do lote** (10 cotações, US$ 3,00); marcar **Murilo** e **Vinicius Paiva**. Unidade continua `off`.
3. Autorização do lote pago → mudar a unidade para **ativo (live)** no painel.
4. Acompanhar: `supabase/tests/quote_batch_report.sql` (somente leitura) e painel de Consumo de IA. Avaliar cada cotação no painel (acerto do diagnóstico, materiais, horas).
5. Fechou 10 casos ou US$ 3,00 → novas gerações são recusadas pelo servidor. Revisar resultados antes de qualquer ampliação ou de ligar a pesquisa de preços.

## Desligamento imediato (qualquer momento)
1. Painel → **Desligar agora** (unidade → `off`; análises em andamento são canceladas). Ou
2. Vercel: `QUOTE_TEAM_ENABLED=false` (chave global, sobrepõe tudo). Ou
3. SQL de emergência: `update public.units set quote_ai_team_mode='off' where id='<unit>'; update public.employees set quote_agent_enabled=false where unit_id='<unit>';`
Nada é apagado; WOs, fotos, assinaturas, PDF, PWA e fila offline não dependem do agente.

## Rollback da migration 098 (só com autorização; não destrutivo até o passo 0)
Passo 0 (sempre primeiro): unidades → `off`, `QUOTE_TEAM_ENABLED=false`. O bloco da 098 está no início de `supabase/rollbacks/20261017_quote_team_rollback.sql` (remove avaliações, mensagens, índice único, colunas novas). **Atenção:** apagar `quote_messages`/`quote_pilot_reviews`/colunas descarta o histórico do piloto; exportar antes.
