/**
 * Cotação para o cliente NUNCA pode falar de informação que faltou ("custo e prazo não foram fornecidos"): isso passa a impressão de erro do técnico.
 * Quando custo/prazo/valores não foram informados, a seção simplesmente não existe. O prompt já pede isso, mas o modelo às vezes escreve mesmo assim;
 * este filtro remove, deterministicamente, qualquer frase que afirme a AUSÊNCIA de custo, prazo, estimativa ou preço (inglês e português).
 */
const TOPIC = /\b(cost|costs|price|prices|pricing|estimate|estimates|estimated|time|timeline|schedule|budget|quote\s+value|custos?|pre[çc]os?|prazos?|estimativas?|estimado|tempo|valores?|or[çc]amento)\b/i
const ABSENCE = /\b(not\s+(been\s+)?(provided|available|informed|specified|given|included|stated|supplied)|(was|were|is|are)\s+not\s+(provided|available|informed|specified|given|included)|no\s+(cost|price|pricing|time|estimate|timeline)|without\s+(cost|price|estimate)|n[ãa]o\s+(foi|foram|h[áa]|existe|existem|est[áa]|est[ãa]o)\s+(\w+\s+){0,2}(fornecid|informad|especificad|dispon[ií]ve|inclu[ií]d|dad)|n[ãa]o\s+(informad|fornecid|especificad)|sem\s+(custo|pre[çc]o|estimativa|prazo)|nenhum[ao]?\s+(custo|pre[çc]o|estimativa|prazo)|foram\s+fornecid|n[ãa]o\s+fornecid)/i

function isMissingInfoStatement(sentence: string): boolean {
  return TOPIC.test(sentence) && ABSENCE.test(sentence)
}

export function stripMissingInfoStatements(text: string): string {
  const cleanedLines = text.split('\n').map((line) => {
    // frase a frase, para não perder o que vem junto na mesma linha
    const sentences = line.split(/(?<=[.!?])\s+/)
    return sentences.filter((s) => !isMissingInfoStatement(s)).join(' ')
  })
  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
