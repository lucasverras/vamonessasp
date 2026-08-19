-- KPIs da Central em UMA passada: reusa oportunidades_resumo (que já computa
-- eventos/pessoas/qualificados juntos) em vez de varrer as tabelas de novo.
create or replace function central_aquisicao_kpis()
returns table (
  interacoes bigint, pessoas_unicas bigint, qualificados bigint,
  enviados bigint, negados bigint, aguardando bigint
)
language sql stable as $$
  with r as (select * from oportunidades_resumo()),
  enviados_u as (
    select count(distinct instagram_user_id) n from comment_actions
    where action_type='PRIVATE_REPLY' and status='SENT' and instagram_user_id is not null
  )
  select
    (select count(*) from instagram_comments where is_from_account=false and deleted_at is null)
      + (select count(*) from instagram_mentions),
    (select count(distinct instagram_user_id) from instagram_comments
      where is_from_account=false and instagram_user_id is not null),
    (select pessoas_elegiveis from r),
    (select n from enviados_u),
    (select count(distinct ca.instagram_user_id) from comment_actions ca
      where ca.action_type='PRIVATE_REPLY' and ca.status in ('SKIPPED','EXPIRED','FAILED')
        and ca.instagram_user_id is not null
        and not exists (select 1 from comment_actions s
                         where s.instagram_user_id=ca.instagram_user_id
                           and s.action_type='PRIVATE_REPLY' and s.status='SENT')),
    (select count(*) from comment_actions
      where action_type='PRIVATE_REPLY' and status in ('QUEUED','SENDING','PENDING_APPROVAL'));
$$;
