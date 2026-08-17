-- =============================================================================
-- Funções de agregação do painel.
--
-- Ficam no banco porque somar 256 conteúdos no navegador seria absurdo, e
-- porque a regra de "último snapshot por mídia" precisa ser aplicada em um
-- lugar só: somar TODOS os snapshots contaria o mesmo conteúdo várias vezes,
-- e esse é o erro mais fácil de cometer com histórico append-only.
-- =============================================================================

create or replace function overview_media_totals(desde_param timestamptz)
returns table (views bigint, reach bigint, shares bigint, comments bigint,
               saved bigint, reposts bigint, likes bigint)
language sql stable as $$
  with ultimo as (
    select distinct on (s.media_id) s.*
    from media_insight_snapshots s
    join instagram_media m on m.id = s.media_id
    where m.published_at >= desde_param and m.deleted_at is null
    order by s.media_id, s.captured_at desc
  )
  select sum(u.views)::bigint, sum(u.reach)::bigint, sum(u.shares)::bigint,
         sum(u.comments)::bigint, sum(u.saved)::bigint, sum(u.reposts)::bigint,
         sum(u.likes)::bigint
  from ultimo u;
$$;

create or replace function top_media(limite int default 8)
returns table (
  id uuid, caption text, permalink text, thumbnail_url text,
  media_product_type text, published_at timestamptz,
  views int, reach int, shares int, comments int, reposts int,
  saved int, likes int, skip_rate numeric, avg_watch_time_ms int
)
language sql stable as $$
  with ultimo as (
    select distinct on (s.media_id) s.*
    from media_insight_snapshots s
    order by s.media_id, s.captured_at desc
  )
  select m.id, m.caption, m.permalink, m.thumbnail_url, m.media_product_type,
         m.published_at, u.views, u.reach, u.shares, u.comments, u.reposts,
         u.saved, u.likes, u.skip_rate, u.avg_watch_time_ms
  from instagram_media m
  join ultimo u on u.media_id = m.id
  where m.deleted_at is null
  order by u.views desc nulls last
  limit limite;
$$;

grant execute on function overview_media_totals(timestamptz) to authenticated, service_role;
grant execute on function top_media(int) to authenticated, service_role;
