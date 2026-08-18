-- Modo APPROVAL_REQUIRED: a IA faz todo o trabalho, o envio espera um clique.
alter table automation_settings drop constraint if exists automation_settings_reply_mode_check;
alter table automation_settings add constraint automation_settings_reply_mode_check
  check (reply_mode in ('OFF', 'DRY_RUN', 'APPROVAL_REQUIRED', 'LIVE'));

-- Aprovação humana antes do next_attempt_at é intervenção explícita — fica
-- registrada, não inferida.
alter table comment_actions
  add column if not exists manual_approval_override boolean not null default false;

-- Métricas da fase de aprovação: o que decide quando o LIVE merece confiança.
create or replace function aprovacao_metricas()
returns table (
  pending_approval bigint,
  approved_today bigint,
  edited_today bigint,
  discarded_today bigint,
  hold bigint,
  sent_today bigint,
  failed_today bigint
)
language sql stable as $$
  select
    (select count(*) from comment_actions where status = 'PENDING_APPROVAL'),
    (select count(*) from comment_actions
      where approved_at >= date_trunc('day', now()) and approved_by is not null),
    (select count(*) from comment_actions
      where approved_at >= date_trunc('day', now()) and edited_by is not null),
    (select count(*) from comment_actions
      where status = 'REJECTED' and updated_at >= date_trunc('day', now())),
    (select count(*) from comment_analyses a
      where a.decision = 'HOLD_FOR_REVIEW'
        and not exists (select 1 from comment_actions ca
                         where ca.analysis_id = a.id and ca.status in ('SENT','REJECTED'))),
    (select count(*) from comment_actions where sent_at >= date_trunc('day', now())),
    (select count(*) from comment_actions
      where status = 'FAILED' and updated_at >= date_trunc('day', now()));
$$;

grant execute on function aprovacao_metricas() to authenticated, service_role;
