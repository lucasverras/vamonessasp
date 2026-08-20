-- Media Kit gerado pelo painel: os números vêm da API da Meta (já no banco);
-- o que a API não dá (parceiros, TikTok, seguidores da Página, preço) fica
-- aqui, editável. Cada geração congela um snapshot — o kit de AGOSTO/2026
-- continua dizendo os números de agosto mesmo depois que o banco mudar.
create table if not exists media_kit_manual (
  id boolean primary key default true check (id),
  parceiros int,
  tiktok_seguidores int,
  tiktok_views_90d bigint,
  tiktok_curtidas_90d int,
  tiktok_compart_90d int,
  fb_seguidores int,
  valor_padrao numeric(10,2) default 600,
  whatsapp text default '(11) 98936-0428',
  updated_at timestamptz not null default now(),
  updated_by text
);
insert into media_kit_manual (id) values (true) on conflict do nothing;
alter table media_kit_manual enable row level security;

create table if not exists media_kit_gerados (
  id uuid primary key default gen_random_uuid(),
  rotulo text not null,
  cliente text,
  valor numeric(10,2),
  numeros jsonb not null,
  gerado_por text,
  created_at timestamptz not null default now()
);
create index if not exists media_kit_gerados_created_idx on media_kit_gerados (created_at desc);
alter table media_kit_gerados enable row level security;
