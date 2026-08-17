-- Agendamento da ingestão de comentários.
-- 15 min é folgado para reconciliação: o webhook cobre o tempo real, e este job
-- existe para o que ele perder — ou para enquanto o app não estiver Live.
select cron.schedule('vn_sync_comments',   '*/15 * * * *', $$select dispara_job('sync-comments')$$);
select cron.schedule('vn_expirar_elegib',  '5 * * * *',    $$select dispara_job('expirar-elegibilidade')$$);
