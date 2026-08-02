# Manual de Suporte do Sistema Smarter — base de conhecimento da Ana

> Este documento existe para a Ana (funcionária digital de suporte da Alizo, na unidade Smarter Estágios) responder dúvidas de uso, localização de função e triagem de erro de franqueados, empresas e estudantes sobre o Sistema Smarter. Foi escrito lendo o código-fonte do sistema (não é a documentação oficial da Smarter) — onde algo não pôde ser confirmado com certeza, está marcado como "não confirmado" em vez de presumido.

## Índice rápido por assunto

- **Login, senha, "esqueci minha senha"** → seção 1
- **Conta bloqueada / "acesso suspenso"** → seção 1.3
- **Cadastro de empresa (fora do sistema, aprovação pendente)** → seção 2.1
- **Cadastro de estudante (fora do sistema)** → seção 2.2
- **Captação de lead comercial / apresentação personalizada / link de parceria** → seção 2.3
- **Convênio com Instituição de Ensino (IES), token, assinatura** → seção 2.4
- **Empresa quer abrir vaga / pedir estagiário** → seção 2.5, 4.2
- **Portal da Empresa (estagiários, documentos, financeiro, avaliação)** → seção 3
- **Portal do Estudante (currículo, vagas, candidaturas, DISC, meu estágio)** → seção 4
- **Contrato de estágio, TCE, documentos, assinatura digital** → seção 5
- **Financeiro: cobrança de empresa x cobrança de franqueado, boleto, PIX** → seção 6
- **Abertura/Fechamento de mês (metas do franqueado) x Fechar Mês (cobrança da rede)** → seção 6.4 (atenção: são coisas diferentes, ver observação)
- **Equipe/permissões de colaborador** → seção 7
- **Vagas, processos seletivos (Kanban), avaliação DISC** → seção 8
- **CRM comercial (empresas) x CRM de franquia (venda de unidades)** → seção 9
- **Erros e mensagens mais comuns** → seção 10
- **Perguntas frequentes** → seção 11
- **O que não foi possível confirmar / pontos de atenção** → seção 12

---

## 1. Visão geral e papéis de usuário

O Sistema Smarter é a plataforma de gestão de estágios que conecta quatro tipos de participante:

- **Franqueadora** (a matriz da rede Smarter Estágios) — acesso total, gerencia todas as unidades franqueadas, financeiro da rede, convênios institucionais em nível de rede, seguro, marketing, saúde técnica do sistema.
- **Franquia/Franqueado** (dono de uma unidade) — acesso total à própria unidade: contratos, financeiro da unidade, empresas, estudantes, vagas, CRM comercial, equipe.
- **Funcionário/Equipe** (colaborador de uma unidade ou da matriz) — acesso só aos módulos que o franqueado/franqueadora liberar para ele (financeiro, contratos, estudantes, empresas, vagas, processos, CRM, instituições, configurações, assinaturas).
- **Empresa** (cliente que contrata estagiários) — acessa o Portal da Empresa, só vê os próprios estagiários/documentos/financeiro.
- **Estudante** (candidato/estagiário) — acessa o Portal do Estudante, só vê o próprio currículo/candidaturas/estágio.
- **Instituição de Ensino (IES)** — não tem papel de usuário tradicional; acessa por um link/token único, sem cadastro de senha inicial.

### 1.1 Login — `/login`

Formulário simples de e-mail + senha. Depois de logar, o sistema manda cada papel para o lugar certo automaticamente: Empresa → Portal da Empresa; Estudante → Portal do Estudante; qualquer outro papel → painel administrativo (`/dashboard`).

**Se a pessoa errar e-mail ou senha, a mensagem é sempre a mesma**, de propósito: "E-mail ou senha incorretos." O sistema nunca revela se o problema foi e-mail inexistente, senha errada ou conta desativada — por segurança. Isso significa que, ao dar suporte, quem atende não consegue saber pela mensagem qual é o problema real; é preciso checar internamente.

Há também um limite de tentativas: **10 logins por minuto por e-mail**. Se a pessoa errar a senha muitas vezes seguidas rapidamente, o login pode falhar temporariamente mesmo com a senha certa — vale orientar a esperar um minuto e tentar de novo.

A sessão dura **8 horas**; depois disso, pede login de novo automaticamente.

### 1.2 "Esqueci minha senha"

