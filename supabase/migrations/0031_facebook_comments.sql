-- Comentários da Página do Facebook — fluxo de RESPOSTA PÚBLICA em REVIEW.
--
-- Auditoria de 19/08: a Meta OCULTA o autor (from) dos comentários de Página
-- sem App Review — por isso platform_user_id é nullable e NENHUMA lógica de
-- DM/cooldown/qualificação existe aqui (INVALID_IDENTITY estrutural até a
-- permissão sair). Público responde ao TEXTO; identidade não é necessária.
create table if not exists facebook_comments (
  id uuid primary key default gen_random_uuid(),
  external_comment_id text not null unique,
  external_post_id text,
  platform_user_id text,          -- null até a Meta liberar `from`
  user_name text,
  message text,
  post_message text,              -- texto do post, cacheado na análise
  commented_at timestamptz not null default now(),
  status text not null default 'PENDING_AI'
    check (status in ('PENDING_AI','PENDING_APPROVAL','NEEDS_HUMAN','SENT','REJECTED','FAILED','SKIPPED')),
  suggested_reply text,
  final_reply text,
  intent text,
  decision_reason text,
  approved_by text,
  sent_at timestamptz,
  external_reply_id text,
  error_message text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_comments_status_idx
  on facebook_comments (status, commented_at desc);

alter table facebook_comments enable row level security;

drop trigger if exists facebook_comments_updated on facebook_comments;
create trigger facebook_comments_updated before update on facebook_comments
  for each row execute function panel_touch_updated_at();
