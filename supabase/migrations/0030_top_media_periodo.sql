-- "Conteúdos que mais renderam" obedece o filtro global de período.
create or replace function top_media_periodo(limite int, desde timestamptz, ate timestamptz)
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
  where m.deleted_at is null and m.published_at >= desde and m.published_at < ate
  order by u.views desc nulls last
  limit limite;
$$;
grant execute on function top_media_periodo(int, timestamptz, timestamptz) to authenticated, service_role;