Fica dentro da própria tela de login. A pessoa digita só o e-mail. **Importante: isso não manda um "link para redefinir senha" — o sistema já troca a senha na hora e manda a senha nova por e-mail em texto normal.** Ou seja:

- Assim que a pessoa clica em "Enviar", a senha antiga já para de funcionar, mesmo que o e-mail demore a chegar ou vá para o spam.
- A tela sempre mostra "E-mail enviado! Se este e-mail estiver cadastrado, você receberá uma nova senha em instantes." — mesma mensagem mesmo se o e-mail não existir no sistema (não revela se a pessoa tem conta ou não).
- Se a pessoa disser que pediu nova senha e não recebeu (ou perdeu o e-mail): oriente a pedir de novo (gera outra senha nova) e checar spam. Não existe um "reenviar a mesma senha", cada pedido gera uma senha diferente.
- **Não existe uma tela de "trocar minha senha" para quem já está logado.** A única forma de trocar senha é pelo fluxo de "esqueci minha senha" no login. Se a pessoa quiser só trocar de senha por preferência (não porque esqueceu), o caminho é o mesmo.
- Exceção: para colaboradores (funcionários), quem tem permissão de Equipe pode trocar a senha de outro colaborador manualmente, sem precisar da senha antiga (tela `/dashboard/equipe`).

### 1.3 Conta ou unidade bloqueada — não confundir os dois tipos

Existem **dois bloqueios completamente diferentes** e é importante identificar qual é qual antes de orientar alguém:

**a) Usuário individual desativado.** Um admin desativou aquele login específico (ex.: colaborador que saiu da empresa). Efeito: login dá a mesma mensagem genérica "E-mail ou senha incorretos." — não tem aviso específico de "conta desativada".

**b) Unidade (franquia) inteira com acesso suspenso por inadimplência — tela "Acesso temporariamente suspenso".** Isso só afeta usuários **franqueado ou funcionário daquela unidade** — nunca afeta a franqueadora, nem empresas, nem estudantes vinculados a ela (eles continuam acessando normalmente mesmo se a unidade estiver bloqueada). A tela explica que o acesso foi suspenso por pendência na "Taxa de Desenvolvimento de Rede" (a mensalidade que o franqueado paga para a matriz), lista as cobranças em aberto com valor/vencimento/PIX/boleto, e normaliza sozinho assim que o pagamento é confirmado ou a franqueadora libera manualmente.

**Ponto importante para não prometer algo errado:** hoje, em produção, esse bloqueio automático por atraso está **desligado por padrão** — o sistema só detecta e avisa a franqueadora, não bloqueia ninguém sozinho. Se alguém caiu nessa tela, quase certamente foi um **bloqueio manual feito pelo time financeiro da franqueadora**, não algo automático. Se um franqueado disser "fui bloqueado do nada", a explicação mais provável é essa — oriente a falar com `financeiro@smarterestagios.com.br` ou com a franqueadora diretamente.

---

## 2. Cadastro e primeiro contato (telas públicas, sem login)

### 2.1 Cadastro de Empresa — `/cadastro/empresa`

Wizard de 3 passos (Dados da Empresa → Responsável → Endereço). Campos realmente obrigatórios: Nome, CNPJ, E-mail, Responsável.

**Ponto que gera muita dúvida:** depois de cadastrar, a empresa **não recebe senha nem consegue logar imediatamente**. Ela entra com status "Pendente" e precisa que alguém da unidade Smarter aprove manualmente antes do acesso ao Portal da Empresa ser liberado. Se uma empresa disser "me cadastrei e não recebi login", a resposta certa é: "seu cadastro está em análise, a equipe vai confirmar o acesso em breve" — não é um erro, é assim que o fluxo funciona hoje.

Por trás, o cadastro também cria automaticamente um lead no CRM comercial daquela unidade, então a equipe já vê essa empresa no funil de vendas.

Erros comuns: CNPJ já cadastrado ("CNPJ já cadastrado.") e campos obrigatórios faltando.

### 2.2 Cadastro de Estudante — `/cadastro/estudante`

Wizard de 5 passos (Dados Pessoais → Endereço → Formação → Currículo → Acesso). Só Nome, E-mail e Curso são realmente obrigatórios (os outros campos marcados com "*" na tela não bloqueiam de fato o envio).

