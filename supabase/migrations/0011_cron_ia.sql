-- Análise por IA a cada 5 minutos. Em shadow mode não há urgência, e o intervalo
-- mantém o custo previsível: 20 comentários por execução, no máximo.
select cron.schedule('vn_analisar_comentarios', '*/5 * * * *', $$select dispara_job('analisar-comentarios')$$);
