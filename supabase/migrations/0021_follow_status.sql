-- Status de follow, verificado na API oficial e cacheado.
-- UNKNOWN é um estado honesto, não uma falha: hoje o campo exige Advanced
-- Access (App Review pendente) e TODO usuário resolve para UNKNOWN — e
-- UNKNOWN significa "sem DM sugerida", nunca "presume que não segue".
alter table instagram_users
  add column if not exists follow_status text not null default 'UNKNOWN'
    check (follow_status in ('FOLLOWS', 'NOT_FOLLOWING', 'UNKNOWN')),
  add column if not exists follow_status_checked_at timestamptz,
  add column if not exists follow_status_source text;
