-- Private Reply no FACEBOOK — regras do Lucas (19/08):
--   sem follow_status como critério; cooldown 60d POR USUÁRIO quando houver
--   identidade; sem identidade → proteção por comment_id (a mais segura
--   disponível) com a limitação REGISTRADA; nunca 2 por comentário (unique).
-- pages_messaging ainda não existe no token: flag desligada por padrão,
-- implementação completa, habilitação = permissão + flag.

alter table automation_settings
  add column if not exists fb_private_reply_enabled boolean not null default false,
  add column if not exists fb_dm_template text not null default
'Valeu por comentar no nosso vídeo! 💚

A gente é o Vamo Nessa e sempre mostra restaurantes, rolês e lugares diferentes por SP.

Se ainda não acompanha a gente por aqui, segue a página pra não perder os próximos 👀';

alter table facebook_comments
  add column if not exists confidence text
    check (confidence in ('HIGH','MEDIUM','LOW'));

create table if not exists facebook_private_replies (
  id uuid primary key default gen_random_uuid(),
  comment_row_id uuid not null references facebook_comments(id) on delete cascade,
  -- NUNCA duas private replies para o mesmo comentário: constraint, não if.
  external_comment_id text not null unique,
  platform_user_id text,          -- null = Meta ocultou o autor
  status text not null default 'ELIGIBLE'
    check (status in ('ELIGIBLE','SENDING','SENT','SKIPPED','FAILED')),
  skip_reason text,
  template_snapshot text,
  sent_at timestamptz,
  external_message_id text,
  error_message text,
  -- Registro explícito da limitação: cooldown aplicado por USUÁRIO ou apenas
  -- por COMENTÁRIO (quando a Meta ocultou a identidade).
  cooldown_scope text not null default 'COMMENT_ONLY'
    check (cooldown_scope in ('USER','COMMENT_ONLY')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists fb_pr_user_sent_idx
  on facebook_private_replies (platform_user_id, sent_at desc)
  where status = 'SENT' and platform_user_id is not null;
create index if not exists fb_pr_eligible_idx
  on facebook_private_replies (status, created_at) where status = 'ELIGIBLE';

alter table facebook_private_replies enable row level security;

drop trigger if exists fb_pr_updated on facebook_private_replies;
create trigger fb_pr_updated before update on facebook_private_replies
  for each row execute function panel_touch_updated_at();
