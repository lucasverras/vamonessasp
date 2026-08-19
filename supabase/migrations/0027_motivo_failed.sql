-- FAILED sem skip_reason = a Meta recusou o envio (conversa arquivada,
-- permissão). Na Central isso é META_NOT_ELIGIBLE, nunca "ERROR" genérico.
create or replace function motivo_de_acao(skip text, st text)
returns text language sql immutable as $$
  select case
    when skip is not null then motivo_padrao(skip)
    when st = 'FAILED' then 'META_NOT_ELIGIBLE'
    when st = 'EXPIRED' then 'EXPIRED'
    else 'ERROR'
  end;
$$;

create or replace function listar_negados(limite int default 100)
returns table (
  username text, instagram_user_id text, origem text, quando timestamptz,
  motivo text, ultima_dm timestamptz, follow_status text, follow_source text
)
language sql stable as $$
  select distinct on (ca.instagram_user_id)
    u.username, ca.instagram_user_id,
    case when ca.campaign_id is not null then 'CAMPANHA' else 'COMENTÁRIO' end,
    ca.updated_at, motivo_de_acao(ca.skip_reason, ca.status),
    u.last_private_reply_at, u.follow_status, u.follow_status_source
  from comment_actions ca
  left join instagram_users u on u.instagram_user_id = ca.instagram_user_id
  where ca.action_type='PRIVATE_REPLY' and ca.status in ('SKIPPED','EXPIRED','FAILED')
    and ca.instagram_user_id is not null
    and ca.instagram_user_id not in (
      select instagram_user_id from comment_actions
      where action_type='PRIVATE_REPLY' and status='SENT' and instagram_user_id is not null)
  order by ca.instagram_user_id, ca.updated_at desc
  limit limite;
$$;

create or replace function negados_por_motivo()
returns table (motivo text, total bigint)
language sql stable as $$
  with ultima as (
    select distinct on (ca.instagram_user_id) motivo_de_acao(ca.skip_reason, ca.status) m
    from comment_actions ca
    where ca.action_type='PRIVATE_REPLY' and ca.status in ('SKIPPED','EXPIRED','FAILED')
      and ca.instagram_user_id is not null
      and ca.instagram_user_id not in (
        select instagram_user_id from comment_actions
        where action_type='PRIVATE_REPLY' and status='SENT' and instagram_user_id is not null)
    order by ca.instagram_user_id, ca.updated_at desc
  )
  select m, count(*) from ultima group by 1 order by 2 desc;
$$;

grant execute on function motivo_de_acao(text, text) to authenticated, service_role;
