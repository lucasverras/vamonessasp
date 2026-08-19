-- Painel de fila & envios + limpeza em um clique.
-- "Apagar" aqui NUNCA é delete: é marcar NOT_ELIGIBLE com motivo — some da
-- lista de trabalho, permanece no banco para auditoria.

-- Duplicados: mantém o comentário elegível MAIS RECENTE de cada pessoa,
-- marca os demais. Set-based: uma query, instantâneo.
create or replace function limpar_duplicados()
returns bigint
language sql as $$
  with mantidos as (
    select distinct on (instagram_user_id) id
    from instagram_comments
    where eligibility_status = 'ELIGIBLE' and instagram_user_id is not null
      and deleted_at is null and is_from_account = false
    order by instagram_user_id, commented_at desc
  ),
  marcados as (
    update instagram_comments c
       set eligibility_status = 'NOT_ELIGIBLE',
           not_eligible_reason = 'SKIPPED_DUPLICATE'
     where c.eligibility_status = 'ELIGIBLE'
       and c.instagram_user_id is not null
       and c.id not in (select id from mantidos)
    returning 1
  )
  select count(*) from marcados;
$$;

-- Já atendidos: pessoas com DM dentro da janela configurada, ou que
-- comprovadamente já seguem. Motivo separado para cada caso.
create or replace function limpar_ja_atendidos()
returns table (dm_recente bigint, ja_segue bigint)
language sql as $$
  with cfg as (select cooldown_days_per_user d from automation_settings limit 1),
  m1 as (
    update instagram_comments c
       set eligibility_status = 'NOT_ELIGIBLE', not_eligible_reason = 'DM_RECENTE'
      from instagram_users u, cfg
     where u.instagram_user_id = c.instagram_user_id
       and c.eligibility_status = 'ELIGIBLE'
       and u.last_private_reply_at >= now() - (cfg.d || ' days')::interval
    returning 1
  ),
  m2 as (
    update instagram_comments c
       set eligibility_status = 'NOT_ELIGIBLE', not_eligible_reason = 'JA_SEGUE'
      from instagram_users u
     where u.instagram_user_id = c.instagram_user_id
       and c.eligibility_status = 'ELIGIBLE'
       and u.follow_status = 'FOLLOWS'
    returning 1
  )
  select (select count(*) from m1), (select count(*) from m2);
$$;

-- O painel: fila, quem já foi, quem falta, hoje × ontem, e os seguidores da
-- conta no mesmo período (SEM atribuição individual — é crescimento da conta).
create or replace function painel_envios()
returns table (
  na_fila bigint,
  aguardando_aprovacao bigint,
  enviadas_hoje bigint,
  enviadas_ontem bigint,
  enviadas_total bigint,
  falhas_hoje bigint,
  pessoas_faltam bigint,
  seguidores_hoje int,
  seguidores_ontem int
)
language sql stable as $$
  select
    (select count(*) from comment_actions where status in ('QUEUED','SENDING')),
    (select count(*) from comment_actions where status = 'PENDING_APPROVAL'),
    (select count(*) from comment_actions where action_type='PRIVATE_REPLY'
      and status='SENT' and sent_at >= date_trunc('day', now())),
    (select count(*) from comment_actions where action_type='PRIVATE_REPLY'
      and status='SENT'
      and sent_at >= date_trunc('day', now()) - interval '1 day'
      and sent_at <  date_trunc('day', now())),
    (select count(*) from comment_actions where action_type='PRIVATE_REPLY' and status='SENT'),
    (select count(*) from comment_actions where status='FAILED'
      and updated_at >= date_trunc('day', now())),
    (select count(*) from oportunidades_dm()),
    (select new_followers from account_daily_insights order by date desc limit 1),
    (select new_followers from account_daily_insights order by date desc limit 1 offset 1);
$$;

grant execute on function limpar_duplicados() to service_role;
grant execute on function limpar_ja_atendidos() to service_role;
grant execute on function painel_envios() to authenticated, service_role;
