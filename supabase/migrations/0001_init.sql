-- =============================================================================
-- Painel Vamo Nessa — schema inicial
--
-- Desenhado a partir de sondagem real da API em 17/08/2026 contra @vamonessasp
-- (30.042 seguidores, 256 mídias: 255 REELS + 1 FEED). As colunas de métrica
-- refletem o que a API DEVOLVE DE FATO para esta conta, não o que a documentação
-- lista. Ver docs/plano-tecnico.md.
--
-- CONVENÇÃO INEGOCIÁVEL:
--   NULL = a Meta não forneceu a métrica (não suportada / erro / indisponível)
--   0    = a Meta forneceu zero
-- As duas coisas nunca são confundidas, no banco nem na interface.
-- =============================================================================

create extension if not exists pgcrypto;

-- Fuso canônico do produto. Usado nas colunas derivadas de recorte temporal.
create or replace function app_tz() returns text
  language sql immutable parallel safe as $$ select 'America/Sao_Paulo' $$;


-- =============================================================================
-- CONTA
-- =============================================================================

create table instagram_accounts (
  id                       uuid primary key default gen_random_uuid(),
  instagram_user_id        text not null unique,
  username                 text not null,
  name                     text,
  profile_picture_url      text,
  account_type             text,               -- MEDIA_CREATOR, BUSINESS...
  followers_count          integer,
  follows_count            integer,
  media_count              integer,

  -- Token nunca em texto puro. AES-256-GCM: nonce(12) || ciphertext || tag(16).
  access_token_encrypted   bytea,
  token_expires_at         timestamptz,
  scopes                   text[] not null default '{}',

  connection_status        text not null default 'DISCONNECTED'
    check (connection_status in ('CONNECTED','DISCONNECTED','TOKEN_EXPIRED','ERROR')),
  last_sync_at             timestamptz,
  last_error_code          text,
  last_error_message       text,
  last_error_at            timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

comment on column instagram_accounts.followers_count is
  'Estado atual retornado pela Meta. O histórico vive em account_snapshots e nunca é sobrescrito.';


-- Snapshot horário. É a ÚNICA fonte de verdade do total de seguidores ao longo
-- do tempo — a Meta não fornece a série histórica de totais, só deltas diários.
-- Também é o que viabiliza "+1h/+3h/+6h/+24h/+48h/+7d após a publicação".
create table account_snapshots (
  id                       bigserial primary key,
  instagram_account_id     uuid not null references instagram_accounts(id) on delete cascade,
  followers_count          integer,
  follows_count            integer,
  media_count              integer,
  captured_at              timestamptz not null default now(),
  source                   text not null default 'cron_hourly'
    check (source in ('cron_hourly','oauth_connect','manual','backfill_estimate')),
  unique (instagram_account_id, captured_at)
);

create index account_snapshots_account_time_idx
  on account_snapshots (instagram_account_id, captured_at desc);


-- Métricas diárias vindas da Meta. Backfill confirmado: até 2 anos.
--
-- ATENÇÃO À SEMÂNTICA, verificada na sondagem:
--   new_followers  = métrica `follower_count` da Meta = NOVOS seguidores no dia
--                    (BRUTO, não desconta unfollows). NÃO é o total da conta.
--   net_follows    = métrica `follows_and_unfollows` = seguiram MENOS deixaram
--                    de seguir. A API só devolve agregado por janela, então é
--                    preenchida por consulta dia a dia no backfill; NULL quando
--                    não coletada.
-- Observado: os 2 dias mais recentes voltam 0 por atraso de processamento da
-- Meta. Por isso `is_provisional` — nunca exibir 0 recente como fato.
create table account_daily_insights (
  id                       bigserial primary key,
  instagram_account_id     uuid not null references instagram_accounts(id) on delete cascade,
  date                     date not null,
  new_followers            integer,
  net_follows              integer,
  reach                    integer,
  views                    integer,
  total_interactions       integer,
  accounts_engaged         integer,
  likes                    integer,
  comments                 integer,
  shares                   integer,
  saves                    integer,
  is_provisional           boolean not null default false,
  raw                      jsonb,
  captured_at              timestamptz not null default now(),
  unique (instagram_account_id, date)
);

create index account_daily_insights_date_idx
  on account_daily_insights (instagram_account_id, date desc);


-- =============================================================================
-- CONTEÚDOS
-- =============================================================================

create table instagram_media (
  id                       uuid primary key default gen_random_uuid(),
  instagram_media_id       text not null unique,
  instagram_account_id     uuid not null references instagram_accounts(id) on delete cascade,

  media_type               text,               -- VIDEO, IMAGE, CAROUSEL_ALBUM
  media_product_type       text,               -- REELS, FEED, STORY
  caption                  text,
  permalink                text,
  shortcode                text,
  -- URLs da Meta EXPIRAM. thumbnail_cached_path aponta para o Supabase Storage.
  thumbnail_url            text,
  media_url                text,
  thumbnail_cached_path    text,
  is_shared_to_feed        boolean,

  published_at             timestamptz not null,
  -- Derivadas em America/Sao_Paulo para as análises de horário e frequência.
  published_weekday        smallint generated always as
    (extract(isodow from (published_at at time zone 'America/Sao_Paulo'))::smallint) stored,
  published_hour           smallint generated always as
    (extract(hour   from (published_at at time zone 'America/Sao_Paulo'))::smallint) stored,
  published_date_local     date generated always as
    ((published_at at time zone 'America/Sao_Paulo')::date) stored,

  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index instagram_media_published_idx    on instagram_media (published_at desc);
create index instagram_media_account_pub_idx  on instagram_media (instagram_account_id, published_at desc);
create index instagram_media_product_type_idx on instagram_media (media_product_type);
create index instagram_media_weekday_hour_idx on instagram_media (published_weekday, published_hour);
create index instagram_media_caption_trgm_idx on instagram_media using gin (to_tsvector('portuguese', coalesce(caption,'')));


-- Snapshots de insights. Append-only: nunca sobrescrever histórico.
--
-- Disponibilidade verificada em 17/08/2026 com 276 chamadas cobrindo 7 mídias
-- (2023→2026) x 5 versões da API (v22.0→v26.0). Matriz completa e mensagens de
-- erro exatas em docs/metricas-disponibilidade.md.
--
-- A API rejeita métricas em TRÊS camadas distintas, e a diferença importa:
--
--   a) por tipo de mídia — "does not support the X metric for this media
--      product type". Estrutural e estável.
--        REELS ✗ follows, profile_visits, profile_activity
--        FEED  ✗ ig_reels_avg_watch_time, ig_reels_video_view_total_time,
--                reels_skip_rate
--
--   b) pelo endpoint/autenticação — "Instagram Insights Media API endpoint does
--      not support the metrics: X". A métrica EXISTE no enum da API, mas este
--      endpoint (Instagram Login) não a serve. Falha em TODOS os tipos e em
--      TODAS as versões.
--        AMBOS ✗ reposts
--
--   c) explicitamente de outro login — "The metric X is not available on this
--      endpoint": total_views, total_likes, total_comments, link_clicks.
--
-- Todas as colunas abaixo permanecem, inclusive as que hoje voltam NULL: a
-- capacidade não é removida do modelo, apenas não é preenchida enquanto a API
-- não a servir. Se migrarmos para Facebook Login, `reposts` passa a ser
-- preenchível sem alterar o schema.
--
-- ATENÇÃO À REDAÇÃO: a interface nativa do Instagram EXIBE seguidores por Reel.
-- O dado existe e o Instagram o calcula. O que está verificado é que a API que
-- usamos não o EXPÕE. São afirmações diferentes: isto é limitação de exposição
-- da API, não inexistência da métrica. Por isso nenhuma coluna é removida.
--
-- Consequência de produto: 255 dos 256 conteúdos são REELS. Enquanto `follows`
-- não vier por Reel, a análise pós-publicação usa account_snapshots e a UI diz
-- "crescimento observado após a publicação", nunca "seguidores gerados pelo
-- Reel". Se a API passar a expor, o painel exibe a métrica oficial sem migração.
create table media_insight_snapshots (
  id                       bigserial primary key,
  media_id                 uuid not null references instagram_media(id) on delete cascade,

  views                    integer,
  reach                    integer,
  likes                    integer,
  comments                 integer,
  shares                   integer,
  saved                    integer,
  total_interactions       integer,

  avg_watch_time_ms        integer,            -- ig_reels_avg_watch_time
  total_watch_time_ms      bigint,             -- ig_reels_video_view_total_time
  skip_rate                numeric(5,2),       -- reels_skip_rate (%)

  -- Bloqueadas por TIPO DE MÍDIA: só FEED/STORY. NULL em todo REELS.
  follows                  integer,
  profile_visits           integer,
  profile_activity         integer,

  -- Bloqueada pelo ENDPOINT, não pelo tipo: `reposts` está no enum de métricas
  -- da API, mas o host graph.instagram.com (Instagram Login) não a serve em
  -- nenhum tipo nem versão. Anunciada em abr/2026 para Instagram API with
  -- Facebook Login. Coluna mantida para não descartar a capacidade: se
  -- migrarmos de login, passa a ser preenchida sem migração de schema.
  reposts                  integer,

  -- Auditoria: nomes das métricas que a API recusou nesta coleta.
  metrics_unavailable      text[] not null default '{}',
  raw                      jsonb,
  captured_at              timestamptz not null default now(),
  unique (media_id, captured_at)
);

