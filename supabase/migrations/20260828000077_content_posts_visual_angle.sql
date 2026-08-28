-- Rotação determinística de formato visual do Gestor de Conteúdo (achado
-- real, 2026-08-28, conta AlizoAi): pedir por texto pro modelo "varie o
-- formato visual" não bastou — mesmo depois de reforçar a instrução 2x, os
-- criativos continuavam seguindo a mesma linha visual (robôs + telas de
-- dashboard + azul/turquesa) post após post. O mesmo padrão de bug já visto
-- em pickNextPillar (ping-pong entre só 2 opções, nunca alcançava a 3ª) —
-- lá a correção foi trocar "peça pro modelo escolher" por um round-robin
-- de verdade em código (lib/content/planner.ts, pickNextVisualAngle). Essa
-- coluna grava qual ângulo visual foi de fato usado em cada post, pra essa
-- rotação funcionar (sem ela não há como saber "o que já foi usado" pra
-- calcular o próximo).
alter table content_posts add column if not exists visual_angle text;

comment on column content_posts.visual_angle is
  'Formato/ângulo visual usado na imagem deste post (ver VISUAL_ANGLES em lib/content/planner.ts) — grava o que pickNextVisualAngle escolheu, pra rotacionar de verdade entre posts.';
