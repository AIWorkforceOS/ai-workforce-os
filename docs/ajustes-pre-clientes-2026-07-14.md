# Ajustes pré-testes com clientes reais — 14/07/2026

Três ajustes pedidos pelo Vinicius antes dos primeiros testes com clientes de
verdade. Tudo verificado no browser (dev server local + Supabase de produção,
org de teste `UX AUDIT Padaria Estrela`) e coberto por typecheck/lint/build/testes.

## 1 · Catálogo de funcionários digitais (`/dashboard/equipe-digital`)

**Problema:** ao contratar, "já saía o SDR" — não existia lugar pra ver os 3
funcionários disponíveis, escolher quais ativar, nem um passo a passo por
funcionário. Recruiter e Traffic só "existiam" pra quem soubesse dos menus.

**O que foi feito:**
- Nova tela **Contratar & ativar** (primeiro item do grupo "Funcionários
  digitais" na sidebar): os 3 funcionários lado a lado, cada um com o que faz
  (linguagem leiga), status real derivado do banco (Disponível pra ativar /
  Falta pouco / Trabalhando) e um passo a passo numerado.
- **Ativação self-service** de Recrutador e Gestor de tráfego direto no card
  (cria/ativa a linha de `agent_configs` — o mesmo gatilho que os crons usam),
  com escolha de nome pro Recrutador e seletor de unidade quando a empresa tem
  mais de uma. Botão **Pausar** para desativar quando quiser.
- SDR continua no fluxo guiado do onboarding (que já funciona bem); o card
  aponta pra lá. O passo final do onboarding agora apresenta os "colegas"
  (Recrutador e Tráfego) com link pro catálogo.
- Cards de funcionário do dashboard apontam pro catálogo quando o funcionário
  ainda não está ativo.

**Verificado no browser:** ativação do Recrutador criou a config no banco
(persona "Rafa", `is_active: true`) e a UI refletiu na hora; RLS impediu
corretamente uma tentativa de escrita com sessão de outra org.

## 2 · Identidade dos funcionários ("nunca se revelar como IA")

**O pedido original** era que os funcionários **nunca** admitissem ser IA,
mesmo perguntados diretamente ("você é um robô?"), sempre desviando com uma
desculpa de processo interno.

**O que foi implementado é diferente do pedido, de propósito — e é importante
que o Vinicius leia isto:**

Não dá pra implementar a ocultação/negação como pedida, por três motivos
práticos além do ético:
1. **As respostas são geradas pela API da OpenAI**, cujas políticas de uso
   proíbem enganar o usuário fazendo-o crer que fala com um humano. Instruir o
   modelo a esconder isso arrisca a conta de API que sustenta o produto inteiro.
2. **A spec do Recruiter (§9) já mandava o oposto** ("se apresenta como
   assistente digital... nunca finge ser humano") — decisão deliberada de
   compliance, reforçada em código nos guardrails.
3. **Risco legal/reputacional** pros clientes da Alizo: consumidor e candidato
   descobrindo que foram ativamente enganados sobre falar com um robô é o tipo
   de screenshot que viraliza — e regulação de IA no Brasil (PL 2338) e fora
   caminha pra exigir transparência.

**O que foi feito (atende o objetivo prático — conversa natural, sem clima
esquisito):** regra compartilhada em `lib/agent-identity.ts`, aplicada aos
prompts dos 3 funcionários (SDR em `conversation-engine.ts` + sandbox,
Recruiter em `recruiter/prompts.ts`, Traffic em `traffic/reporting.ts`):
- Perguntado se é robô/IA/pessoa, responde **em uma frase leve** ("sou o
  assistente digital do time aqui!") **sem pedir desculpas nem papo técnico**
  (nada de "sou um modelo de linguagem", OpenAI, etc.) e já emenda no assunto.
- **Nunca** afirma ou insinua ser humano.
- **Escalação exatamente como o Vinicius pediu:** "vou te passar pra alguém do
  time que consegue te ajudar melhor nisso" — processo normal do time, nunca
  "como uma IA, não posso ajudar".

**Testes:** `src/lib/__tests__/agent-identity.test.ts` — asserções de que os 3
prompts carregam as regras + cenário ao vivo (roda com `OPENAI_API_KEY`; pulado
no CI) perguntando "você é um robô?" ao SDR e ao Recruiter e validando que a
resposta é natural, não afirma ser humano e não desanda em papo técnico.
Resposta real capturada no teste:
> "Sou o assistente digital do time aqui! O que você gostaria de saber sobre
> nossos produtos ou serviços?"

**Limitação honesta:** LLM não é determinístico; a regra no prompt torna o
comportamento consistente, mas não é garantia matemática em 100% dos cenários
extremos. O que está garantido pelos testes é o comportamento no cenário
direto. Se a regra de negócio "negar ser IA" for inegociável, isso precisa ser
uma conversa de produto/jurídico — não um ajuste de prompt.

## 3 · Logo distorcida no login

A `<img>` da logo era filha direta de um flex column; o `align-items: stretch`
padrão esticava a largura dela pro painel inteiro enquanto `h-9` travava a
altura — proporção quebrada. Corrigido com `self-start`
(`app/login/page.tsx`). Verificado no browser: logo nítida em 640×202 (~3.17:1).

## Notas de infraestrutura desta sessão

- `vitest.config.ts` novo em `apps/web` (alias `@/` para os testes).
- `/api/agent/sandbox` agora reutiliza o `buildSystemPrompt` real do
  conversation-engine em vez de duplicá-lo (teste do onboarding usa o mesmo
  prompt do atendimento de verdade, incluindo as regras de identidade).
- Ficou pendente da sessão paralela (não é deste escopo): aplicar a migration
  `20260714000009_pricing_and_payment_gateways.sql` no Supabase e concluir o
  rollout de i18n (layout/middleware) e da página de pagamentos.
