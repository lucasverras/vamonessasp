-- Sync do Facebook de hora em hora, no minuto 50 — fora dos minutos dos syncs
-- do Instagram (0, 20, 40) para não competir pelo rate limit da mesma app.
select cron.schedule('vn_sync_facebook', '50 * * * *', $$select dispara_job('sync-facebook')$$);
