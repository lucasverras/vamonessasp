-- =============================================================================
-- REJECTED como estado explícito.
--
-- Antes, rejeitar caía em SKIPPED junto com "expirou" e "cooldown" — três coisas
-- diferentes no mesmo balde. Separar permite medir quanto a IA erra, que é o
-- dado que decide quando a automação pode ser liberada.
-- =============================================================================

alter table comment_actions drop constraint comment_actions_status_check;
alter table comment_actions add constraint comment_actions_status_check
  check (status in ('SHADOW','PENDING_APPROVAL','APPROVED','REJECTED','QUEUED',
                    'SENDING','SENT','FAILED','SKIPPED','EXPIRED'));

-- Taxa de acerto por intenção: aprovadas SEM edição sobre o total decidido.
-- É a métrica que autoriza a automação — "a IA acertou" significa que ninguém
-- precisou reescrever, não apenas que foi aprovada.
create or replace function acerto_por_intencao()
returns table (intent text, aprovadas_sem_edicao bigint, total_decidido bigint)
language sql stable as $$
  select an.intent,
         count(*) filter (where a.status in ('QUEUED','SENT') and a.edited_by is null),
         count(*) filter (where a.status in ('QUEUED','SENT','REJECTED'))
  from comment_actions a
  join comment_analyses an on an.id = a.analysis_id
  where an.intent is not null
  group by 1;
$$;

grant execute on function acerto_por_intencao() to authenticated, service_role;
