-- zz_20261117_adm01_platform_ops_foundation.sql
-- Batch A · 平台运营后台基础设施（Batch B/C/D 的地基）
-- 4 张新表 + 严格 RLS + 快照聚合函数 + pg_cron 5 秒聚合
-- 全幂等：可重复执行（create if not exists / drop policy if exists / on conflict do nothing）
-- 只新增对象，不改任何既有表；platform_configs / platform_auth_config 60 行零改动
begin;

-- ─── a) platform_credentials：平台应用级密钥（AES-256-GCM 密文） ──────────────
create table if not exists public.platform_credentials (
  id             uuid primary key default gen_random_uuid(),
  platform_key   text not null unique,                 -- 对齐 platform_configs.name
  app_key        text,                                 -- 明文（可给 admin UI 看）
  app_secret_enc text,                                 -- 'v1:<b64iv>:<b64ct>' AES-256-GCM，绝不下发明文
  redirect_uri   text,
  extra          jsonb not null default '{}'::jsonb,   -- 区域专属密钥：client_id_eu / client_id_us ...
  key_version    int  not null default 1,              -- 主密钥轮换计数
  updated_at     timestamptz,
  updated_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now()
);
comment on table public.platform_credentials is '平台应用密钥保险柜：app_secret 以 SECRET_MASTER_KEY 做 AES-256-GCM 封装，仅 EF 可解密';
comment on column public.platform_credentials.app_secret_enc is 'v1:<b64iv>:<b64ct>；前端永不解密，只回传 has_secret';

-- ─── c) sync_run_logs：每次 sync-orders 每店一行（先建，快照函数依赖它） ──────
create table if not exists public.sync_run_logs (
  id           bigserial primary key,
  started_at   timestamptz not null,
  finished_at  timestamptz,
  user_id      uuid references public.profiles(id) on delete set null,
  -- 实况说明：public.shops.id 是 text 且为空壳展示表（0 行），真实店铺真值表是 shop_auths
  -- （sync-orders/authorize-shop/settlement-sync 全部以 shop_auths 为店铺主键），
  -- 故 shop_id 外键指向 shop_auths(id)（uuid），否则日志行永远插入失败。
  shop_id      uuid references public.shop_auths(id) on delete set null,
  platform_key text not null,                          -- = shop_auths.platform = platform_configs.name
  status       text not null check (status in ('success','partial','failed','skipped','auth_required','no_credentials')),
  pulled       int,
  inserted     int,
  updated      int,
  unchanged    int,
  error_msg    text,
  error_code   text,
  duration_ms  int,
  created_at   timestamptz not null default now()
);
create index if not exists sync_run_logs_platform_started_idx on public.sync_run_logs (platform_key, started_at desc);
create index if not exists sync_run_logs_shop_started_idx     on public.sync_run_logs (shop_id, started_at desc);
comment on table public.sync_run_logs is '订单同步逐次流水：sync-orders EF 每店一次调用写一行（日志失败绝不影响同步）';

-- ─── b) adapter_health_snapshots：分钟级聚合（源自 sync_run_logs） ────────────
create table if not exists public.adapter_health_snapshots (
  id           bigserial primary key,
  ts           timestamptz not null,                    -- 分钟桶起点（date_trunc('minute', started_at)）
  platform_key text not null,
  calls        int not null default 0,
  ok           int not null default 0,
  fail         int not null default 0,
  skipped      int not null default 0,                  -- 无适配器 / 无凭据 / 主动跳过的次数
  avg_ms       int,
  p95_ms       int,
  errors       jsonb default '[]'::jsonb,               -- 该桶内 top-5 去重 error_msg 样本
  created_at   timestamptz not null default now()
);
-- 唯一约束（幂等 upsert 的冲突目标）+ spec 要求的 (platform_key, ts desc) 索引
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.adapter_health_snapshots'::regclass
                                  and conname = 'adapter_health_snapshots_platform_key_ts_key') then
    alter table public.adapter_health_snapshots
      add constraint adapter_health_snapshots_platform_key_ts_key unique (platform_key, ts);
  end if;
