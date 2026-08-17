-- =============================================================================
-- Agendamento via pg_cron + pg_net.
--
-- Por que aqui e não no Vercel Cron: o plano Hobby executa cron uma vez por dia,
-- o que inviabiliza o snapshot horário — que é justamente o que permite medir
-- "+1h/+3h/+24h após a publicação". O pg_cron dá granularidade de minuto sem
-- custo adicional.
--
-- O segredo NÃO fica no corpo da migration: é lido de uma tabela de
-- configuração, para não ser versionado nem aparecer em pg_cron.job.
-- =============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists cron_config (
  id          boolean primary key default true check (id),
  base_url    text not null,
  cron_secret text not null,
  updated_at  timestamptz not null default now()
);

alter table cron_config enable row level security;  -- nenhuma policy: só service role

create or replace function dispara_job(job text) returns bigint
  language plpgsql security definer set search_path = public as $$
declare cfg cron_config; req_id bigint;
begin
  select * into cfg from cron_config where id;
  if not found then
    raise exception 'cron_config vazia: configure base_url e cron_secret antes de agendar';
  end if;

  select net.http_post(
    url     := cfg.base_url || '/api/cron/' || job,
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',cfg.cron_secret),
    body    := '{}'::jsonb,
    timeout_milliseconds := 280000
  ) into req_id;

  return req_id;
end $$;

-- Remove agendamentos anteriores para a migration ser reexecutável.
do $$
declare j record;
begin
  for j in select jobname from cron.job where jobname like 'vn_%' loop
    perform cron.unschedule(j.jobname);
  end loop;
end $$;

select cron.schedule('vn_snapshot_account',      '0 * * * *',  $$select dispara_job('snapshot-account')$$);
select cron.schedule('vn_sync_media',            '20 * * * *', $$select dispara_job('sync-media')$$);
select cron.schedule('vn_sync_insights_recent',  '40 * * * *', $$select dispara_job('sync-insights-recent')$$);
select cron.schedule('vn_sync_insights_full',    '30 4 * * *', $$select dispara_job('sync-insights-full')$$);
select cron.schedule('vn_backfill_daily',        '10 5 * * *', $$select dispara_job('backfill-daily')$$);
