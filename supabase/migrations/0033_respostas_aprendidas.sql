-- Aprender com a resposta APROVADA do Lucas (19/08): quando ele responde um
-- HOLD pelo painel, a resposta vira conhecimento REUTILIZÁVEL daquele
-- conteúdo — a próxima pergunta igual já sai respondida, sem fila.
-- Não é auto-treino: é dado auditável, por conteúdo, gravado no ato da
-- aprovação (que É a confirmação humana), substituível e apagável.
create table if not exists respostas_aprendidas (
  id uuid primary key default gen_random_uuid(),
  media_id uuid references instagram_media(id) on delete cascade,
  -- Tema normalizado (decision_reason_code da análise que segurou, ex.:
  -- MISSING_INFORMATION:cardapio_carbonada) — a chave do reuso.
  topico text not null,
  pergunta_exemplo text,
  resposta_aprovada text not null,
  aprovado_por text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Última resposta aprovada vence (upsert por conteúdo+tema).
  unique (media_id, topico)
);

alter table respostas_aprendidas enable row level security;

drop trigger if exists respostas_aprendidas_upd on respostas_aprendidas;
create trigger respostas_aprendidas_upd before update on respostas_aprendidas
  for each row execute function panel_touch_updated_at();
