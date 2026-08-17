-- =============================================================================
-- Contadores por pessoa e índices de operação dos comentários.
--
-- Os contadores são RECALCULADOS da fonte, não incrementados: incremento erra
-- quando o mesmo lote de webhook é reprocessado, e a Meta reentrega eventos.
-- =============================================================================

create or replace function recalcular_contadores_pessoas(ids text[])
returns void language sql as $$
  update instagram_users u set
    comments_count = coalesce(c.total, 0),
    private_replies_count = coalesce(a.enviadas, 0),
    last_private_reply_at = a.ultima,
    last_intent = c.ultimo_intent,
    updated_at = now()
  from (select unnest(ids) as igsid) alvo
  left join (
    select ic.instagram_user_id as igsid, count(*) as total,
           (array_agg(an.intent order by an.created_at desc nulls last))[1] as ultimo_intent
    from instagram_comments ic
    left join comment_analyses an on an.comment_id = ic.id
    where ic.deleted_at is null
    group by 1
  ) c on c.igsid = alvo.igsid
  left join (
    select ic.instagram_user_id as igsid, count(*) as enviadas, max(ca.sent_at) as ultima
    from comment_actions ca
    join instagram_comments ic on ic.id = ca.comment_id
    where ca.action_type = 'PRIVATE_REPLY' and ca.status = 'SENT'
    group by 1
  ) a on a.igsid = alvo.igsid
  where u.instagram_user_id = alvo.igsid;
$$;

grant execute on function recalcular_contadores_pessoas(text[]) to service_role;

-- Consulta operacional da tela Comentários: "quem ainda pode receber mensagem".
create index if not exists instagram_comments_operacional_idx
  on instagram_comments (eligibility_status, commented_at desc)
  where deleted_at is null and is_from_account = false;
