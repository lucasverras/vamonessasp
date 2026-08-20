-- Lucas (20/08): "não preciso reexportar a lista, a margem é pequena".
-- A foto da exportação vale sem prazo — remove a trava de 14 dias.
create or replace function classificar_follow_por_export(max_idade_dias int default null)
returns table (seguidores int, nao_seguidores int, lista_de date)
language plpgsql as $$
declare
  dt timestamptz;
  n_seg int := 0;
  n_nao int := 0;
begin
  select max(imported_at) into dt from followers_export;
  if dt is null then
    return query select 0, 0, null::date;
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

  update comment_actions ca
     set status = 'SKIPPED', skip_reason = 'SKIPPED_ALREADY_FOLLOWING', updated_at = now()
    from instagram_users u
   where u.instagram_user_id = ca.instagram_user_id
     and u.follow_status = 'FOLLOWS'
     and ca.action_type = 'PRIVATE_REPLY'
     and ca.status in ('PENDING_APPROVAL', 'QUEUED');

  return query select n_seg, n_nao, dt::date;
end $$;