create index media_insight_snapshots_media_time_idx
  on media_insight_snapshots (media_id, captured_at desc);


-- =============================================================================
-- COMENTÁRIOS
-- =============================================================================

create table instagram_comments (
  id                       uuid primary key default gen_random_uuid(),
  instagram_comment_id     text not null unique,          -- idempotência do webhook
  media_id                 uuid references instagram_media(id) on delete set null,
  instagram_media_id       text not null,

  instagram_user_id        text,                          -- IGSID; sem ele não há DM
  username                 text,
  text                     text,
  parent_comment_id        text,
  is_from_account          boolean not null default false,

  commented_at             timestamptz not null,
  received_at              timestamptz not null default now(),
  source                   text not null default 'sync' check (source in ('webhook','sync')),

  eligibility_status       text not null default 'ELIGIBLE'
    check (eligibility_status in ('ELIGIBLE','SENT','FAILED','EXPIRED','NOT_ELIGIBLE')),
  -- Janela oficial de private reply: 7 dias da CRIAÇÃO do comentário.
  eligibility_expires_at   timestamptz not null,
  not_eligible_reason      text,

  private_reply_sent_at    timestamptz,
  private_reply_message_id text,
  failure_reason           text,

  deleted_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index instagram_comments_commented_idx   on instagram_comments (commented_at desc);
create index instagram_comments_media_idx       on instagram_comments (instagram_media_id);
create index instagram_comments_user_idx        on instagram_comments (instagram_user_id);
-- Índice da fila operacional: "quem ainda pode receber mensagem".
create index instagram_comments_eligible_idx
  on instagram_comments (eligibility_status, eligibility_expires_at desc)
  where deleted_at is null;


-- =============================================================================
-- MENSAGENS E CAMPANHAS
-- =============================================================================

create table dm_templates (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  body         text not null,
  status       text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table dm_campaigns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  status           text not null default 'DRAFT'
    check (status in ('DRAFT','QUEUED','RUNNING','PAUSED','COMPLETED','FAILED')),
  -- Congelado na criação. Alterar o template depois NUNCA altera o que foi enviado.
  message_snapshot text not null,
  template_id      uuid references dm_templates(id) on delete set null,
  is_ab_test       boolean not null default false,

  total_recipients integer not null default 0,
  sent_count       integer not null default 0,
  failed_count     integer not null default 0,
  skipped_count    integer not null default 0,

  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_by       text
);

create index dm_campaigns_status_idx on dm_campaigns (status, created_at desc);

-- Estrutura pronta para teste A/B sem que nada dependa dela hoje.
create table dm_campaign_variants (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references dm_campaigns(id) on delete cascade,
  label            text not null,
  message_snapshot text not null,
  weight           integer not null default 1 check (weight > 0),
  unique (campaign_id, label)
);

create table dm_campaign_recipients (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    uuid not null references dm_campaigns(id) on delete cascade,
  comment_id     uuid not null references instagram_comments(id) on delete cascade,
  variant_id     uuid references dm_campaign_variants(id) on delete set null,

  status         text not null default 'PENDING'
    check (status in ('PENDING','SENDING','SENT','FAILED','SKIPPED')),
  attempts       integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_until   timestamptz,
  locked_by      text,

  sent_at        timestamptz,
  ig_message_id  text,
  ig_recipient_id text,
  error_code     text,
  error_message  text,
  error_class    text check (error_class in ('PERMANENT','TEMPORARY','TOKEN')),

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (campaign_id, comment_id)
);

-- IDEMPOTÊNCIA: a Meta permite UMA private reply por comentário, para sempre.
-- Isto é garantido por constraint, não por lógica de aplicação — um worker que
-- reprocesse um lote travado não consegue enviar duas vezes.
create unique index dm_recipients_one_send_per_comment
  on dm_campaign_recipients (comment_id) where status = 'SENT';

-- Índice de claim da fila (FOR UPDATE SKIP LOCKED).
create index dm_recipients_queue_idx
  on dm_campaign_recipients (status, next_attempt_at)
  where status in ('PENDING','SENDING');

-- Respostas recebidas às nossas DMs, via webhook `messages` (fase 5).
create table dm_replies_received (
  id                uuid primary key default gen_random_uuid(),
  instagram_user_id text not null,
  comment_id        uuid references instagram_comments(id) on delete set null,
  text              text,
  received_at       timestamptz not null default now()
);


-- =============================================================================
-- INFRAESTRUTURA
-- =============================================================================

create table webhook_events (
  id              bigserial primary key,
  object          text,
  field           text,
  payload         jsonb not null,
  signature_valid boolean not null,
  dedupe_key      text not null unique,
  received_at     timestamptz not null default now(),
  processed_at    timestamptz,
  error           text
);

create index webhook_events_received_idx on webhook_events (received_at desc);

create table sync_runs (
  id                bigserial primary key,
  type              text not null,
  status            text not null default 'RUNNING'
    check (status in ('RUNNING','SUCCESS','PARTIAL','FAILED')),
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  records_processed integer not null default 0,
  api_requests      integer not null default 0,
  error_code        text,
  error_message     text
);

create index sync_runs_type_started_idx on sync_runs (type, started_at desc);

create table app_users (
  id         uuid primary key default gen_random_uuid(),
  email      text not null unique,
  role       text not null default 'operator',
  created_at timestamptz not null default now()
);


-- =============================================================================
-- updated_at automático
-- =============================================================================

create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'instagram_accounts','instagram_media','instagram_comments',
    'dm_templates','dm_campaign_recipients'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I
         for each row execute function touch_updated_at()', t || '_updated', t);
  end loop;
end $$;


-- =============================================================================
-- ROW LEVEL SECURITY
--
-- Postura: negar tudo por padrão. O service role (usado apenas no servidor)
-- ignora RLS por definição e é quem escreve. Usuários autenticados presentes em
-- app_users podem apenas LER, e nunca a coluna de token — por isso o token vive
-- em instagram_accounts, que não recebe policy de leitura alguma.
-- =============================================================================

alter table instagram_accounts      enable row level security;
alter table account_snapshots       enable row level security;
alter table account_daily_insights  enable row level security;
alter table instagram_media         enable row level security;
alter table media_insight_snapshots enable row level security;
alter table instagram_comments      enable row level security;
alter table dm_templates            enable row level security;
alter table dm_campaigns            enable row level security;
alter table dm_campaign_variants    enable row level security;
alter table dm_campaign_recipients  enable row level security;
alter table dm_replies_received     enable row level security;
alter table webhook_events          enable row level security;
alter table sync_runs               enable row level security;
alter table app_users               enable row level security;

create or replace function is_app_user() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from app_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
$$;

-- Leitura para operadores autorizados. instagram_accounts, webhook_events e
-- app_users ficam DE FORA de propósito: contêm token, payloads crus e a própria
-- lista de acesso. O painel lê esses dados por rotas de servidor.
do $$
declare t text;
begin
  foreach t in array array[
    'account_snapshots','account_daily_insights','instagram_media',
    'media_insight_snapshots','instagram_comments','dm_templates','dm_campaigns',
    'dm_campaign_variants','dm_campaign_recipients','dm_replies_received','sync_runs'
  ] loop
    execute format(
      'create policy %I on %I for select to authenticated using (is_app_user())',
      t || '_read', t);
  end loop;
end $$;
