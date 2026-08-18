-- Fallback humano como fluxo principal + separação público/DM.

-- A DM vira TEMPLATE institucional (objetivo: follow), configurável no painel.
-- A resposta pública NUNCA pede follow — validado no código, não só no prompt.
alter table automation_settings
  add column if not exists dm_template text not null default
'Valeu por comentar no nosso vídeo! 💚

A gente é o Vamo Nessa e sempre mostra restaurantes, rolês e lugares diferentes por SP.

Se ainda não segue a gente, segue o @vamonessasp pra não perder os próximos 👀';

-- Desfecho da revisão humana de um HOLD: respondido por mim, ignorado de
-- propósito, ou ainda aberto (null). NEEDS_HUMAN_REVIEW não é falha — é fila.
alter table comment_analyses
  add column if not exists reviewed_by text,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_outcome text
    check (review_outcome in ('HUMAN_REPLIED', 'IGNORED'));

-- Taxa de automação real — sem otimizar artificialmente: SENT com origem AI
-- conta como automático; o resto é o que é.
create or replace function taxa_automacao()
returns table (
  comentarios_recebidos bigint,
  respondidos_automaticamente bigint,
  precisaram_de_humano bigint,
  ignorados bigint,
  falharam bigint
)
language sql stable as $$
  select
    (select count(*) from instagram_comments where is_from_account = false and deleted_at is null),
    (select count(distinct ca.comment_id) from comment_actions ca
      where ca.action_type = 'PUBLIC_REPLY' and ca.status = 'SENT' and ca.reply_source = 'AI'),
    (select count(*) from comment_analyses a
      where a.decision = 'HOLD_FOR_REVIEW' or a.review_outcome = 'HUMAN_REPLIED'),
    (select count(*) from comment_analyses where decision = 'SKIP'),
    (select count(distinct comment_id) from comment_actions where status = 'FAILED');
$$;

grant execute on function taxa_automacao() to authenticated, service_role;

-- Fila "Precisa de você", já ordenada por prioridade:
-- mais antigo > pergunta > reclamação > risco de expirar > resto.
create or replace function fila_precisa_de_voce(limite int default 30)
returns table (
  analysis_id uuid, comment_id uuid, username text, comment_text text,
  commented_at timestamptz, eligibility_expires_at timestamptz,
  intent text, intent_confidence numeric, risk_level text,
  decision_reason text, decision_reason_code text,
  facts_available text[], facts_missing text[],
  suggested_public_reply text,
  caption text, thumbnail_url text, permalink text, media_id uuid
)
language sql stable as $$
  select a.id, c.id, c.username, c.text, c.commented_at, c.eligibility_expires_at,
         a.intent, a.intent_confidence, a.risk_level,
         a.decision_reason, a.decision_reason_code,
         a.facts_available, a.facts_missing,
         a.suggested_public_reply,
         m.caption, m.thumbnail_url, m.permalink, m.id
  from comment_analyses a
  join instagram_comments c on c.id = a.comment_id
  left join instagram_media m on m.id = c.media_id
  where a.decision = 'HOLD_FOR_REVIEW'
    and a.review_outcome is null
    and c.deleted_at is null
    -- a análise mais recente daquele comentário
    and a.created_at = (select max(a2.created_at) from comment_analyses a2 where a2.comment_id = c.id)
    and not exists (select 1 from comment_actions ca
                     where ca.comment_id = c.id and ca.action_type = 'PUBLIC_REPLY'
                       and ca.status in ('SENT', 'QUEUED', 'SENDING'))
  order by
    case when a.intent in ('localizacao','preco','horario','duvida') then 0
         when a.intent in ('critica','situacao_delicada') then 1
         else 2 end,
    c.commented_at asc
  limit limite;
$$;

grant execute on function fila_precisa_de_voce(int) to authenticated, service_role;
