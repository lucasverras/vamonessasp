-- BUG (20/08/2026): conteúdo com DOIS posts do Facebook vinculados (o mesmo
-- reel publicado duas vezes, casado por legenda) virava DUAS linhas em
-- conteudos_consolidados — content_id repetido, chave duplicada no React, e a
-- tabela de Conteúdos "desordenava" ao trocar o critério. Agora Facebook e
-- TikTok são AGREGADOS por conteúdo (soma das métricas dos posts; thumbnail e
-- link do post mais antigo). Instagram segue 1 post por conteúdo.
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
    select distinct on (pp.content_id)
           pp.content_id, pp.thumbnail_url, pp.permalink, pp.published_at,
           u.views::bigint views, u.reach::bigint reach, u.likes::bigint likes,
           u.comments::bigint comments, u.shares::bigint shares, u.saved::bigint saved
    from platform_posts pp
    left join lateral (
      select s.* from media_insight_snapshots s
      where s.media_id = pp.legacy_media_id
      order by s.captured_at desc limit 1
    ) u on true
    where pp.platform = 'instagram' and pp.content_id is not null
    order by pp.content_id, pp.published_at asc
  ),
  fb_posts as (
    select pp.content_id, pp.thumbnail_url, pp.permalink, pp.published_at,
           s.views, s.likes, s.comments, s.shares
    from platform_posts pp
    left join lateral (
      select * from platform_insight_snapshots s
      where s.platform_post_id = pp.id
      order by s.captured_at desc limit 1
    ) s on true
    where pp.platform = 'facebook' and pp.content_id is not null
  ),
  fb as (
    select content_id,
           (array_agg(thumbnail_url order by published_at))[1] thumbnail_url,
           (array_agg(permalink order by published_at))[1] permalink,
           min(published_at) published_at,
           sum(views)::bigint views, sum(likes)::bigint likes,
           sum(comments)::bigint comments, sum(shares)::bigint shares
    from fb_posts group by content_id
  ),
  tt_posts as (
    select pp.content_id, s.views, s.likes, s.comments, s.shares
    from platform_posts pp
    left join lateral (
      select * from platform_insight_snapshots s
      where s.platform_post_id = pp.id
      order by s.captured_at desc limit 1
    ) s on true
    where pp.platform = 'tiktok' and pp.content_id is not null
  ),
  tt as (
    select content_id, sum(views)::bigint views, sum(likes)::bigint likes,
           sum(comments)::bigint comments, sum(shares)::bigint shares
    from tt_posts group by content_id
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
