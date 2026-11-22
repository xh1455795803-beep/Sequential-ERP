-- Wave C · T6 + T7：pg_cron 维护任务（幂等：同名 job 先 unschedule 再 schedule）
DO $do$
BEGIN
  -- T6：锁残留清理。EF 正常路径在 finally 里 release；被强杀时行会留到 expires_at，这里兜底删。
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thalvior-shop-lock-cleanup') THEN
    PERFORM cron.unschedule('thalvior-shop-lock-cleanup');
  END IF;
  PERFORM cron.schedule('thalvior-shop-lock-cleanup', '*/10 * * * *',
    $cmd$DELETE FROM public.shop_sync_locks WHERE expires_at < now()$cmd$);

  -- T7a：同步流水保留 60 天（每店每 15 分钟一行，一年就是 ~35k 行/店，必须滚）
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thalvior-sync-run-logs-purge') THEN
    PERFORM cron.unschedule('thalvior-sync-run-logs-purge');
  END IF;
  PERFORM cron.schedule('thalvior-sync-run-logs-purge', '30 4 * * *',
    $cmd$DELETE FROM public.sync_run_logs WHERE started_at < now() - interval '60 days'$cmd$);

  -- T7b：适配器健康快照保留 30 天（1 分钟一跳，量比 sync_run_logs 更大）
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'thalvior-adapter-health-purge') THEN
    PERFORM cron.unschedule('thalvior-adapter-health-purge');
  END IF;
  PERFORM cron.schedule('thalvior-adapter-health-purge', '40 4 * * *',
    $cmd$DELETE FROM public.adapter_health_snapshots WHERE ts < now() - interval '30 days'$cmd$);
END
$do$;