end $$;
create index if not exists adapter_health_snapshots_platform_ts_idx
  on public.adapter_health_snapshots (platform_key, ts desc);
comment on table public.adapter_health_snapshots is '适配器健康分钟快照：由 roll_adapter_health_snapshot() 聚合 sync_run_logs，pg_cron 每 5 秒滚动，也可由 sync-orders _action=log_health_snapshot 手动触发';

-- ─── d) admin_audit_log：后台所有写入动作留痕 ────────────────────────────────
create table if not exists public.admin_audit_log (
  id             bigserial primary key,
  ts             timestamptz not null default now(),
  actor_user_id  uuid references public.profiles(id),
  actor_email    text,                                  -- 反范式，便于速览
  action         text not null,                         -- platform.update / credential.rotate / shop.force_resync / adapter.toggle ...
  target_table   text,
  target_id      text,
  "before"       jsonb,                                 -- insert 时为 NULL
  "after"        jsonb,                                 -- 密钥类动作只写 {rotated:true}，绝不落明文/密文
  ip             text,                                  -- X-Forwarded-For
  created_at     timestamptz not null default now()
);
create index if not exists admin_audit_log_ts_idx        on public.admin_audit_log (ts desc);
create index if not exists admin_audit_log_actor_ts_idx  on public.admin_audit_log (actor_user_id, ts desc);
create index if not exists admin_audit_log_action_ts_idx on public.admin_audit_log (action, ts desc);
comment on table public.admin_audit_log is '运营后台写操作审计（前端直改表后调用 admin-api write_audit 补记）';

-- ─── 序列权限（authenticated 里的 admin 用户需要 nextval 才能 INSERT） ────────
grant usage, select on sequence public.sync_run_logs_id_seq, public.adapter_health_snapshots_id_seq, public.admin_audit_log_id_seq to authenticated, service_role;
grant select, insert, update on public.platform_credentials, public.sync_run_logs, public.adapter_health_snapshots, public.admin_audit_log to authenticated, service_role;
-- 明确收回 anon：RLS + 无授权 = anon 读取直接被拒（42501）
revoke all on public.platform_credentials, public.sync_run_logs, public.adapter_health_snapshots, public.admin_audit_log from anon;

-- ─── RLS：全部启用，只有 service_role 与 admin 可读写 ────────────────────────
alter table public.platform_credentials       enable row level security;
alter table public.adapter_health_snapshots   enable row level security;
alter table public.sync_run_logs              enable row level security;
alter table public.admin_audit_log            enable row level security;

-- 判定式（四表一致）：
--   (auth.jwt() ->> 'role') = 'service_role'  → EF/cron（本身也有 BYPASSRLS）
--   (auth.jwt() ->> 'role') = 'admin'         → JWT 直接带 admin role 的场景
--   public.has_role(auth.uid(),'admin')       → 现网真实口径：profiles.role='admin'（gotrue JWT 的 role 恒为 authenticated）
drop policy if exists platform_credentials_admin_select on public.platform_credentials;
create policy platform_credentials_admin_select on public.platform_credentials for select to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists platform_credentials_admin_insert on public.platform_credentials;
create policy platform_credentials_admin_insert on public.platform_credentials for insert to authenticated, service_role with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists platform_credentials_admin_update on public.platform_credentials;
create policy platform_credentials_admin_update on public.platform_credentials for update to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
) with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);

drop policy if exists sync_run_logs_admin_select on public.sync_run_logs;
create policy sync_run_logs_admin_select on public.sync_run_logs for select to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists sync_run_logs_admin_insert on public.sync_run_logs;
create policy sync_run_logs_admin_insert on public.sync_run_logs for insert to authenticated, service_role with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists sync_run_logs_admin_update on public.sync_run_logs;
create policy sync_run_logs_admin_update on public.sync_run_logs for update to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
) with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);

