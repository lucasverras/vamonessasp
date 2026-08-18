-- =============================================================================
-- Regra global de DM (60 dias), menções como fonte de oportunidade, e a
-- consulta de elegibilidade POR PESSOA resolvida no banco.
-- =============================================================================

-- 1. A regra muda: UMA private reply por PESSOA a cada N dias, global —
--    não mais por pessoa+conteúdo. 60 é o padrão pedido; editável no painel.
alter table automation_settings
  alter column cooldown_days_per_user set default 60;
update automation_settings set cooldown_days_per_user = 60;

alter table automation_settings
  add column if not exists dm_on_comment boolean not null default true,
  add column if not exists dm_on_mention boolean not null default true,
  add column if not exists dm_mention_template text not null default
'Valeu por mencionar o Vamo Nessa! 💚

Se ainda não segue a gente, segue o @vamonessasp pra acompanhar os próximos lugares e rolês 👀';

-- 2. FONTE ÚNICA da última DM: trigger no envio. Qualquer caminho de código
--    que marque SENT atualiza instagram_users.last_private_reply_at — a regra
--    dos 60 dias não depende de ninguém lembrar de chamar uma função.
create or replace function marcar_ultima_dm() returns trigger
language plpgsql as $$
begin
  if new.action_type = 'PRIVATE_REPLY' and new.status = 'SENT'
     and (old.status is distinct from 'SENT') and new.instagram_user_id is not null then
    update instagram_users
       set last_private_reply_at = coalesce(new.sent_at, now())
     where instagram_user_id = new.instagram_user_id
       and (last_private_reply_at is null or last_private_reply_at < coalesce(new.sent_at, now()));
  end if;
  return new;
end $$;

drop trigger if exists comment_actions_ultima_dm on comment_actions;
create trigger comment_actions_ultima_dm
  after update on comment_actions
  for each row execute function marcar_ultima_dm();

-- Backfill: garante que o histórico já enviado está refletido.
update instagram_users u
   set last_private_reply_at = s.ultimo
  from (select instagram_user_id, max(sent_at) ultimo
          from comment_actions
         where action_type = 'PRIVATE_REPLY' and status = 'SENT' and instagram_user_id is not null
         group by 1) s
 where u.instagram_user_id = s.instagram_user_id
   and (u.last_private_reply_at is null or u.last_private_reply_at < s.ultimo);

-- 3. Menções: nova fonte de oportunidade, via webhook oficial (field=mentions).
--    STORY_MENTION chega pelo webhook de messages e exige Advanced Access —
--    o tipo existe no schema desde já; o envio para ela fica bloqueado com
--    motivo até o App Review liberar.
create table if not exists instagram_mentions (
  id uuid primary key default gen_random_uuid(),
  mention_type text not null check (mention_type in ('COMMENT_MENTION', 'CAPTION_MENTION', 'STORY_MENTION')),
  -- IDs externos como a Meta os entrega. comment_id presente = private reply
  -- clássica funciona; ausente (story/caption) = caminho de messaging.
  external_media_id text,
  external_comment_id text,
  instagram_user_id text,
  username text,
  text text,
  mentioned_at timestamptz not null default now(),
  -- Janela de resposta: 7 dias para menção com comment_id (regra de private
  -- reply), 24h para story mention (janela de messaging).
  eligibility_expires_at timestamptz,
  dm_status text not null default 'ELIGIBLE'
    check (dm_status in ('ELIGIBLE', 'SENT', 'SKIPPED', 'EXPIRED', 'BLOCKED')),
  dm_skip_reason text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (mention_type, external_media_id, external_comment_id, instagram_user_id)
);

create index if not exists mentions_user_idx on instagram_mentions (instagram_user_id);
create index if not exists mentions_eligible_idx
  on instagram_mentions (dm_status, mentioned_at desc) where dm_status = 'ELIGIBLE';

alter table instagram_mentions enable row level security;

-- 4. Índice que faltava para "última DM por pessoa" varrida em massa.
create index if not exists comment_actions_pessoa_sent_idx
  on comment_actions (instagram_user_id, sent_at desc)
  where action_type = 'PRIVATE_REPLY' and status = 'SENT';

