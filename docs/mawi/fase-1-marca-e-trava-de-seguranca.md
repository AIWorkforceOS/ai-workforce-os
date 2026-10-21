# Fase 1 — Marca da empresa + trava de segurança em `users` (20/10/2026)

**Estado:** código pronto e testado localmente; migrations 099 e 100 **validadas em produção em transação desfeita** (não aplicadas); nada publicado até a autorização.

## O que o usuário vê
- O **super admin Alizo** abre a página da empresa (Organizações → empresa) e, na tabela de acessos, liga/desliga **"Pode trocar a logo"** para cada administrador. Também pode enviar a logo da empresa dali.
- O **administrador liberado** (ex.: vinny29lp@gmail.com) vê em **Configurações** o cartão **Logo da empresa**: escolhe a imagem (PNG/JPEG/WebP, até 2 MB), vê a prévia e salva. Sem a liberação, o cartão não aparece e a API recusa.
- Ao salvar, a logo **substitui a do Alizo** no painel da equipe (cabeçalho e menu), no Portal do Funcionário e no Portal do Cliente. Remover volta à logo do Alizo.
- Páginas públicas do Alizo (login, site, termos) e o Sign Off em PDF (modelo fixo da 360) **não mudam** nesta fase.

## Migrations
- **099 (segurança, urgente):** qualquer usuário logado podia editar a própria linha em `public.users` (inclusive `role` e `org_id`) pela API — um técnico podia virar super admin. Novo gatilho: usuário comum só altera o próprio nome/último acesso; o resto só o super admin ou o servidor. Colunas futuras ficam protegidas automaticamente.
- **100 (marca):** `organizations.brand_logo_url/_updated_at/_updated_by`, `users.can_manage_branding` (padrão desligado) e o bucket público `org-branding` (2 MB, PNG/JPEG/WebP, sem SVG, sem escrita direta de usuários).
- Rollback: `supabase/rollbacks/20261020_099_100_branding_and_users_guard_rollback.sql`.

## Segurança da imagem
O servidor decodifica a imagem de verdade, confere o conteúdo (não só o tipo), reduz para 800×400, regrava como PNG sem metadados e guarda com nome por hash. SVG/HTML/script disfarçado é recusado. Só a chave de serviço grava no bucket e na tabela da empresa.

## Ordem de aplicação
1. Aplicar **099** (sozinha já fecha a falha) e **100**.
2. Publicar o código (ele tolera a migration ausente: sem a coluna, mostra a logo do Alizo e esconde a permissão).
3. Super admin libera o vinny29lp@gmail.com; ele envia a logo da Mawi.
