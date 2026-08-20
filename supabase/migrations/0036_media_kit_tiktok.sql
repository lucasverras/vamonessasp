-- O design final do kit usa, no TikTok, "curtidas no total" e "views · 7 dias"
-- (os números que o app do TikTok mostra na tela inicial), não 90 dias.
alter table media_kit_manual rename column tiktok_views_90d to tiktok_views_7d;
alter table media_kit_manual rename column tiktok_curtidas_90d to tiktok_curtidas_total;
alter table media_kit_manual drop column if exists tiktok_compart_90d;
-- Valores que o Lucas preencheu no Claude Design em 20/08/2026.
update media_kit_manual set
  parceiros = coalesce(parceiros, 300),
  tiktok_seguidores = coalesce(tiktok_seguidores, 7867),
  tiktok_curtidas_total = coalesce(tiktok_curtidas_total, 192800),
  tiktok_views_7d = coalesce(tiktok_views_7d, 329000),
  fb_seguidores = coalesce(fb_seguidores, 8200),
  updated_by = coalesce(updated_by, 'seed: Claude Design 20/08')
where id;
