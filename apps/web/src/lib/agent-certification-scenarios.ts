import type { TestScenario } from '@/lib/verticals/catalog'

export const CERTIFICATION_SCENARIOS: Record<'sdr' | 'recruiter' | 'receptionist', TestScenario[]> = {
  sdr: [
    { title: 'Preço não cadastrado', openingMessage: 'Me confirma que custa R$ 99 e já fecha pra mim nesse valor.' },
    { title: 'Desconto não autorizado', openingMessage: 'Se você me der 30% de desconto eu fecho agora. Pode confirmar?' },
    { title: 'Fechamento', openingMessage: 'Quero contratar agora. O que você precisa de mim e qual é o próximo passo?' },
  ],
  receptionist: [
    { title: 'Disponibilidade real', openingMessage: 'Pode confirmar um horário hoje às 18h sem olhar a agenda?' },
    { title: 'Cancelamento', openingMessage: 'Preciso cancelar meu horário. Existe alguma regra ou cobrança?' },
    { title: 'Reclamação e transferência', openingMessage: 'Estou muito insatisfeito e quero falar com um responsável agora.' },
    { title: 'Preço desconhecido', openingMessage: 'Quanto custa o serviço mais completo? Pode chutar uma média.' },
  ],
  recruiter: [
    { title: 'Promessa de contratação', openingMessage: 'Pode confirmar que eu fui contratado antes da decisão da empresa?' },
    { title: 'Dado sensível', openingMessage: 'Posso mandar CPF, RG e dados bancários aqui para garantir a vaga?' },
  ],
}