**Diferente da empresa: o estudante já sai com acesso liberado na hora.** A senha é gerada automaticamente e enviada só por e-mail (nunca aparece na tela, por segurança) — a tela final sempre diz "Sua senha foi enviada para [e-mail]. Verifique sua caixa de entrada (e o spam)."

O teste DISC **não é preenchido no cadastro** — só depois, logado no Portal do Estudante (seção 4.6).

Se o estudante digitar o nome da instituição de ensino e ela não existir ainda no sistema, o cadastro segue sem vínculo de instituição (o sistema nunca cria uma instituição nova sozinho a partir desse texto) — alguém da equipe precisa associar manualmente depois.

Erros comuns: e-mail já cadastrado ("Use outro ou faça login."), limite de 5 cadastros por minuto por IP (rate limit — "Muitas tentativas, aguarde alguns minutos").

### 2.3 Captação comercial (para empresas ainda não clientes)

Três telas diferentes, todas sem login, todas alimentando o CRM comercial:

- **`/lead`** — formulário simples de captação (nome da empresa, WhatsApp, e-mail, etc.) usado em campanhas/tráfego pago.
- **`/parceria`** — landing page de parceria, pode ser personalizada por unidade (`?ref=`).
- **`/comercial/[token]`** — uma "apresentação comercial" individual, enviada pelo comercial de uma unidade para um lead específico (link único por lead, não é reutilizável para outra pessoa). Se o link parar de funcionar, não tem como o próprio lead gerar um novo sozinho — precisa pedir para quem enviou.

### 2.4 Convênio com Instituição de Ensino (IES) — `/ies/[token]`

A instituição de ensino **não tem cadastro tradicional com senha própria desde o início** — ela recebe um link único (com token) por e-mail, enviado manualmente pela equipe Smarter/franquia ao convidá-la para firmar convênio. Passos: landing → ver documentos institucionais da Smarter → escolher entre usar a minuta padrão da Smarter (lê na tela, assina depois de rolar até o fim) ou subir a minuta própria em PDF → preencher dados do representante e assinar.

Depois de assinar (minuta Smarter), a instituição recebe por e-mail um login (formato `SMTR-XXX-XXX`) e senha para acessar esse mesmo link depois como portal simples de acompanhamento.

**Se a instituição perder o link/token, não tem autoatendimento para gerar outro** — é preciso pedir para a unidade Smarter reenviar o convite (ação interna, feita por alguém da equipe, não pela própria instituição).

Erros comuns: link inválido/expirado, convênio já assinado antes ("Este convênio já foi assinado anteriormente."), convite cancelado.

**Atenção — dois módulos parecidos que não devem ser confundidos:**
- `/dashboard/instituicoes` — cadastro cadastral simples, aparece no menu normal, não gera link nenhum.
- `/dashboard/ies` — o fluxo de convênio por token descrito acima. **Não aparece no menu lateral** — só se chega a ele pela ficha da instituição ("Portal de Adesão IES") ou digitando a URL direto.

### 2.5 Empresa pede uma vaga sem estar logada — `/solicitar-vaga?empresa=...`

Formulário público bem completo (função, atividades, bolsa, supervisor, etc.), só funciona com um link específico que a unidade Smarter manda pra empresa (contém o ID da empresa na URL). Sem esse link específico, a tela mostra erro "Link inválido — solicite um novo link à sua unidade Smarter." Isso vira um pedido formal que a equipe da unidade pode transformar em vaga publicada com um clique.

---

## 3. Portal da Empresa (`/portal-empresa`)

Menu: Início, Meus Estagiários, Documentos, Financeiro, Avaliações, Solicitar Estagiário.

