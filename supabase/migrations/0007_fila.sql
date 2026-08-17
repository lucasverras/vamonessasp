-- =============================================================================
-- Fila de envio no Postgres. Sem Redis: nesta escala o banco basta, e um
-- serviço a menos é um modo de falha a menos.
-- =============================================================================

-- Claim atômico. FOR UPDATE SKIP LOCKED permite vários workers em paralelo sem
-- que dois peguem o mesmo destinatário — e sem que um worker lento bloqueie os
-- outros, que é o que aconteceria com FOR UPDATE puro.
create or replace function reservar_envios(
  lote int,
  worker text,
  lock_segundos int default 120
)
returns setof comment_actions
language plpgsql as $$
begin
  return query
  update comment_actions ca set
    status = 'SENDING',
    locked_until = now() + make_interval(secs => lock_segundos),
    locked_by = worker,
    attempts = ca.attempts + 1,
    updated_at = now()
  where ca.id in (
    select c.id from comment_actions c
    where c.status = 'QUEUED'
      and c.next_attempt_at <= now()
      and (c.locked_until is null or c.locked_until < now())
    order by c.created_at
    for update skip locked
    limit lote
  )
  returning ca.*;
end $$;

-- Devolve à fila o que ficou preso: um worker que morreu no meio deixa o
-- registro em SENDING para sempre sem isto. O envio duplicado continua
-- impossível pela unique parcial em (comment_id, action_type) where status='SENT'.
create or replace function destravar_envios()
returns int language plpgsql as $$
declare n int;
begin
  update comment_actions set
    status = 'QUEUED',
    locked_until = null,
    locked_by = null,
    updated_at = now()
  where status = 'SENDING' and locked_until < now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Orçamento da hora: o limite oficial da Meta é 750 private replies/hora.
-- Trabalhamos com teto configurável (600) e descontamos o que já saiu.
create or replace function orcamento_envio_restante()
returns int language sql stable as $$
  select greatest(
    0,
    (select dm_hourly_cap from automation_settings where id) -
    (select count(*)::int from comment_actions
      where action_type = 'PRIVATE_REPLY' and status = 'SENT'
        and sent_at > now() - interval '1 hour')
  );
$$;

grant execute on function reservar_envios(int, text, int) to service_role;
grant execute on function destravar_envios() to service_role;
grant execute on function orcamento_envio_restante() to authenticated, service_role;
