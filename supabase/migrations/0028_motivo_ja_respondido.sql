-- Paridade TS↔SQL: JA_RESPONDIDO (comentário que já tem private reply) é
-- DUPLICATE_USER no enum — o teste automatizado pegou a divergência.
create or replace function motivo_padrao(bruto text)
returns text language sql immutable as $$
  select case
    when bruto is null then 'ERROR'
    when bruto like 'SKIPPED_ALREADY_FOLLOWING%' or bruto like 'JA_SEGUE%' then 'ALREADY_FOLLOWING'
    when bruto like 'RECENT_PRIVATE_REPLY%' or bruto like 'DM_RECENTE%' or bruto like 'SKIPPED_RECENT_DM%'
         or bruto like 'COOLDOWN%' then 'RECENT_PRIVATE_REPLY'
    when bruto like 'DUPLICATE_USER%' or bruto like 'SKIPPED_DUPLICATE%' or bruto like 'JA_NA_FILA%'
         or bruto like 'JA_RECEBEU%' or bruto like 'JA_RESPONDIDO%' or bruto like 'OUTRO_COMENTARIO%' then 'DUPLICATE_USER'
    when bruto like 'FORA_DA_JANELA%' or bruto like 'META_NOT_ELIGIBLE%' or bruto like 'COMENTARIO_APAGADO%' then 'META_NOT_ELIGIBLE'
    when bruto like 'FOLLOW_STATUS_UNKNOWN%' then 'FOLLOW_STATUS_UNKNOWN'
    when bruto like 'SENSITIVE%' then 'SENSITIVE_INTERACTION'
    when bruto like 'PESSOA_NA_BLACKLIST%' or bruto like 'BLOCKED%' then 'BLOCKED_USER'
    when bruto like 'COMENTARIO_PROPRIO%' or bruto like 'OUR_OWN%' then 'OUR_OWN_ACCOUNT'
    when bruto like 'EXPIRED%' then 'EXPIRED'
    when bruto like 'SEM_IGSID%' or bruto like 'INVALID_IDENTITY%' then 'INVALID_IDENTITY'
    when bruto like 'PAUSADO_NA_AUDITORIA%' then 'RECENT_PRIVATE_REPLY'
    else 'ERROR'
  end;
$$;
