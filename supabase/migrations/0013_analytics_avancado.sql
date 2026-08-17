-- =============================================================================
-- Horários, frequência e crescimento pós-publicação.
--
-- Três regras que o produto exige e que o SQL garante:
--   1. MEDIANA, não média — um viral distorce a média e some na mediana.
--   2. N sempre visível — "sábado 3h é o melhor horário" com N=1 é ruído.
--   3. Crescimento pós-publicação vem de account_snapshots, NUNCA de atribuição
--      da Meta, que não existe para Reels.
-- =============================================================================

-- Mediana por dia da semana. Usa o último snapshot de cada mídia.
create or replace function desempenho_por_dia()
returns table (
  dia smallint, posts bigint,
  views_medianas numeric, reach_mediano numeric,
  shares_medianos numeric, comentarios_medianos numeric,
  confianca text
)
language sql stable as $$
  with ultimo as (
    select distinct on (s.media_id) s.*, m.published_weekday
    from media_insight_snapshots s
    join instagram_media m on m.id = s.media_id
    where m.deleted_at is null
    order by s.media_id, s.captured_at desc
  )
  select published_weekday,
         count(*),
         percentile_cont(0.5) within group (order by views),
         percentile_cont(0.5) within group (order by reach),
         percentile_cont(0.5) within group (order by shares),
         percentile_cont(0.5) within group (order by comments),
         -- Classificação de confiança pelo tamanho da amostra. É o que impede a
         -- interface de afirmar padrão onde só há coincidência.
         case when count(*) < 3 then 'Dados insuficientes'
              when count(*) < 8 then 'Baixa confiança'
              when count(*) < 20 then 'Confiança moderada'
              else 'Boa amostra' end
  from ultimo
  group by 1
  order by 1;
$$;

-- Heatmap dia × hora.
create or replace function heatmap_dia_hora()
returns table (dia smallint, hora smallint, posts bigint, views_medianas numeric)
language sql stable as $$
  with ultimo as (
    select distinct on (s.media_id) s.views, m.published_weekday, m.published_hour
    from media_insight_snapshots s
    join instagram_media m on m.id = s.media_id
    where m.deleted_at is null
    order by s.media_id, s.captured_at desc
  )
  select published_weekday, published_hour, count(*),
         percentile_cont(0.5) within group (order by views)
  from ultimo group by 1,2;
$$;

-- Frequência por semana ISO, cruzada com desempenho e crescimento.
-- A faixa existe para comparar "semanas de 1-2 posts" com "semanas de 7-9",
-- sem afirmar que a frequência CAUSA o crescimento.
create or replace function frequencia_semanal()
returns table (
  semana date, posts bigint, faixa text,
  views_medianas numeric, shares_medianos numeric,
  novos_seguidores bigint
)
language sql stable as $$
  with ultimo as (
    select distinct on (s.media_id) s.views, s.shares, m.published_date_local
    from media_insight_snapshots s
    join instagram_media m on m.id = s.media_id
    where m.deleted_at is null
    order by s.media_id, s.captured_at desc
  ),
  por_semana as (
    select date_trunc('week', published_date_local)::date as semana,
           count(*) as posts,
           percentile_cont(0.5) within group (order by views) as vm,
           percentile_cont(0.5) within group (order by shares) as sm
    from ultimo group by 1
  )
  select p.semana, p.posts,
         case when p.posts <= 2 then '1-2'
              when p.posts <= 4 then '3-4'
              when p.posts <= 6 then '5-6'
              when p.posts <= 9 then '7-9'
              else '10+' end,
         p.vm, p.sm,
         (select sum(i.new_followers) from account_daily_insights i
           where not i.is_provisional
             and i.date >= p.semana and i.date < p.semana + 7)
  from por_semana p
  order by p.semana desc;
$$;

-- Crescimento observado após cada publicação.
--
-- Para cada Δ, pega o snapshot mais próximo de (publicação + Δ) e subtrai o
-- snapshot da publicação. Devolve NULL quando não há snapshot na janela — nunca
-- interpola: um número inventado aqui viraria decisão de conteúdo errada.
create or replace function crescimento_pos_publicacao(limite int default 30)
returns table (
  media_id uuid, caption text, permalink text, thumbnail_url text,
  published_at timestamptz, views int,
  base int, mais_1h int, mais_3h int, mais_6h int, mais_24h int, mais_48h int, mais_7d int
)
language sql stable as $$
  with recentes as (
    select m.id, m.caption, m.permalink, m.thumbnail_url, m.published_at,
           m.instagram_account_id
    from instagram_media m
    where m.deleted_at is null
    order by m.published_at desc
    limit limite
  ),
  ponto as (
    select r.id as mid, d.horas,
           (select s.followers_count from account_snapshots s
             where s.instagram_account_id = r.instagram_account_id
               and s.captured_at between r.published_at + make_interval(hours => d.horas) - interval '90 minutes'
                                    and r.published_at + make_interval(hours => d.horas) + interval '90 minutes'
             order by abs(extract(epoch from (s.captured_at - (r.published_at + make_interval(hours => d.horas)))))
             limit 1) as seguidores
    from recentes r
    cross join (values (0),(1),(3),(6),(24),(48),(168)) as d(horas)
  ),
  pivot as (
    select mid,
      max(seguidores) filter (where horas = 0)   as base,
      max(seguidores) filter (where horas = 1)   as h1,
      max(seguidores) filter (where horas = 3)   as h3,
      max(seguidores) filter (where horas = 6)   as h6,
      max(seguidores) filter (where horas = 24)  as h24,
      max(seguidores) filter (where horas = 48)  as h48,
      max(seguidores) filter (where horas = 168) as h168
    from ponto group by 1
  ),
  ins as (
    select distinct on (s.media_id) s.media_id, s.views
    from media_insight_snapshots s order by s.media_id, s.captured_at desc
  )
  select r.id, r.caption, r.permalink, r.thumbnail_url, r.published_at, i.views,
         p.base,
         p.h1 - p.base, p.h3 - p.base, p.h6 - p.base,
         p.h24 - p.base, p.h48 - p.base, p.h168 - p.base
  from recentes r
  join pivot p on p.mid = r.id
  left join ins i on i.media_id = r.id
  order by r.published_at desc;
$$;

grant execute on function desempenho_por_dia() to authenticated, service_role;
grant execute on function heatmap_dia_hora() to authenticated, service_role;
grant execute on function frequencia_semanal() to authenticated, service_role;
grant execute on function crescimento_pos_publicacao(int) to authenticated, service_role;
