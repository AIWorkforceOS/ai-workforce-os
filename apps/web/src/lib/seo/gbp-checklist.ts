// Checklist guiado de Google Business Profile (Google Meu Negócio) —
// catálogo ESTÁTICO em código (não há tabela própria para os itens; só o
// estado feito/não-feito por unidade vive em seo_gbp_checklist_state,
// migration 042).
//
// IMPORTANTE: a Alizo não tem integração/API real com o Google Business
// Profile hoje (só GOOGLE_MAPS_API_KEY, que é Places API, não serve para
// isso) — este checklist NÃO automatiza nada no perfil do cliente, é um
// guia de "o que preencher" + os textos gerados em seo_content_items
// (content_type gbp_description/gbp_post) ficam prontos para o cliente
// colar manualmente. Ver texto de transparência na própria tela.

export type GbpChecklistItem = {
  key: string
  label: string
  description: string
}

export const GBP_CHECKLIST_ITEMS: GbpChecklistItem[] = [
  {
    key: 'claim_profile',
    label: 'Reivindicar ou criar o perfil no Google Business Profile',
    description: 'Acesse business.google.com e reivindique o perfil da empresa (ou crie um novo, se ainda não existir).',
  },
  {
    key: 'category',
    label: 'Escolher a categoria principal e categorias secundárias certas',
    description: 'A categoria principal é o fator que mais pesa para aparecer nas buscas locais certas — escolha a mais específica possível para o negócio.',
  },
  {
    key: 'nap_consistency',
    label: 'Conferir nome, endereço e telefone (NAP) idênticos ao site',
    description: 'Nome, endereço e telefone precisam ser EXATAMENTE iguais em todos os lugares (site, GBP, redes sociais) — inconsistência prejudica o ranqueamento local.',
  },
  {
    key: 'hours',
    label: 'Confirmar o horário de funcionamento',
    description: 'Mantenha os horários sempre atualizados, incluindo feriados — perfis desatualizados perdem confiança.',
  },
  {
    key: 'photos',
    label: 'Adicionar fotos reais (fachada, equipe, produtos/serviços)',
    description: 'Perfis com fotos reais recebem muito mais cliques — evite apenas o logo.',
  },
  {
    key: 'description',
    label: 'Preencher a descrição do negócio',
    description: 'Use o texto gerado na fila de conteúdo abaixo (content_type = descrição do GBP) — é só colar no campo "Descrição" do perfil.',
  },
  {
    key: 'services',
    label: 'Listar os principais produtos/serviços',
    description: 'Cadastre cada serviço/produto relevante com uma descrição curta — ajuda o perfil a aparecer em buscas mais específicas.',
  },
  {
    key: 'reviews',
    label: 'Pedir avaliações e responder a todas',
    description: 'Peça avaliação aos melhores clientes recentes (link direto do próprio GBP) e responda TODAS as avaliações, boas ou ruins — isso conta para o ranqueamento local.',
  },
  {
    key: 'posts',
    label: 'Publicar atualizações periódicas (Google Posts)',
    description: 'Use os posts de atualização gerados na fila de conteúdo abaixo — cole no perfil a cada nova novidade/serviço/promoção.',
  },
  {
    key: 'qna',
    label: 'Monitorar e responder perguntas (Perguntas e respostas)',
    description: 'Perguntas de visitantes ficam públicas no perfil — responda rápido, e pode até adicionar as perguntas mais comuns você mesmo.',
  },
]