drop policy if exists adapter_health_snapshots_admin_select on public.adapter_health_snapshots;
create policy adapter_health_snapshots_admin_select on public.adapter_health_snapshots for select to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists adapter_health_snapshots_admin_insert on public.adapter_health_snapshots;
create policy adapter_health_snapshots_admin_insert on public.adapter_health_snapshots for insert to authenticated, service_role with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists adapter_health_snapshots_admin_update on public.adapter_health_snapshots;
create policy adapter_health_snapshots_admin_update on public.adapter_health_snapshots for update to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
) with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);

-- admin_audit_log：只允许追加（无 UPDATE 策略）；SELECT 限 admin/service_role，INSERT 额外允许 service_role
drop policy if exists admin_audit_log_admin_select on public.admin_audit_log;
create policy admin_audit_log_admin_select on public.admin_audit_log for select to authenticated, service_role using (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);
drop policy if exists admin_audit_log_insert on public.admin_audit_log;
create policy admin_audit_log_insert on public.admin_audit_log for insert to authenticated, service_role with check (
  (auth.jwt() ->> 'role') = 'service_role' or (auth.jwt() ->> 'role') = 'admin' or public.has_role(auth.uid(), 'admin')
);

-- ─── 快照聚合函数（cron 与 EF 共用一份口径，避免两处 SQL 漂移） ───────────────
-- Supabase 对 public schema 新建函数默认给 PUBLIC EXECUTE（acl 里的 "=X/postgres"），
-- 这里显式收紧到 authenticated/service_role，并在函数内再加一道调用者闸门。
-- 坑：本函数是 security definer，函数内 current_user 恒等于 owner(postgres)，无法判别调用者
-- （自检实证：sess=postgres cur=postgres）。判别调用者只能用
--   session_user —— 直连/cron（pg_cron 以 job.username 建连，本 job = postgres）
--   request.jwt.claims —— PostgREST 路径（apikey/Authorization 铸出的 JWT）
create or replace function public.roll_adapter_health_snapshot(window_seconds integer default 300)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer;
  claims jsonb;
  caller_sub uuid;
begin
  claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if claims is null then
    if session_user not in ('postgres', 'supabase_admin', 'service_role') then
      raise exception 'roll_adapter_health_snapshot 仅限 service_role / admin 调用';
    end if;
  else
    caller_sub := case
      when claims ->> 'sub' ~* '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then (claims ->> 'sub')::uuid
      else null end;
    if not ((claims ->> 'role') = 'service_role' or public.has_role(caller_sub, 'admin')) then
      raise exception 'roll_adapter_health_snapshot 仅限 service_role / admin 调用';
    end if;
  end if;

  with bounded as (
    select greatest(coalesce(window_seconds, 300), 60) as secs
  ), bucketed as (
    select date_trunc('minute', l.started_at) as bkt,
           l.platform_key,
           count(*)::int                                     as calls,
           count(*) filter (where l.status = 'success')::int as ok,
           count(*) filter (where l.status in ('failed','partial','auth_required','no_credentials'))::int as fail,
           count(*) filter (where l.status = 'skipped')::int as skipped,
           round(avg(nullif(l.duration_ms, 0)))::int          as avg_ms,
           percentile_cont(0.95) within group (order by l.duration_ms)::int as p95_ms
    from sync_run_logs l, bounded b
    where l.started_at >= date_trunc('minute', now()) - make_interval(secs => b.secs)
      and l.started_at <  date_trunc('minute', now())     -- 只结算「已完整结束」的分钟桶
    group by 1, 2
  ), agg as (
    select bk.bkt, bk.platform_key, bk.calls, bk.ok, bk.fail, bk.skipped, bk.avg_ms, bk.p95_ms,
           coalesce((
             select jsonb_agg(e.err) from (
               select jsonb_build_object('msg', left(l2.error_msg, 500), 'n', count(*)::int) as err
               from sync_run_logs l2
               where l2.platform_key = bk.platform_key
                 and date_trunc('minute', l2.started_at) = bk.bkt
                 and nullif(l2.error_msg, '') is not null
               group by l2.error_msg
               order by count(*) desc
               limit 5
             ) e
           ), '[]'::jsonb) as errors
    from bucketed bk
  ), upserted as (
    insert into adapter_health_snapshots (ts, platform_key, calls, ok, fail, skipped, avg_ms, p95_ms, errors)
    select a.bkt, a.platform_key, a.calls, a.ok, a.fail, a.skipped, a.avg_ms, a.p95_ms, a.errors from agg a
    on conflict (platform_key, ts) do update
      set calls = excluded.calls, ok = excluded.ok, fail = excluded.fail, skipped = excluded.skipped,
          avg_ms = excluded.avg_ms, p95_ms = excluded.p95_ms, errors = excluded.errors
    returning 1
  )
  select count(*)::int into n from upserted;
  return n;
