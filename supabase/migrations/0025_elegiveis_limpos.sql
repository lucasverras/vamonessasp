-- "Elegível" passa a significar "AINDA VALE MANDAR": uma linha por pessoa
-- (o comentário mais recente), excluindo quem segue, quem tem DM na janela,
-- quem está bloqueado E QUEM JÁ ESTÁ NA FILA aguardando aprovação — pessoa
-- com DM pendente aparecer como elegível de novo era a fonte das recusas em
-- massa na criação de campanha.

create or replace function listar_elegiveis_limpos(limite int default 300)
returns table (
  id uuid, username text, comment_text text, commented_at timestamptz,
  eligibility_status text, eligibility_expires_at timestamptz,
  not_eligible_reason text, instagram_user_id text,
  caption text, permalink text, thumbnail_url text
)
language sql stable as $$
  with cfg as (select cooldown_days_per_user d from automation_settings limit 1),
  ultimos as (
    select distinct on (c.instagram_user_id) c.*
    from instagram_comments c
    where c.eligibility_status = 'ELIGIBLE'
      and c.eligibility_expires_at > now()
      and c.deleted_at is null
      and c.is_from_account = false
      and c.instagram_user_id is not null
    order by c.instagram_user_id, c.commented_at desc
  )
  select u.id, u.username, u.text, u.commented_at, u.eligibility_status,
         u.eligibility_expires_at, u.not_eligible_reason, u.instagram_user_id,
         m.caption, m.permalink, m.thumbnail_url
  from ultimos u
  left join instagram_media m on m.id = u.media_id
  left join instagram_users p on p.instagram_user_id = u.instagram_user_id
  cross join cfg
  where coalesce(p.is_blacklisted, false) = false
    and coalesce(p.follow_status, 'UNKNOWN') <> 'FOLLOWS'
    and (p.last_private_reply_at is null
         or p.last_private_reply_at < now() - (cfg.d || ' days')::interval)
    and not exists (
      select 1 from comment_actions ca
      where ca.instagram_user_id = u.instagram_user_id
        and ca.action_type = 'PRIVATE_REPLY'
        and ca.status in ('PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENDING')
    )
  order by u.commented_at desc
  limit limite;
$$;

-- oportunidades_dm e o resumo ganham o MESMO filtro de "já na fila" — os três
-- números (Home, card e aba) contam a mesma coisa.
create or replace function oportunidades_dm()
returns table (
  instagram_user_id text, username text, origem text,
  ultima_interacao timestamptz, ultimo_texto text, ultimo_conteudo text,
  comment_id uuid, follow_status text, last_private_reply_at timestamptz
)
language sql stable as $$
  with cfg as (select cooldown_days_per_user from automation_settings limit 1),
  eventos as (
    select c.instagram_user_id, c.username, 'COMMENT'::text origem,
           c.commented_at quando, c.text, m.caption conteudo, c.id comment_id
    from instagram_comments c
    left join instagram_media m on m.id = c.media_id
    where c.eligibility_status = 'ELIGIBLE' and c.eligibility_expires_at > now()
      and c.deleted_at is null and c.is_from_account = false and c.instagram_user_id is not null
    union all
    select mt.instagram_user_id, mt.username, 'MENTION', mt.mentioned_at, mt.text, null, null
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
    and not exists (
      select 1 from comment_actions ca
      where ca.instagram_user_id = p.instagram_user_id
        and ca.action_type = 'PRIVATE_REPLY'
        and ca.status in ('PENDING_APPROVAL', 'APPROVED', 'QUEUED', 'SENDING')
    )
  order by p.quando desc;
$$;

-- Coluna nova no retorno exige drop: replace não muda o tipo da linha.
drop function if exists oportunidades_resumo();
create or replace function oportunidades_resumo()
returns table (
  comentarios_elegiveis bigint, mencoes_elegiveis bigint,
  pessoas_brutas bigint, pessoas_elegiveis bigint,
  removidas_duplicidade bigint, removidas_ja_segue bigint,
  removidas_dm_recente bigint, removidas_blacklist bigint,
  removidas_ja_na_fila bigint
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
  pessoas as (select uid, count(*) eventos from eventos group by 1),
  julgadas as (
    select p.uid, p.eventos,
           coalesce(u.is_blacklisted, false) bl,
           coalesce(u.follow_status, 'UNKNOWN') = 'FOLLOWS' segue,
           (u.last_private_reply_at is not null
            and u.last_private_reply_at >= now() - ((select cooldown_days_per_user from cfg) || ' days')::interval) recente,
           exists (select 1 from comment_actions ca
                    where ca.instagram_user_id = p.uid and ca.action_type = 'PRIVATE_REPLY'
                      and ca.status in ('PENDING_APPROVAL','APPROVED','QUEUED','SENDING')) na_fila
    from pessoas p
    left join instagram_users u on u.instagram_user_id = p.uid
  )
  select
    (select count(*) from eventos where k = 'C'),
    (select count(*) from eventos where k = 'M'),
    (select count(*) from julgadas),
    (select count(*) from julgadas where not bl and not segue and not recente and not na_fila),
    (select coalesce(sum(eventos - 1), 0) from julgadas),
    (select count(*) from julgadas where segue),
    (select count(*) from julgadas where recente and not segue),
    (select count(*) from julgadas where bl),
    (select count(*) from julgadas where na_fila and not recente and not segue and not bl);
$$;

grant execute on function listar_elegiveis_limpos(int) to authenticated, service_role;

grant execute on function oportunidades_resumo() to authenticated, service_role;
grant execute on function oportunidades_dm() to authenticated, service_role;
