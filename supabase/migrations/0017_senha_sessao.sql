-- Invalidação de sessão por troca de senha.
--
-- A sessão é um token assinado sem estado no servidor; sozinha, ela não tem
-- como ser revogada. password_changed_at dá o corte: tokens emitidos ANTES da
-- última troca são recusados pelas ações do servidor (exigirSessao), mesmo com
-- assinatura válida. Trocar a senha derruba as sessões antigas daquela pessoa.
alter table panel_users
  add column if not exists password_changed_at timestamptz not null default now();