end
$fn$;
comment on function public.roll_adapter_health_snapshot(integer) is '把最近 window_seconds 内已结束的分钟桶重算并幂等 upsert 进 adapter_health_snapshots，返回写入桶数；只允许 service_role/admin（或 cron 的 postgres 身份）调用';
revoke all on function public.roll_adapter_health_snapshot(integer) from public, anon;
grant execute on function public.roll_adapter_health_snapshot(integer) to authenticated, service_role;

-- ─── 种子：每个平台一行空凭据，让后台表单有落点（不动 platform_configs） ──────
insert into public.platform_credentials (platform_key, app_key, app_secret_enc, redirect_uri, extra, key_version)
select pc.name, null, null, null, '{}'::jsonb, 1
from public.platform_configs pc
on conflict (platform_key) do nothing;

commit;

-- ─── pg_cron 快照滚动（cron 不可用时整段跳过即可，EF 侧有 log_health_snapshot 兜底） ──
-- 实测本镜像 pg_cron 1.6.4 只认 5 段表达式：'*/5 * * * * *' 会被当成「每 5 分钟」执行
-- （job_run_details 显示 :40 / :45 / :50 三条，间隔 300s），秒级轮询并不生效；
-- 而快照本身就是「分钟桶」粒度，故按每分钟触发 —— 既无损粒度，又省掉 60 倍空转。
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron 不可用：跳过，改由 sync-orders _action=log_health_snapshot 手工滚动快照';
    return;
  end if;
  -- 清掉早期误用的秒级任务名（只影响本任务，不动其它 thalvior-* 任务）
  begin perform cron.unschedule('thalvior-adapter-health-5s'); exception when others then null; end;
  if exists (select 1 from cron.job where jobname = 'thalvior-adapter-health-1min') then
    raise notice 'pg_cron 任务 thalvior-adapter-health-1min 已存在，保持不变';
  else
    perform cron.schedule('thalvior-adapter-health-1min', '* * * * *',
      'SELECT public.roll_adapter_health_snapshot(300)');
    raise notice 'pg_cron 已注册 thalvior-adapter-health-1min（每分钟重算最近 300 秒的分钟桶）';
  end if;
end $$;

-- ─── 自检输出 ───────────────────────────────────────────────────────────────
select 'platform_credentials=' || count(*) from public.platform_credentials;
select 'sync_run_logs=' || count(*) from public.sync_run_logs;
select 'adapter_health_snapshots=' || count(*) from public.adapter_health_snapshots;
select 'admin_audit_log=' || count(*) from public.admin_audit_log;
select relname || ' relrowsecurity=' || relrowsecurity || ' relforcerowsecurity=' || relforcerowsecurity
from pg_class where relname in ('platform_credentials','adapter_health_snapshots','sync_run_logs','admin_audit_log') order by 1;
select tablename || ' :: ' || policyname || ' :: ' || cmd from pg_policies
where tablename in ('platform_credentials','adapter_health_snapshots','sync_run_logs','admin_audit_log') order by 1;
