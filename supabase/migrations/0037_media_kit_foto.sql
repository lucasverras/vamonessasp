-- Foto de capa/dupla: URL pública opcional (se vazia, a página usa
-- public/media-kit/capa.jpg e dupla.jpg quando existirem).
alter table media_kit_manual add column if not exists foto_capa_url text;
alter table media_kit_manual add column if not exists foto_dupla_url text;
