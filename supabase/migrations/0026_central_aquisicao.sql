-- Central de Aquisição: QUALIFICADOS / ENVIADOS / NEGADOS com motivos
-- padronizados no enum da spec. Nada é apagado — negado é histórico com nome.

-- Tradutor único de motivo (os registros antigos têm nomes da evolução do
-- sistema; a interface fala SEMPRE o enum padronizado).
create or replace function motivo_padrao(bruto text)
returns text language sql immutable as $$
  select case
    when bruto is null then 'ERROR'
    when bruto like 'SKIPPED_ALREADY_FOLLOWING%' or bruto like 'JA_SEGUE%' then 'ALREADY_FOLLOWING'
    when bruto like 'RECENT_PRIVATE_REPLY%' or bruto like 'DM_RECENTE%' or bruto like 'SKIPPED_RECENT_DM%'
         or bruto like 'COOLDOWN%' then 'RECENT_PRIVATE_REPLY'
    when bruto like 'DUPLICATE_USER%' or bruto like 'SKIPPED_DUPLICATE%' or bruto like 'JA_NA_FILA%'
         or bruto like 'JA_RECEBEU%' or bruto like 'OUTRO_COMENTARIO%' then 'DUPLICATE_USER'
    when bruto like 'FORA_DA_JANELA%' or bruto like 'META_NOT_ELIGIBLE%' or bruto like 'COMENTARIO_APAGADO%' then 'META_NOT_ELIGIBLE'
    when bruto like 'FOLLOW_STATUS_UNKNOWN%' then 'FOLLOW_STATUS_UNKNOWN'
    when bruto like 'SENSITIVE%' then 'SENSITIVE_INTERACTION'
    when bruto like 'PESSOA_NA_BLACKLIST%' or bruto like 'BLOCKED%' then 'BLOCKED_USER'
    when bruto like 'COMENTARIO_PROPRIO%' or bruto like 'OUR_OWN%' then 'OUR_OWN_ACCOUNT'
    when bruto like 'EXPIRED%' then 'EXPIRED'
    when bruto like 'SEM_IGSID%' or bruto like 'INVALID_IDENTITY%' then 'INVALID_IDENTITY'
    when bruto like 'PAUSADO_NA_AUDITORIA%' then 'RECENT_PRIVATE_REPLY'
    else 'ERROR'
  end;
$$;

create index if not exists comment_actions_skip_idx
  on comment_actions (action_type, status) where status in ('SKIPPED','EXPIRED','FAILED');

-- KPIs do topo, uma chamada.
create or replace function central_aquisicao_kpis()
returns table (
  interacoes bigint, pessoas_unicas bigint, qualificados bigint,
  enviados bigint, negados bigint, aguardando bigint
)
language sql stable as $$
  select
    (select count(*) from instagram_comments where is_from_account=false and deleted_at is null)
      + (select count(*) from instagram_mentions),
    (select count(distinct instagram_user_id) from instagram_comments
      where is_from_account=false and instagram_user_id is not null),
    (select count(*) from oportunidades_dm()),
    (select count(distinct instagram_user_id) from comment_actions
      where action_type='PRIVATE_REPLY' and status='SENT'),
    (select count(distinct instagram_user_id) from comment_actions
      where action_type='PRIVATE_REPLY' and status in ('SKIPPED','EXPIRED','FAILED')
        and instagram_user_id not in (
          select instagram_user_id from comment_actions
          where action_type='PRIVATE_REPLY' and status='SENT' and instagram_user_id is not null)),
    (select count(*) from comment_actions
      where action_type='PRIVATE_REPLY' and status in ('QUEUED','SENDING','PENDING_APPROVAL'));
$$;

-- NEGADOS: uma linha por pessoa (motivo mais recente), com o quadro por motivo.
create or replace function listar_negados(limite int default 100)
returns table (
  username text, instagram_user_id text, origem text, quando timestamptz,
  motivo text, ultima_dm timestamptz, follow_status text, follow_source text
)
language sql stable as $$
  select distinct on (ca.instagram_user_id)
    u.username, ca.instagram_user_id,
    case when ca.campaign_id is not null then 'CAMPANHA' else 'COMENTÁRIO' end,
    ca.updated_at, motivo_padrao(ca.skip_reason),
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
    select distinct on (ca.instagram_user_id) motivo_padrao(ca.skip_reason) m
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

-- ENVIADOS: uma linha por pessoa, com o essencial da Parte 27.
create or replace function listar_enviados(limite int default 100)
returns table (
  username text, instagram_user_id text, enviada_em timestamptz, origem text,
  interacao text, template text, meta_status text, ultima_dm timestamptz
)
language sql stable as $$
  select distinct on (ca.instagram_user_id)
    u.username, ca.instagram_user_id, ca.sent_at,
    case when ca.campaign_id is not null then 'CAMPANHA' else 'COMENTÁRIO' end,
    c.text, left(ca.final_text, 80),
    case when ca.external_id is not null then 'ENTREGUE' else 'ENVIADA' end,
    u.last_private_reply_at
  from comment_actions ca
  left join instagram_users u on u.instagram_user_id = ca.instagram_user_id
  left join instagram_comments c on c.id = ca.comment_id
  where ca.action_type='PRIVATE_REPLY' and ca.status='SENT'
    and ca.instagram_user_id is not null
  order by ca.instagram_user_id, ca.sent_at desc
  limit limite;
$$;

grant execute on function motivo_padrao(text) to authenticated, service_role;
grant execute on function central_aquisicao_kpis() to authenticated, service_role;
grant execute on function listar_negados(int) to authenticated, service_role;
grant execute on function negados_por_motivo() to authenticated, service_role;
grant execute on function listar_enviados(int) to authenticated, service_role;