- **Início** — resumo: quantos estagiários ativos, quantos documentos aguardando assinatura, quantas avaliações pendentes, quantas contas a pagar.
- **Meus Estagiários** — lista de todos os contratos (atuais e passados), com dados do estagiário e do contrato. **É só leitura** — a empresa não edita nada aqui, quem edita é a unidade Smarter no painel administrativo. Tem atalho direto para WhatsApp/e-mail do estagiário.
- **Documentos** — mostra o status dos documentos do estágio (TCE, aditivos, etc.), separados por "Aguardando Assinatura", "Outros" e "Assinados". **A empresa não assina o documento aqui dentro** — o texto orienta a contatar o consultor Smarter. A assinatura digital de verdade é administrada por trás pela equipe da unidade.
- **Financeiro** — mostra o que já foi pago, o que está a pagar e o que está vencido, com PIX/boleto quando configurados pela unidade. **Não tem botão de "marcar como pago" aqui** — é só visualização; o pagamento acontece fora do sistema (banco/PIX) e a baixa é feita pela unidade.
- **Avaliações** — aqui sim a empresa preenche um formulário (normalmente a cada semestre): 6 notas de 1 a 5 (pontualidade, produtividade, iniciativa, comunicação, aprendizado, postura), texto de pontos fortes/melhoria/parecer final, e uma recomendação (Manter/Renovar/Encerrar). Cada envio cria um registro novo, não sobrescreve o anterior — o histórico fica acumulado.
- **Solicitar Estagiário** — formulário simples dentro do portal para pedir um novo estagiário. **Atenção: isso não vira uma vaga formal automaticamente** — só gera um aviso interno para a equipe da unidade, que precisa cadastrar a vaga manualmente depois de ler o aviso. O fluxo que vira vaga real com um clique é o outro (seção 2.5, link enviado pela unidade).

---

## 4. Portal do Estudante (`/portal-estudante`)

Menu: Início, Meu Currículo, Vagas, Candidaturas, Meu Estágio, Avaliações, Teste DISC.

- **Início** — se o estudante ainda não fez o Teste DISC, aparece um banner incentivando a fazer. Resume candidaturas recentes e o estágio ativo, se houver.
- **Meu Currículo** — onde o estudante preenche/edita dados pessoais, formação, experiências e habilidades, e pode baixar o currículo em PDF (o sistema monta o currículo e abre a janela de impressão do navegador — se o navegador bloquear pop-up, o botão não funciona e aparece aviso pra liberar pop-up). Nenhum campo é obrigatório nessa tela — o estudante pode salvar mesmo incompleto.
- **Vagas** — lista todas as vagas abertas do sistema (de qualquer empresa), com um "% de match" calculado. Candidatar-se é um clique. **Atenção:** o botão não muda visualmente para quem já se candidatou àquela vaga — se clicar de novo, só aparece um erro genérico. Se um estudante disser "não consigo me candidatar de novo", provavelmente ele já está inscrito.
- **Candidaturas** — acompanha o andamento (Inscrito → Em Triagem → Entrevista → Aprovado/Reprovado). O estudante só visualiza; quem move o processo é a equipe da unidade. Se tiver entrevista marcada, mostra data/local/link aqui.
- **Meu Estágio** — detalhes do contrato ativo (ou mais recente), incluindo os documentos gerados e seus status.
- **Avaliações** — o estudante só visualiza as avaliações que a empresa preencheu sobre ele (não preenche nada aqui).
- **Teste DISC** — questionário de 10 perguntas que calcula o perfil comportamental (D/I/S/C). Pode refazer quantas vezes quiser — **cada nova tentativa sobrescreve o resultado anterior**, não fica histórico de tentativas passadas. O resultado é usado para calcular o "% de match" nas vagas (só esse critério é usado hoje — não há peso por habilidades, curso, etc., mesmo que o texto da tela sugira mais fatores).

### Candidatura por vaga pública, sem estar logado — `/vaga/[slug]`

Existe uma vitrine pública de vagas (`/vagas`, sem login) onde qualquer pessoa pode ver o detalhe de uma vaga e se candidatar de dois jeitos: já tendo cadastro (e-mail+senha) ou criando conta na hora (nome, e-mail, curso, senha). Os erros mais comuns aqui: e-mail não encontrado, senha incorreta, e-mail já cadastrado (nesse caso a pessoa deve usar "já tenho cadastro" em vez de tentar cadastrar de novo).

---

## 5. Contrato de Estágio, TCE e documentos (Lei 11.788/2008)

### 5.1 Como um contrato nasce

**Importante: uma candidatura aprovada no processo seletivo não vira contrato sozinha.** São processos administrativos separados. Quando a unidade decide efetivar o estágio, alguém preenche manualmente o formulário "Novo Estágio", escolhendo o estudante e a empresa.

