create or replace function contar_comentarios_por_status()
returns table (status text, total bigint)
language sql stable as $$
  select eligibility_status, count(*)
  from instagram_comments
  where deleted_at is null and is_from_account = false
  group by 1;
$$;

-- Pessoas ÚNICAS que ainda podem receber, e quando a janela mais curta fecha.
-- Contar comentários superestimaria a oportunidade: uma pessoa que comentou
-- três vezes recebe UMA mensagem, não três.
create or replace function resumo_oportunidade()
returns table (pessoas bigint, comentarios bigint, expira_em timestamptz)
language sql stable as $$
  select count(distinct instagram_user_id), count(*), min(eligibility_expires_at)
  from instagram_comments
  where eligibility_status = 'ELIGIBLE'
    and deleted_at is null
    and is_from_account = false
    and instagram_user_id is not null
    and eligibility_expires_at > now();
$$;

grant execute on function contar_comentarios_por_status() to authenticated, service_role;
grant execute on function resumo_oportunidade() to authenticated, service_role;
