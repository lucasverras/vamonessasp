-- Nome de exibição dos cases no media kit: o @ da legenda vira
-- "Chico Grill", "Degá"... Editável na aba; vale para todos os meses.
create table if not exists media_kit_apelidos (
  chave text primary key,          -- @handle (minúsculo) ou nome derivado do título
  nome text not null,
  updated_at timestamptz not null default now()
);
alter table media_kit_apelidos enable row level security;
insert into media_kit_apelidos (chave, nome) values
  ('@chicogrillvilamatilde', 'Chico Grill'),
  ('@degasp', 'Degá'),
  ('@festivalitaliamodern', 'Festival Itália'),
  ('@santomarestaurante', 'Santo Mar'),
  ('@dolcevitamooca', 'Dolce Vita'),
  ('@clubedetirobulldog', 'Clube de Tiro Bulldog'),
  ('rei do macarrão', 'Rei do Macarrão')
on conflict (chave) do nothing;