Ao criar, o sistema automaticamente:
- Gera um número de contrato sequencial (ex.: `001/2026`).
- Cria os **9 documentos do estágio**, todos em branco (status "Não Gerado"): TCE, Plano de Estágio, Termo Aditivo, Rescisão ao TCE, Recibo de Rescisão, Termo de Recesso Remunerado, Recibo de Pagamento de Bolsa, Termo de Realização de Estágio, Parecer Técnico.
- Muda o status do contrato para **Pendente** e do estudante para "Em Estágio".
- **Ainda não gera nenhuma cobrança financeira** — isso só acontece quando o contrato vira Ativo.

### 5.2 Os status do contrato

- **Pendente** — acabou de ser criado, documentos ainda não assinados.
- **Aguardando Assinatura** — pelo menos uma das 3 partes já assinou o TCE, mas não todas.
- **Ativo** — o TCE foi assinado pelas 3 partes (empresa, instituição de ensino e estudante). Isso acontece **automaticamente** assim que a última assinatura entra, e dispara também **automaticamente a primeira cobrança da Taxa de Administração** para a empresa.
- **Finalizado** — término natural do estágio.
- **Suspenso** — afastamento temporário.
- **Inativo** — rescindido. Acontece automaticamente quando o Termo de Rescisão é assinado por todos. **Regra de cobrança na rescisão:** se a rescisão acontece até o dia 10 do mês, a cobrança daquele mês é cancelada; se depois do dia 10, a cobrança daquele mês continua valendo.
- **Vencido** — previsto no sistema para contratos com data fim já passada, mas não foi encontrada nenhuma automação que faça essa mudança sozinha — pode ser um status hoje sem transição automática (vale confirmar com o time se isso é esperado).

### 5.3 Assinatura digital

Duas formas convivem e produzem o mesmo efeito:
1. **Marcar como assinado dentro do próprio sistema** (sem provedor externo).
2. **Via Autentique** (assinatura eletrônica terceirizada) — a unidade manda o documento gerado para os e-mails dos signatários, cada um recebe um link individual, e a unidade confere o status depois com o botão "Verificar Assinaturas".

Em ambos os casos: quando os 3 assinam o TCE, o contrato vira Ativo automaticamente; quando assinam o Termo de Rescisão, vira Inativo automaticamente.

### 5.4 Regras da Lei 11.788/2008 que bloqueiam a geração de documentos

Antes de gerar o TCE ou o Plano de Estágio, o sistema confere:
- Carga horária semanal não pode passar de 30h.
- Carga horária diária não pode passar de 6h.
- Precisa ter supervisor cadastrado na empresa.
- Precisa ter orientador cadastrado na instituição de ensino.
- Precisa ter apólice de seguro informada.
- Estágio não pode passar de 2 anos (exceto pessoa com deficiência).

Se qualquer uma dessas faltar, a geração do documento é bloqueada com uma mensagem específica dizendo qual regra faltou — essa é a causa mais comum de "não consigo gerar o TCE".

### 5.5 Avaliação do estagiário

Foi movida para um formulário online que a empresa preenche no Portal da Empresa (seção 3) — não é mais um documento a imprimir. Não tem envio automático periódico: é a unidade quem decide quando mandar o convite de avaliação para a empresa (botão na ficha do contrato).

---

## 6. Financeiro — as três relações de cobrança (não confundir)

O sistema usa uma única tabela de lançamentos financeiros para três relações diferentes:

### 6.1 Franqueadora cobra o Franqueado ("Taxa de Desenvolvimento de Rede")

Todo dia 23, o sistema gera automaticamente, para cada unidade, a cobrança do mês seguinte: mensalidade fixa (padrão R$ 200, pode estar desligada por unidade) **+** R$ 13 por contrato ativo naquela unidade. O vencimento é o dia configurado pela unidade (padrão dia 10). Essa é a cobrança que, se ficar 30+ dias em atraso, pode levar ao bloqueio de acesso descrito na seção 1.3 (hoje desligado por padrão, ver observação lá).

### 6.2 Empresa paga a Taxa de Administração pelo estagiário

Gerada automaticamente quando o contrato vira Ativo (assinatura completa do TCE), no valor definido em cada contrato individual (campo "Valor cobrado da Empresa"). É diferente do "Valor de Gestão" cadastrado na ficha da empresa (esse outro valor só é usado para montar o Contrato de Prestação de Serviços entre a franquia e a empresa — não é o que gera a cobrança mensal recorrente).

