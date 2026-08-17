-- Contadores das campanhas, recalculados da fonte.
-- Incrementar durante o envio erra quando um lote é reprocessado; contar a
-- verdade a partir de comment_actions nunca erra.
create or replace function atualizar_contadores_campanhas()
returns void language sql as $$
  update dm_campaigns c set
    sent_count    = coalesce(x.enviados, 0),
    failed_count  = coalesce(x.falhas, 0),
    skipped_count = coalesce(x.ignorados, 0),
    status = case
      when c.status = 'PAUSED' then 'PAUSED'
      when coalesce(x.pendentes, 0) = 0 and c.total_recipients > 0 then 'COMPLETED'
      when coalesce(x.enviados, 0) > 0 then 'RUNNING'
      else c.status
    end,
    completed_at = case
      when coalesce(x.pendentes, 0) = 0 and c.total_recipients > 0 and c.completed_at is null
      then now() else c.completed_at end
  from (
    select campaign_id,
      count(*) filter (where status = 'SENT')                          as enviados,
      count(*) filter (where status = 'FAILED')                        as falhas,
      count(*) filter (where status in ('SKIPPED','EXPIRED','SHADOW')) as ignorados,
      count(*) filter (where status in ('QUEUED','SENDING'))           as pendentes
    from comment_actions
    where campaign_id is not null and action_type = 'PRIVATE_REPLY'
    group by 1
  ) x
  where x.campaign_id = c.id;
$$;

grant execute on function atualizar_contadores_campanhas() to service_role;