-- 5. A LISTA FINAL, POR PESSOA, calculada no banco — nada de carregar
--    centenas de linhas no JS para filtrar depois.
--    Uma linha por pessoa ELEGÍVEL + um resumo do que foi removido e por quê.
create or replace function oportunidades_dm()
returns table (
  instagram_user_id text,
  username text,
  origem text,                 -- 'COMMENT' | 'MENTION'
  ultima_interacao timestamptz,
  ultimo_texto text,
  ultimo_conteudo text,
  comment_id uuid,             -- comentário mais recente da pessoa (para o envio)
  follow_status text,
  last_private_reply_at timestamptz
)
language sql stable as $$
  with cfg as (select cooldown_days_per_user from automation_settings limit 1),
  eventos as (
    select c.instagram_user_id, c.username, 'COMMENT'::text origem,
           c.commented_at quando, c.text, m.caption conteudo, c.id comment_id
    from instagram_comments c
    left join instagram_media m on m.id = c.media_id
    where c.eligibility_status = 'ELIGIBLE'
      and c.eligibility_expires_at > now()
      and c.deleted_at is null
      and c.is_from_account = false
      and c.instagram_user_id is not null
    union all
    select mt.instagram_user_id, mt.username, 'MENTION', mt.mentioned_at, mt.text,
           null, null
    from instagram_mentions mt
    where mt.dm_status = 'ELIGIBLE'
      and (mt.eligibility_expires_at is null or mt.eligibility_expires_at > now())
      and mt.instagram_user_id is not null
  ),
  por_pessoa as (
    select distinct on (e.instagram_user_id)
           e.instagram_user_id, e.username, e.origem, e.quando, e.text, e.conteudo, e.comment_id
    from eventos e
    order by e.instagram_user_id, e.quando desc
  )
  select p.instagram_user_id, p.username, p.origem, p.quando, p.text, p.conteudo,
         p.comment_id, u.follow_status, u.last_private_reply_at
  from por_pessoa p
  left join instagram_users u on u.instagram_user_id = p.instagram_user_id
  cross join cfg
  where coalesce(u.is_blacklisted, false) = false
    and coalesce(u.follow_status, 'UNKNOWN') <> 'FOLLOWS'
    and (u.last_private_reply_at is null
         or u.last_private_reply_at < now() - (cfg.cooldown_days_per_user || ' days')::interval)
  order by p.quando desc;
$$;

create or replace function oportunidades_resumo()
returns table (
  comentarios_elegiveis bigint,
  mencoes_elegiveis bigint,
  pessoas_brutas bigint,
  pessoas_elegiveis bigint,
  removidas_duplicidade bigint,
  removidas_ja_segue bigint,
  removidas_dm_recente bigint,
  removidas_blacklist bigint
)
language sql stable as $$
  with cfg as (select cooldown_days_per_user from automation_settings limit 1),
  eventos as (
    select c.instagram_user_id uid, 'C' k
    from instagram_comments c
    where c.eligibility_status = 'ELIGIBLE' and c.eligibility_expires_at > now()
      and c.deleted_at is null and c.is_from_account = false and c.instagram_user_id is not null
    union all
    select mt.instagram_user_id, 'M'
    from instagram_mentions mt
    where mt.dm_status = 'ELIGIBLE'
      and (mt.eligibility_expires_at is null or mt.eligibility_expires_at > now())
      and mt.instagram_user_id is not null
  ),
  pessoas as (
    select uid, count(*) eventos from eventos group by 1
  ),
  julgadas as (
    select p.uid, p.eventos,
           coalesce(u.is_blacklisted, false) bl,
           coalesce(u.follow_status, 'UNKNOWN') = 'FOLLOWS' segue,
           (u.last_private_reply_at is not null
            and u.last_private_reply_at >= now() - ((select cooldown_days_per_user from cfg) || ' days')::interval) recente
    from pessoas p
    left join instagram_users u on u.instagram_user_id = p.uid
  )
  select
    (select count(*) from eventos where k = 'C'),
    (select count(*) from eventos where k = 'M'),
    (select count(*) from julgadas),
    (select count(*) from julgadas where not bl and not segue and not recente),
    (select coalesce(sum(eventos - 1), 0) from julgadas),
    (select count(*) from julgadas where segue),
    (select count(*) from julgadas where recente and not segue),
    (select count(*) from julgadas where bl);
$$;

-- 6. Saúde da automação (últimas 24h) para o card técnico.
create or replace function saude_automacao()
returns table (
  enviadas_24h bigint, falhas_24h bigint, na_fila bigint,
  aguardando_aprovacao bigint, erros_de_politica_24h bigint
)
language sql stable as $$
  select
    (select count(*) from comment_actions where sent_at > now() - interval '24 hours'),
    (select count(*) from comment_actions where status = 'FAILED' and updated_at > now() - interval '24 hours'),
    (select count(*) from comment_actions where status in ('QUEUED', 'SENDING')),
    (select count(*) from comment_actions where status = 'PENDING_APPROVAL'),
    (select count(*) from comment_actions
      where error_code = '10' and updated_at > now() - interval '24 hours');
$$;

grant execute on function oportunidades_dm() to authenticated, service_role;
grant execute on function oportunidades_resumo() to authenticated, service_role;
grant execute on function saude_automacao() to authenticated, service_role;
