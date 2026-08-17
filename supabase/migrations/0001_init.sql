-- =============================================================================
-- Painel Vamo Nessa — schema inicial
--
-- Autenticação: Instagram API with Facebook Login (graph.facebook.com).
-- Decisão e evidência em docs/decisao-login.md.
--
-- O schema já contempla o fluxo COMPLETO, inclusive as etapas de IA que ainda
-- não serão implementadas, para que nada precise ser refeito depois:
--
--   comentário → webhook → deduplicar → analisar com IA → classificar intenção
--   → decidir ação → resposta pública → Private Reply → registrar → medir
--
-- DUAS CONVENÇÕES INEGOCIÁVEIS
--
--   1. NULL ≠ 0. NULL = a Meta não forneceu a métrica. 0 = forneceu zero.
--   2. Nada de histórico é sobrescrito. Snapshots são append-only.
--
-- Disponibilidade de métricas verificada em 17/08/2026 com ~900 chamadas reais.
-- Ver docs/metricas-disponibilidade.md.
-- =============================================================================

create extension if not exists pgcrypto;


-- =============================================================================
-- 1. CONEXÃO COM A META
-- =============================================================================

create table instagram_accounts (
  id                        uuid primary key default gen_random_uuid(),

  -- Instagram
  instagram_user_id         text not null unique,
  username                  text not null,
  name                      text,
  profile_picture_url       text,
  account_type              text,
  followers_count           integer,
  follows_count             integer,
  media_count               integer,

  -- Facebook (a ponte exigida pelo Facebook Login)
  facebook_page_id          text,
  facebook_page_name        text,

  -- Tokens, sempre criptografados (AES-256-GCM: nonce||ciphertext||tag).
  -- O Page Token derivado de um user token de longa duração NÃO expira
  -- (verificado: expires_at = 0). Guardamos o user token só para poder
  -- re-derivar o Page Token se ele for revogado.
  page_access_token_encrypted bytea,
  user_access_token_encrypted bytea,
  user_token_expires_at     timestamptz,
  scopes                    text[] not null default '{}',

  connection_status         text not null default 'DISCONNECTED'
    check (connection_status in ('CONNECTED','DISCONNECTED','TOKEN_EXPIRED','ERROR')),
  last_sync_at              timestamptz,
  last_error_code           text,
  last_error_message        text,
  last_error_at             timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on column instagram_accounts.followers_count is
  'Estado atual. O histórico vive em account_snapshots e nunca é sobrescrito.';


-- =============================================================================
-- 2. HISTÓRICO DA CONTA
-- =============================================================================

-- Snapshot horário. Única fonte de verdade do total de seguidores ao longo do
-- tempo: a Meta fornece deltas diários, nunca a série de totais. É também o que
-- viabiliza "+1h/+3h/+24h/+7d após a publicação".
create table account_snapshots (
  id                     bigserial primary key,
  instagram_account_id   uuid not null references instagram_accounts(id) on delete cascade,
  followers_count        integer,
  follows_count          integer,
  media_count            integer,
  captured_at            timestamptz not null default now(),
  source                 text not null default 'cron_hourly'
    check (source in ('cron_hourly','oauth_connect','manual','backfill_estimate')),
  unique (instagram_account_id, captured_at)
);

create index account_snapshots_account_time_idx
  on account_snapshots (instagram_account_id, captured_at desc);


-- Métricas diárias da Meta. Backfill verificado: até 2 anos.
--
-- SEMÂNTICA (verificada, fácil de errar):
--   new_followers = métrica `follower_count` = NOVOS seguidores no dia, BRUTO,
--                   sem descontar unfollows. NÃO é o total da conta.
--   net_follows   = `follows_and_unfollows` = seguiram MENOS deixaram de seguir.
--                   A API só devolve agregado por janela; preenchido por
--                   consulta dia a dia. NULL quando não coletado.
-- Os 2 dias mais recentes voltam 0 por atraso de processamento da Meta — daí
-- is_provisional. Nunca exibir esse 0 como fato.
create table account_daily_insights (
  id                     bigserial primary key,
  instagram_account_id   uuid not null references instagram_accounts(id) on delete cascade,
  date                   date not null,
  new_followers          integer,
  net_follows            integer,
  reach                  integer,
  views                  integer,
  total_interactions     integer,
  accounts_engaged       integer,
  likes                  integer,
  comments               integer,
  shares                 integer,
  saves                  integer,
  is_provisional         boolean not null default false,
  raw                    jsonb,
  captured_at            timestamptz not null default now(),
  unique (instagram_account_id, date)
);

create index account_daily_insights_date_idx
  on account_daily_insights (instagram_account_id, date desc);


-- =============================================================================
-- 3. CONTEÚDOS
-- =============================================================================

create table instagram_media (
  id                     uuid primary key default gen_random_uuid(),
  instagram_media_id     text not null unique,
  instagram_account_id   uuid not null references instagram_accounts(id) on delete cascade,

  media_type             text,
  media_product_type     text,
  caption                text,
  permalink              text,
  shortcode              text,
  -- URLs da Meta EXPIRAM; thumbnail_cached_path aponta para o Supabase Storage.
  thumbnail_url          text,
  media_url              text,
  thumbnail_cached_path  text,
  is_shared_to_feed      boolean,

  published_at           timestamptz not null,
  -- Derivadas em America/Sao_Paulo, para análise de horário e frequência.
  published_weekday      smallint generated always as
    (extract(isodow from (published_at at time zone 'America/Sao_Paulo'))::smallint) stored,
  published_hour         smallint generated always as
    (extract(hour from (published_at at time zone 'America/Sao_Paulo'))::smallint) stored,
  published_date_local   date generated always as
    ((published_at at time zone 'America/Sao_Paulo')::date) stored,

  deleted_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index instagram_media_published_idx    on instagram_media (published_at desc);
create index instagram_media_account_pub_idx  on instagram_media (instagram_account_id, published_at desc);
create index instagram_media_product_type_idx on instagram_media (media_product_type);
create index instagram_media_weekday_hour_idx on instagram_media (published_weekday, published_hour);
create index instagram_media_caption_fts_idx
  on instagram_media using gin (to_tsvector('portuguese', coalesce(caption,'')));


-- Snapshots de insights, append-only.
--
-- Verificado por tipo de mídia (Facebook Login):
--   REELS ✓ views reach likes comments shares saved total_interactions reposts
--           avg_watch_time_ms total_watch_time_ms skip_rate + agregados total_*
--   REELS ✗ follows profile_visits profile_activity
--           → "does not support ... for this media product type", idêntico nos
--             DOIS logins. NÃO é limitação de login, permissão ou versão.
--   FEED  ✓ tudo acima exceto as três de reels, MAIS follows/profile_visits/
--           profile_activity
--
-- ATENÇÃO À REDAÇÃO: a interface nativa do Instagram EXIBE seguidores por Reel.
-- O dado existe; a API é que não o expõe. Limitação de EXPOSIÇÃO, não de
-- existência. Por isso nenhuma coluna é removida.
create table media_insight_snapshots (
  id                     bigserial primary key,
  media_id               uuid not null references instagram_media(id) on delete cascade,

  views                  integer,
  reach                  integer,
  likes                  integer,
  comments               integer,
  shares                 integer,
  saved                  integer,
  reposts                integer,
  total_interactions     integer,

  -- Só REELS
  avg_watch_time_ms      integer,
  total_watch_time_ms    bigint,
  skip_rate              numeric(5,2),

  -- Só FEED/STORY — NULL em todo REELS
  follows                integer,
  profile_visits         integer,
  profile_activity       integer,

  -- Agregados que só o Facebook Login expõe (incluem Facebook e impulsionamento)
  total_views_count      bigint,
  total_like_count       integer,
  total_comments_count   integer,

  metrics_unavailable    text[] not null default '{}',
  raw                    jsonb,
  captured_at            timestamptz not null default now(),
  unique (media_id, captured_at)
);

create index media_insight_snapshots_media_time_idx
  on media_insight_snapshots (media_id, captured_at desc);


-- =============================================================================
-- 4. PESSOAS  —  histórico de interação e blacklist
-- =============================================================================

-- Uma linha por pessoa que já interagiu. É o que permite "já falamos com essa
-- pessoa antes?", cooldown e blacklist, e alimenta o contexto da IA.
create table instagram_users (
  id                        uuid primary key default gen_random_uuid(),
  instagram_user_id         text not null unique,     -- IGSID
  username                  text,

  first_seen_at             timestamptz not null default now(),
  last_seen_at              timestamptz not null default now(),
  comments_count            integer not null default 0,
  public_replies_count      integer not null default 0,
  private_replies_count     integer not null default 0,
  last_private_reply_at     timestamptz,
  last_intent               text,

  -- Blacklist: nunca mais contatar, por pedido da pessoa ou decisão nossa.
  is_blacklisted            boolean not null default false,
  blacklist_reason          text,
  blacklisted_at            timestamptz,
  blacklisted_by            text,

  notes                     text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index instagram_users_username_idx    on instagram_users (lower(username));
create index instagram_users_blacklist_idx   on instagram_users (is_blacklisted) where is_blacklisted;
create index instagram_users_last_dm_idx     on instagram_users (last_private_reply_at desc nulls last);


-- =============================================================================
-- 5. COMENTÁRIOS
-- =============================================================================

create table instagram_comments (
  id                      uuid primary key default gen_random_uuid(),
  instagram_comment_id    text not null unique,        -- idempotência do webhook
  media_id                uuid references instagram_media(id) on delete set null,
  instagram_media_id      text not null,
  user_id                 uuid references instagram_users(id) on delete set null,

  instagram_user_id       text,
  username                text,
  text                    text,
  parent_comment_id       text,
  is_from_account         boolean not null default false,

  commented_at            timestamptz not null,
  received_at             timestamptz not null default now(),
  source                  text not null default 'sync' check (source in ('webhook','sync')),

  -- Elegibilidade para Private Reply. Janela oficial: 7 dias da CRIAÇÃO do
  -- comentário — não do recebimento do webhook.
  eligibility_status      text not null default 'ELIGIBLE'
    check (eligibility_status in ('ELIGIBLE','SENT','FAILED','EXPIRED','NOT_ELIGIBLE')),
  eligibility_expires_at  timestamptz not null,
  not_eligible_reason     text,

  -- Estágio no pipeline de IA
  analysis_status         text not null default 'PENDING'
    check (analysis_status in ('PENDING','ANALYZING','ANALYZED','FAILED','SKIPPED')),

  deleted_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index instagram_comments_commented_idx on instagram_comments (commented_at desc);
create index instagram_comments_media_idx     on instagram_comments (instagram_media_id);
create index instagram_comments_user_idx      on instagram_comments (instagram_user_id);
create index instagram_comments_analysis_idx  on instagram_comments (analysis_status)
  where analysis_status in ('PENDING','ANALYZING');
create index instagram_comments_eligible_idx
  on instagram_comments (eligibility_status, eligibility_expires_at desc)
  where deleted_at is null;


-- =============================================================================
-- 6. CAMADA DE IA
-- =============================================================================

-- Prompts versionados. Uma análise SEMPRE referencia a versão exata usada, para
-- que a auditoria futura saiba por que o sistema disse o que disse.
create table ai_prompts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  version         integer not null,
  system_prompt   text not null,
  user_template   text not null,
  model           text not null,
  params          jsonb not null default '{}',
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at      timestamptz not null default now(),
  unique (name, version)
);


-- Uma análise por tentativa. Guarda o que a IA classificou E o que ela TERIA
-- respondido — em shadow mode nada é enviado, só registrado.
create table comment_analyses (
  id                       uuid primary key default gen_random_uuid(),
  comment_id               uuid not null references instagram_comments(id) on delete cascade,

  model                    text not null,
  prompt_id                uuid references ai_prompts(id) on delete set null,
  prompt_name              text,
  prompt_version           integer,

  -- Classificação
  intent                   text,
  intent_confidence        numeric(4,3) check (intent_confidence between 0 and 1),
  secondary_intents        text[] not null default '{}',
  sentiment                text,
  language                 text,

  -- Moderação e risco
  risk_level               text check (risk_level in ('NONE','LOW','MEDIUM','HIGH')),
  risk_reasons             text[] not null default '{}',
  requires_human           boolean not null default true,

  -- O que a IA produziria
  suggested_public_reply   text,
  suggested_private_reply  text,
  cta_strategy             text,     -- como o convite a seguir foi construído
  cta_included             boolean,

  -- Decisão do sistema e o PORQUÊ — exigência explícita do produto
  decision                 text check (decision in
    ('SEND_BOTH','SEND_PUBLIC_ONLY','SEND_PRIVATE_ONLY','HOLD_FOR_REVIEW','SKIP')),
  decision_reason          text,

  -- Auditoria
  input_snapshot           jsonb,    -- exatamente o que a IA recebeu
  raw_response             jsonb,
  tokens_in                integer,
  tokens_out               integer,
  latency_ms               integer,
  error_message            text,
  created_at               timestamptz not null default now()
);

create index comment_analyses_comment_idx on comment_analyses (comment_id, created_at desc);
create index comment_analyses_intent_idx  on comment_analyses (intent, created_at desc);
create index comment_analyses_risk_idx    on comment_analyses (risk_level)
  where risk_level in ('MEDIUM','HIGH');


-- =============================================================================
-- 7. AÇÕES  —  resposta pública e Private Reply no MESMO pipeline
--
-- Unificar as duas em uma tabela mantém aprovação, fila, retry, idempotência e
-- auditoria em um lugar só, em vez de duplicar a lógica.
-- =============================================================================

create table comment_actions (
  id                  uuid primary key default gen_random_uuid(),
  comment_id          uuid not null references instagram_comments(id) on delete cascade,
  analysis_id         uuid references comment_analyses(id) on delete set null,
  campaign_id         uuid,          -- FK adicionada após dm_campaigns

  action_type         text not null check (action_type in ('PUBLIC_REPLY','PRIVATE_REPLY')),
  -- SHADOW  = geramos e registramos, mas jamais enviamos
  -- MANUAL  = exige aprovação humana
  -- AUTO    = liberado por intenção, após termos dados de acerto
  mode                text not null default 'SHADOW' check (mode in ('SHADOW','MANUAL','AUTO')),

  status              text not null default 'SHADOW' check (status in
    ('SHADOW','PENDING_APPROVAL','APPROVED','REJECTED','QUEUED','SENDING',
     'SENT','FAILED','SKIPPED','EXPIRED')),

  generated_text      text,          -- o que a IA produziu, imutável
  final_text          text,          -- o que de fato saiu (pode ter sido editado)
  edited_by           text,
  approved_by         text,
  approved_at         timestamptz,
  rejected_by         text,
  rejected_reason     text,

  -- Fila
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  locked_until        timestamptz,
  locked_by           text,

  sent_at             timestamptz,
  external_id         text,          -- message_id ou id da resposta pública
  external_recipient_id text,

  error_code          text,
  error_message       text,
  error_class         text check (error_class in ('PERMANENT','TEMPORARY','TOKEN')),
  skip_reason         text,          -- por que NÃO enviamos

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- IDEMPOTÊNCIA. A Meta permite UMA Private Reply por comentário, para sempre.
-- Garantido por constraint, não por lógica: um worker que reprocesse um lote
-- travado não consegue enviar duas vezes.
create unique index comment_actions_one_send_per_comment_type
  on comment_actions (comment_id, action_type) where status = 'SENT';

create index comment_actions_queue_idx
  on comment_actions (status, next_attempt_at)
  where status in ('QUEUED','SENDING');
create index comment_actions_review_idx
  on comment_actions (status, created_at desc)
  where status in ('SHADOW','PENDING_APPROVAL');
create index comment_actions_comment_idx on comment_actions (comment_id);


-- =============================================================================
-- 8. CAMPANHAS EM MASSA  (mensagem fixa, caminho independente da IA)
-- =============================================================================

create table dm_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  body        text not null,
  status      text not null default 'ACTIVE' check (status in ('ACTIVE','ARCHIVED')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table dm_campaigns (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  status           text not null default 'DRAFT' check (status in
    ('DRAFT','QUEUED','RUNNING','PAUSED','COMPLETED','FAILED')),
  -- Congelado na criação. Editar o template depois NUNCA altera o que foi enviado.
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

create table dm_campaign_variants (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references dm_campaigns(id) on delete cascade,
  label            text not null,
  message_snapshot text not null,
  weight           integer not null default 1 check (weight > 0),
  unique (campaign_id, label)
);

alter table comment_actions
  add constraint comment_actions_campaign_fk
  foreign key (campaign_id) references dm_campaigns(id) on delete set null;

alter table comment_actions add column variant_id uuid
  references dm_campaign_variants(id) on delete set null;

create index comment_actions_campaign_idx on comment_actions (campaign_id, status);


-- Respostas que as pessoas mandam de volta na DM, via webhook `messages`.
create table dm_replies_received (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid references instagram_users(id) on delete set null,
  instagram_user_id  text not null,
  action_id          uuid references comment_actions(id) on delete set null,
  text               text,
  received_at        timestamptz not null default now()
);

create index dm_replies_received_user_idx on dm_replies_received (instagram_user_id, received_at desc);


-- =============================================================================
-- 9. CONTROLE DE AUTOMAÇÃO  —  kill switch, cooldown, tetos
-- =============================================================================

create table automation_settings (
  id                      boolean primary key default true check (id),   -- singleton
  -- Desliga TODO envio imediatamente. Verificado pelo worker a cada lote.
  kill_switch             boolean not null default true,
  -- Enquanto true, a IA gera e registra mas nada é enviado.
  shadow_mode             boolean not null default true,
  -- Intenções liberadas para envio automático. Vazio = tudo exige aprovação.
  auto_approve_intents    text[] not null default '{}',
  -- Intenções que NUNCA podem ser automáticas, mesmo se listadas acima.
  never_auto_intents      text[] not null default
    '{critica,situacao_delicada,oportunidade_comercial,spam}',
  min_confidence_for_auto numeric(4,3) not null default 0.850,
  dm_hourly_cap           integer not null default 600,   -- limite oficial: 750/h
  dm_daily_cap            integer not null default 2000,
  cooldown_days_per_user  integer not null default 90,
  require_approval        boolean not null default true,
  updated_at              timestamptz not null default now(),
  updated_by              text
);

insert into automation_settings (id) values (true);


-- =============================================================================
-- 10. INFRAESTRUTURA
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
-- 11. updated_at automático
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
    'instagram_accounts','instagram_media','instagram_comments','instagram_users',
    'dm_templates','comment_actions'
  ] loop
    execute format(
      'create trigger %I before update on %I for each row execute function touch_updated_at()',
      t || '_touch', t);
  end loop;
end $$;


-- =============================================================================
-- 12. FUNIL
--
-- Cada etapa vem de um fato registrado. NÃO existe etapa "DM → seguiu": a Meta
-- não fornece atribuição individual de follow. O crescimento aparece ao lado,
-- como associação temporal, nunca como causa.
-- =============================================================================

create view funnel_daily as
select
  d.dia,
  d.comentarios_recebidos,
  d.comentarios_classificados,
  d.respostas_publicas_enviadas,
  d.private_replies_elegiveis,
  d.private_replies_enviadas,
  d.respostas_recebidas_dm,
  i.new_followers,
  i.net_follows
from (
  select
    (c.commented_at at time zone 'America/Sao_Paulo')::date as dia,
    count(*)                                                          as comentarios_recebidos,
    count(*) filter (where c.analysis_status = 'ANALYZED')             as comentarios_classificados,
    count(*) filter (where exists (
      select 1 from comment_actions a
      where a.comment_id = c.id and a.action_type = 'PUBLIC_REPLY' and a.status = 'SENT'))
                                                                      as respostas_publicas_enviadas,
    count(*) filter (where c.eligibility_status = 'ELIGIBLE')          as private_replies_elegiveis,
    count(*) filter (where exists (
      select 1 from comment_actions a
      where a.comment_id = c.id and a.action_type = 'PRIVATE_REPLY' and a.status = 'SENT'))
                                                                      as private_replies_enviadas,
    count(*) filter (where exists (
      select 1 from dm_replies_received r where r.instagram_user_id = c.instagram_user_id
        and r.received_at >= c.commented_at))                          as respostas_recebidas_dm
  from instagram_comments c
  where c.deleted_at is null
  group by 1
) d
left join account_daily_insights i on i.date = d.dia;


-- =============================================================================
-- 13. ROW LEVEL SECURITY
--
-- Negar por padrão. O service role (só no servidor) ignora RLS e é quem escreve.
-- Operadores em app_users apenas LEEM. instagram_accounts, webhook_events e
-- app_users ficam sem policy de leitura de propósito: contêm tokens, payloads
-- crus e a própria lista de acesso.
-- =============================================================================

alter table instagram_accounts      enable row level security;
alter table account_snapshots       enable row level security;
alter table account_daily_insights  enable row level security;
alter table instagram_media         enable row level security;
alter table media_insight_snapshots enable row level security;
alter table instagram_users         enable row level security;
alter table instagram_comments      enable row level security;
alter table ai_prompts              enable row level security;
alter table comment_analyses        enable row level security;
alter table comment_actions         enable row level security;
alter table dm_templates            enable row level security;
alter table dm_campaigns            enable row level security;
alter table dm_campaign_variants    enable row level security;
alter table dm_replies_received     enable row level security;
alter table automation_settings     enable row level security;
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

do $$
declare t text;
begin
  foreach t in array array[
    'account_snapshots','account_daily_insights','instagram_media',
    'media_insight_snapshots','instagram_users','instagram_comments','ai_prompts',
    'comment_analyses','comment_actions','dm_templates','dm_campaigns',
    'dm_campaign_variants','dm_replies_received','automation_settings','sync_runs'
  ] loop
    execute format(
      'create policy %I on %I for select to authenticated using (is_app_user())',
      t || '_read', t);
  end loop;
end $$;
