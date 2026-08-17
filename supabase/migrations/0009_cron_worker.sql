select cron.schedule('vn_dm_worker',      '* * * * *',    $$select dispara_job('dm-worker')$$);
select cron.schedule('vn_destravar_fila', '*/10 * * * *', $$select dispara_job('destravar-fila')$$);
