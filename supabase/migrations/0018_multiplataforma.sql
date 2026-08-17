-- =============================================================================
-- CONTENT + PLATFORM_POST: um conteúdo editorial, várias publicações.
--
-- Aditiva. instagram_media e media_insight_snapshots FICAM COMO ESTÃO — o
-- Instagram entra no modelo novo por ponte (legacy_media_id), sem copiar
-- histórico. Facebook e TikTok nascem direto aqui. Rollback = dropar as três
-- tabelas novas; nada do que existia é tocado.
-- =============================================================================

create table if not exists contents (
  id uuid primary key default gen_random_uuid(),
  -- Título interno; no backfill, primeira linha da legenda.
  title text,
  -- Fatos editoriais — a ÚNICA fonte de onde a IA pode tirar fato.
  business_name text,
  address text,
  neighborhood text,
  city text,
  price text,
  opening_hours text,
  instagram_handle text,
  website text,
  notes text,
  tags text[] not null default '{}',
  -- De qual mídia do Instagram este content nasceu no backfill (idempotência
  -- do backfill e rastreabilidade). Nulo para contents criados à mão.
  seed_media_id uuid unique references instagram_media(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists platform_posts (
  id uuid primary key default gen_random_uuid(),
  -- on delete SET NULL: desfazer um vínculo ou apagar um content nunca apaga
  -- a publicação — ela volta a ser "sem grupo".
  content_id uuid references contents(id) on delete set null,
  platform text not null check (platform in ('instagram', 'facebook', 'tiktok')),
  -- ID principal na plataforma. No Facebook um Reel tem DOIS ids (vídeo e
  -- post) com métricas divididas entre eles — por isso as duas colunas.
  external_post_id text not null,
  external_video_id text,
  -- Ponte para o histórico do Instagram: métricas continuam vindo de
  -- media_insight_snapshots, sem duplicação.
  legacy_media_id uuid references instagram_media(id) on delete set null,
  permalink text,
  caption text,
  published_at timestamptz,
  media_type text,
  thumbnail_url text,
  duration_s numeric,
  -- Como este post foi vinculado ao content: 'backfill' (1:1 do IG),
  -- 'auto-caption' (similaridade alta + janela de tempo), 'manual'.
  match_method text,
  match_confidence numeric,
  matched_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_post_id)
);

create index if not exists platform_posts_content_idx on platform_posts (content_id);
create index if not exists platform_posts_published_idx on platform_posts (published_at desc);

-- Snapshots multiplataforma: append-only, uma linha por coleta.
-- NULL = a plataforma não forneceu. 0 = forneceu zero. Nunca confundidos.
create table if not exists platform_insight_snapshots (
  id bigserial primary key,
  platform_post_id uuid not null references platform_posts(id) on delete cascade,
  captured_at timestamptz not null default now(),
  views bigint,
  reach bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saved bigint,
  -- O que é específico da plataforma (ex.: post_views do Facebook) vive aqui,
  -- com o nome ORIGINAL — sem tradução forçada entre plataformas.
  platform_metrics jsonb
);

create index if not exists pis_post_captured_idx
  on platform_insight_snapshots (platform_post_id, captured_at desc);

alter table contents enable row level security;
alter table platform_posts enable row level security;
alter table platform_insight_snapshots enable row level security;

drop trigger if exists contents_updated_at on contents;
create trigger contents_updated_at before update on contents
  for each row execute function panel_touch_updated_at();
drop trigger if exists platform_posts_updated_at on platform_posts;
create trigger platform_posts_updated_at before update on platform_posts
  for each row execute function panel_touch_updated_at();

-- ---------------------------------------------------------------- backfill IG
-- Idempotente: seed_media_id e (platform, external_post_id) são únicos.
insert into contents (title, seed_media_id, created_at)
select left(regexp_replace(coalesce(m.caption, '(sem legenda)'), E'\\s+', ' ', 'g'), 80),
       m.id, m.published_at
from instagram_media m
where m.deleted_at is null
on conflict (seed_media_id) do nothing;

insert into platform_posts
  (content_id, platform, external_post_id, legacy_media_id, permalink, caption,
   published_at, media_type, thumbnail_url, match_method, match_confidence)
select c.id, 'instagram', m.instagram_media_id, m.id, m.permalink, m.caption,
       m.published_at, m.media_product_type, m.thumbnail_url, 'backfill', 1
from instagram_media m
join contents c on c.seed_media_id = m.id
where m.deleted_at is null
on conflict (platform, external_post_id) do nothing;

-- ------------------------------------------------- leitura consolidada da tela
-- Uma linha por content, métricas por plataforma no ÚLTIMO snapshot de cada
-- publicação. Instagram lê da ponte legada; Facebook/TikTok do modelo novo.
-- Tudo agregado no banco: a tela não faz N+1.
create or replace function conteudos_consolidados(desde_param timestamptz)
returns table (
  content_id uuid, title text, thumbnail_url text, permalink text,
  published_at timestamptz,
  ig_views bigint, ig_reach bigint, ig_likes bigint, ig_comments bigint, ig_shares bigint, ig_saved bigint,
  fb_views bigint, fb_likes bigint, fb_comments bigint, fb_shares bigint,
  tt_views bigint, tt_likes bigint, tt_comments bigint, tt_shares bigint,
  plataformas text[]
)
language sql stable as $$
  with ig as (
    select pp.content_id, pp.thumbnail_url, pp.permalink, pp.published_at,
           u.views::bigint views, u.reach::bigint reach, u.likes::bigint likes,
           u.comments::bigint comments, u.shares::bigint shares, u.saved::bigint saved
    from platform_posts pp
    left join lateral (
      select s.* from media_insight_snapshots s
      where s.media_id = pp.legacy_media_id
      order by s.captured_at desc limit 1
    ) u on true
    where pp.platform = 'instagram'
  ),
  fb as (
    select pp.content_id, pp.thumbnail_url, pp.permalink, pp.published_at,
           s.views, s.likes, s.comments, s.shares
    from platform_posts pp
    left join lateral (
      select * from platform_insight_snapshots s
      where s.platform_post_id = pp.id
      order by s.captured_at desc limit 1
    ) s on true
    where pp.platform = 'facebook'
  ),
  tt as (
    select pp.content_id, s.views, s.likes, s.comments, s.shares
    from platform_posts pp
    left join lateral (
      select * from platform_insight_snapshots s
      where s.platform_post_id = pp.id
      order by s.captured_at desc limit 1
    ) s on true
    where pp.platform = 'tiktok'
  )
  select c.id, c.title,
         coalesce(ig.thumbnail_url, fb.thumbnail_url),
         coalesce(ig.permalink, fb.permalink),
         coalesce(ig.published_at, fb.published_at, c.created_at),
         ig.views, ig.reach, ig.likes, ig.comments, ig.shares, ig.saved,
         fb.views, fb.likes, fb.comments, fb.shares,
         tt.views, tt.likes, tt.comments, tt.shares,
         array_remove(array[
           case when ig.content_id is not null then 'instagram' end,
           case when fb.content_id is not null then 'facebook' end,
           case when tt.content_id is not null then 'tiktok' end
         ], null)
  from contents c
  left join ig on ig.content_id = c.id
  left join fb on fb.content_id = c.id
  left join tt on tt.content_id = c.id
  where coalesce(ig.published_at, fb.published_at, c.created_at) >= desde_param
  order by coalesce(ig.published_at, fb.published_at, c.created_at) desc;
$$;

grant execute on function conteudos_consolidados(timestamptz) to authenticated, service_role;
