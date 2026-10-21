-- Rollback da migration 101 (perfil do cliente). Rodar SOMENTE com autorização.
-- ATENÇÃO: apaga os dados cadastrados dos clientes (logo, endereço, contato). As ordens voltam a sair com os dados da 360.
-- Os arquivos de logo no bucket "org-branding" (pasta <org>/clients/...) ficam e podem ser apagados à parte.
drop trigger if exists client_company_profiles_updated_at on public.client_company_profiles;
drop table if exists public.client_company_profiles;
