-- Conexão TikTok (Login Kit + Display API).
--
-- Espelha a estrutura da conta Instagram no que faz sentido, mas os tokens têm
-- outra vida: access token dura 24h, refresh token 365 dias — renovação é rotina
-- aqui, não exceção. Ambos cifrados em repouso (AES-256-GCM), como os da Meta.

create table if not exists tiktok_accounts (
  id uuid primary key default gen_random_uuid(),
  -- open_id é o identificador estável do usuário para ESTE app.
  open_id text not null unique,
  union_id text,
  display_name text,
  avatar_url text,
  -- Métricas de conta, do escopo user.info.stats.
  follower_count int,
  following_count int,
  likes_count int,
  video_count int,
  scopes text[] not null default '{}',
  access_token_encrypted bytea,
  refresh_token_encrypted bytea,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connection_status text not null default 'CONNECTED'
    check (connection_status in ('CONNECTED', 'REVOKED', 'ERROR')),
  -- Preenchidos pelo webhook authorization.removed: quando e por quê (código
  -- 0-5 da doc oficial). Nunca inferido.
  revoked_at timestamptz,
  revoked_reason int,
  last_sync_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Eventos crus do webhook do TikTok, como os da Meta: dedupe antes de
-- processar, payload guardado para reprocesso.
create table if not exists tiktok_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event text,
  user_openid text,
  payload jsonb not null,
  signature_valid boolean not null,
  dedupe_key text unique,
  processed_at timestamptz,
  error text,
  received_at timestamptz not null default now()
);

alter table tiktok_accounts enable row level security;
alter table tiktok_webhook_events enable row level security;
-- Sem policies: só a service_role lê. Tokens nunca passam pelo anon key.

drop trigger if exists tiktok_accounts_updated_at on tiktok_accounts;
create trigger tiktok_accounts_updated_at
  before update on tiktok_accounts
  for each row execute function panel_touch_updated_at();
