import type { InterviewAgentType } from '@/lib/interview/engine'

// Fase 9 (autonomia com controle), primeiro passo — só leitura, sem tabela
// nova nem fila de aprovação (decisão do Vinicius, 2026-08-20): descreve em
// linguagem simples o nível de autonomia REAL que cada cargo já tem hoje no
// código, pra "Manual de Trabalho" (Fase 6) não deixar isso implícito.
// Texto verificado contra o comportamento de verdade de cada um antes de
// escrever — não é uma promessa nova, é a leitura do que já existe:
// - sdr: fecha negócio via extração estruturada (deal_confirmed), dentro só
//   do que a entrevista ensinou (lib/interview/engine.ts, playbook sdr).
// - recruiter: monta shortlist sozinho, mas a contratação final sempre
//   passa por decisão humana (lib/recruiter/orchestrator.ts, decidedBy).
// - receptionist: agenda/reagenda/cancela sozinho (lib/receptionist/
//   scheduling.ts), escala conforme escalation_rules do próprio config.
// - traffic_specialist: roda em modo simulado (ad_accounts.is_simulated)
//   até uma conta de anúncio real ser conectada.
// - content_specialist: publica sozinho só se a conta social estiver em
//   publishing_mode='autonomous'; em 'suggestion' o post fica em
//   pending_approval (lib/content/planner.ts, decidePublishAction).
// - seo_specialist: só audita/gera/acompanha — não publica nada sozinho.
export const AUTONOMY_SUMMARY: Record<InterviewAgentType, string> = {
  sdr: 'Fecha vendas e atualiza o cadastro do cliente sozinho, mas só dentro do que você ensinou na entrevista (quando fecha sozinho, quais dados pedir, pra onde encaminhar) — nunca inventa preço, desconto ou condição fora disso.',
  recruiter:
    'Faz a triagem e monta a shortlist de candidatos sozinho, mas a decisão de contratar é sempre sua — ele nunca aprova nem promete uma vaga sozinho.',
  receptionist:
    'Agenda, reagenda e cancela compromissos sozinho, sempre conferindo disponibilidade real antes de confirmar — escala pra você nos casos definidos no horário e escalonamento abaixo.',
  traffic_specialist:
    'Roda em modo simulado (não gasta orçamento real nem publica anúncio de verdade) até você conectar uma conta de anúncio de verdade em Marketing → Tráfego pago.',
  content_specialist:
    'Publica sozinho nas redes conectadas quando o modo da conta está em "Autônomo"; em "Sugestão", cada post fica com status "Aguardando aprovação" em vez de publicar direto — o modo é configurado por conta conectada em Marketing → Conteúdo.',
  seo_specialist:
    'Só sugere e prepara: roda auditorias técnicas, gera conteúdo otimizado e acompanha posição de palavras-chave — não publica nada sozinho, você decide o que usar.',
}
