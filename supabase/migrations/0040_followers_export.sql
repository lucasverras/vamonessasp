-- REGRA (Lucas, 20/08/2026): COMENTOU → BATE COM A LISTA DOS 30K → NÃO ESTÁ →
-- NÃO RECEBEU NOS ÚLTIMOS 60 DIAS → ELEGÍVEL. Para isso a lista da exportação
-- oficial precisa ficar GUARDADA, e cada pessoa nova que comenta/menciona é
-- cruzada na hora (e a cada 5 min, por garantia). Antes a lista era usada só
-- no momento da importação — quem chegava depois ficava UNKNOWN para sempre.
create table if not exists followers_export (
  username text primary key,
  imported_at timestamptz not null default now(),
  imported_by text
);
alter table followers_export enable row level security;

-- Cruza quem ainda não tem prova (UNKNOWN/sem status) com a lista. Marcação
-- manual nunca é tocada. Lista mais velha que max_idade_dias NÃO classifica:
-- foto envelhecida vira palpite, e palpite não manda DM.
create or replace function classificar_follow_por_export(max_idade_dias int default 14)
returns table (seguidores int, nao_seguidores int, lista_de date)
language plpgsql as $$
declare
  dt timestamptz;
  n_seg int := 0;
  n_nao int := 0;
begin
  select max(imported_at) into dt from followers_export;
  if dt is null or dt < now() - (max_idade_dias || ' days')::interval then
    return query select 0, 0, dt::date;
    return;
  end if;

  with alvo as (
    select u.instagram_user_id, lower(u.username) uname
    from instagram_users u
    where u.username is not null
      and coalesce(u.follow_status, 'UNKNOWN') = 'UNKNOWN'
      and coalesce(u.follow_status_source, '') not like 'manual%'
  ),
  upd as (
    update instagram_users u
       set follow_status = case when fe.username is not null then 'FOLLOWS' else 'NOT_FOLLOWING' end,
           follow_status_checked_at = now(),
           follow_status_source = 'export:' || to_char(dt, 'YYYY-MM-DD') || ':auto'
      from alvo a
      left join followers_export fe on fe.username = a.uname
     where u.instagram_user_id = a.instagram_user_id
    returning (fe.username is not null) segue
  )
  select count(*) filter (where segue), count(*) filter (where not segue)
    into n_seg, n_nao from upd;

  -- Quem virou FOLLOWS com DM pendente: pula na hora (regra absoluta).
  update comment_actions ca
     set status = 'SKIPPED', skip_reason = 'SKIPPED_ALREADY_FOLLOWING', updated_at = now()
    from instagram_users u
   where u.instagram_user_id = ca.instagram_user_id
     and u.follow_status = 'FOLLOWS'
     and ca.action_type = 'PRIVATE_REPLY'
     and ca.status in ('PENDING_APPROVAL', 'QUEUED');

  return query select n_seg, n_nao, dt::date;
end $$;
grant execute on function classificar_follow_por_export(int) to service_role;

-- Garantia: a cada 5 minutos, independentemente do webhook.
select cron.unschedule('vn_classificar_follow') where exists (select 1 from cron.job where jobname = 'vn_classificar_follow');
select cron.schedule('vn_classificar_follow', '*/5 * * * *', $$select classificar_follow_por_export()$$);