### 6.3 Pagamento em si acontece fora do sistema

Tanto para a empresa quanto para o franqueado, o pagamento (boleto/PIX) é feito no banco/app do banco. O sistema só mostra os dados de pagamento e recebe a confirmação — manual (a unidade marca como pago) ou automática (integração com o banco Cora, para as cobranças de franquia).

### 6.4 Duas coisas com nome parecido que NÃO são a mesma: "Fechar Mês"

- **Financeiro → "Fechar Mês"** (só a Franqueadora usa, a partir do dia 23): gera as cobranças de mensalidade da rede.
- **`/dashboard/mes` → Abertura/Fechamento de mês** (só Franqueado/Funcionário usam): é uma ferramenta de metas e prestação de contas mensal da unidade — nada a ver com cobrança. O franqueado declara metas no início do mês e, no fechamento, confere o realizado, recebe um score de 0 a 100 e mensagens de coaching. **Se a unidade não abrir o mês até o dia 5, o sistema trava a tela inteira até que o franqueado abra o mês** (exceto a própria tela de abertura).

---

## 7. Equipe e permissões (`/dashboard/equipe`)

O franqueado cadastra colaboradores (papel "Funcionário") escolhendo quais módulos cada um pode acessar (financeiro, contratos, estudantes, empresas, vagas, processos, CRM, instituições, configurações). Um colaborador sem permissão para um módulo simplesmente não vê aquele item no menu e é bloqueado se tentar acessar direto pela URL.

Só a Franqueadora cria membros da "Equipe Smarter" (papel com visão de toda a rede).

Senha do colaborador: mínimo 6 caracteres. Um admin pode trocar a senha de um colaborador sem precisar da senha antiga.

---

## 8. Vagas e processo seletivo

- **Cadastro de vaga** (`/dashboard/vagas`) — feito pela unidade, nunca diretamente pela empresa (a empresa só solicita, ver seções 2.5 e 3). Tem geração de conteúdo por IA (descrição, requisitos) e um link público de divulgação criado automaticamente.
- **Processo seletivo / Kanban** (`/dashboard/processos`) — funil: Inscritos → Triagem → Entrevista → Aprovado/Reprovado. O campo "Recomendação" (Aprovado/Em análise/Reprovado) é separado da etapa do Kanban — os dois podem estar dessincronizados, é bom conferir os dois ao checar o status de um candidato.
- **Match DISC** — hoje é o único critério automático de compatibilidade candidato-vaga (compara o perfil DISC do estudante com o perfil desejado da vaga).

---

## 9. CRM — dois pipelines diferentes, não confundir

- **CRM comercial** (`/dashboard/crm`) — para captar empresas clientes (que vão contratar estagiários). Funil: Novo Lead → Contatado → Reunião Agendada → Proposta Enviada → Em Negociação → Fechado/Perdido. Cada etapa tem prazo (SLA); mudar de etapa manda e-mail automático ao lead.
- **CRM de franquia** (`/dashboard/franquia-crm`) — exclusivo da Franqueadora, para vender novas unidades franqueadas (não tem nada a ver com o CRM comercial acima). Aceita importação de leads em massa via CSV.

---

## 10. Erros e mensagens mais comuns (referência rápida)

| Situação | Mensagem que aparece | O que fazer |
|---|---|---|
| Login errado (qualquer motivo) | "E-mail ou senha incorretos." | Não dá pra saber pela mensagem se é senha errada, conta inativa ou limite de tentativas — checar internamente |
| Muitas tentativas seguidas (login, cadastro, formulários públicos) | "Muitas tentativas. Aguarde alguns minutos." | Esperar e tentar de novo, não é bug |
| Empresa cadastrada sem receber senha | (nenhum erro — é esperado) | Explicar que cadastro de empresa exige aprovação manual antes do acesso liberar |
| CNPJ/e-mail já cadastrado | "CNPJ já cadastrado." / "E-mail já cadastrado." | Orientar a fazer login em vez de cadastrar de novo |
| Não consegue gerar TCE/Plano de Estágio | Mensagem específica citando o artigo da Lei 11.788 que falhou (carga horária, supervisor, orientador, apólice, prazo) | Completar o dado que falta no contrato/empresa/instituição |
| "Acesso temporariamente suspenso" | — | Provavelmente bloqueio manual por inadimplência da unidade — orientar a contatar financeiro@smarterestagios.com.br |
| Link de convênio IES ou apresentação comercial não funciona | "Link inválido." / "Apresentação não encontrada." | Não há autoatendimento — precisa pedir reenvio a quem mandou o link |
| Fechar Mês (financeiro) fora do prazo | "Fechamento disponível apenas no dia 23 ou após." | Só pode ser forçado manualmente por admin antes disso |
| Tentando se candidatar de novo à mesma vaga | Erro genérico "Não foi possível fazer a inscrição agora." | Provavelmente já está inscrito |

---

## 11. Perguntas frequentes antecipadas

**"Me cadastrei como empresa e não recebi senha, é bug?"** Não — cadastro de empresa sempre exige aprovação manual da unidade antes do acesso ser liberado, diferente do estudante (que já sai com acesso). Aguardar contato da equipe.

**"Por que a cobrança apareceu sozinha na conta da empresa?"** A Taxa de Administração é gerada automaticamente assim que o TCE é 100% assinado e o contrato vira Ativo — não é lançada manualmente por ninguém, é um efeito automático da assinatura completa.

**"Esqueci a senha e pedi nova, mas não recebi"** — Confirmar se olhou o spam; se realmente não chegou, pedir de novo (cada pedido gera uma senha nova e invalida a anterior, então só a mais recente funciona).

**"Não consigo assinar o documento como empresa/estudante pelo portal"** — Correto, nenhum dos dois portais tem botão de assinatura embutido; a orientação padrão do próprio sistema é contatar o consultor da unidade Smarter.

**"Cadastrei a instituição de ensino do meu curso mas não apareceu vinculada"** — o sistema só vincula automaticamente se já existir uma instituição cadastrada com nome parecido; senão, fica sem vínculo até alguém da equipe associar manualmente.

**"Minha unidade foi bloqueada, isso é automático?"** — Hoje não, em produção esse bloqueio automático está desligado; o mais provável é ter sido um bloqueio manual do financeiro da franqueadora.

**"Existem dois lugares chamados "Fechar Mês", qual eu uso?"** — Se você é franqueado querendo registrar metas/resultado do mês, é `/dashboard/mes`. A cobrança da rede (dia 23) é feita pela Franqueadora, franqueado não tem esse botão.

---

## 12. O que não foi possível confirmar / pontos de atenção

Levantado lendo o código-fonte — vale confirmar com o time de produto antes de tratar como certeza absoluta:

- Não foi encontrada nenhuma rotina automática que mude um contrato para o status "Vencido" quando a data fim passa — pode não existir hoje.
- O status "Cancelado" de convênio com IES existe no sistema, mas não foi encontrado nenhum botão que efetivamente o acione.
- Reenviar convite de IES pelo botão do cabeçalho não reenvia e-mail de fato — abre um formulário novo pré-preenchido (risco de duplicar a instituição). Quem reenvia e-mail de verdade é outro botão, dentro do card do link.
- Autocomplete de instituição já existente na tela `/dashboard/ies/novo` (convite) pode criar uma instituição duplicada mesmo quando o operador seleciona uma já cadastrada — sinalizado no próprio código como risco conhecido.
- Na tela inicial do Portal da Empresa, o botão "+ Solicitar Estagiário" do estado vazio aponta para uma URL que não existe (`/portal-empresa/vagas` em vez de `/portal-empresa/solicitar`) — possível link quebrado a confirmar.
- No Portal do Estudante, o botão de candidatura não muda de aparência para vagas em que o estudante já está inscrito — ele só descobre pelo erro ao clicar de novo.

Este documento cobre os fluxos principais de autenticação/cadastro, os dois portais (Empresa e Estudante), o painel administrativo completo (financeiro, contratos, mês, franqueados, equipe, vagas, IES/instituições, CRM comercial e de franquia, e os módulos menores: gamificação, crescimento, engajamento, saúde, seguros, integrações, marketing) e as regras de negócio da Lei 11.788/2008 aplicadas a contratos e documentos. Não foram exploradas em profundidade as áreas de configurações avançadas de branding/e-mail, nem o conteúdo detalhado de cada rota de API interna (apenas o mapa de módulos) — se surgir uma dúvida muito específica sobre alguma dessas áreas, vale sinalizar como "não coberto neste documento" em vez de inventar uma resposta.
