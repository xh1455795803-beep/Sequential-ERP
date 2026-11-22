-- =============================================================================
-- 2026-11-18b  假数据清理（生产）
--
-- 判定依据（全部为本次实测，不是推测）：
--   1) auth.users 共 21 个，其中 19 个是我方 QA/压测注册的账号（qa-*、throttle-probe-*、
--      nginx-burst、ipa、ipb），只有 6f9fc265(手机号 18668410717) 与 admin@thalvior.test 是真实账号；
--      现网没有任何付费客户注册过。
--   2) 另有一批 user_id 在 auth.users 里根本不存在（幽灵租户），是历史压测/夹具留下的：
--      subscriptions 47、tenant_quotas 49、notifications 44、payment_orders 8、quota_recharges 3、
--      benefit_grants 1、shop_licenses 1、translate_packs 1、settle_mail_outbox 2、
--      invoice_paid_sources 6、invoice_quota 4。
--   3) 业务演示数据：shipments 18（16×remark='DEMO-20261117' + 2×remark='门户演示数据'）、
--      orders 16×DEMO、billing_lines 33、statements/statement_lines/statement_disputes/
--      statement_import_batches(demo-bill.csv)、work_orders 7、label_files 12、parcels 6、
--      shipment_status_events 57、push_logs 22、automation_runs 18、notif.gen.* 通知。
--   4) WDTEST_* 支付夹具（含伪造的 wechat_trade_no 42000...）、wechat_bill_rows、
--      reconciliation_runs 那一次"对不平"的自检。
--   5) 货代侧假凭据：云途授权 app_key=PORTALDEMOAPP 且回调端点 fw-ref-receiver 已不存在（实测 500）；
--      慧航授权的 AppKey/AppSecret/回调密钥是我做链路验证时填的占位值；
--      logistics_channels YT-*、forwarder_warehouses YT-* 是 seed-net.sql 造的假渠道/假仓。
--   6) 广告模块的 name='1' 两条、AI 助手 11-14 冒烟对话 4 条。
--
-- 明确保留（真实数据 / 产品配置，不属于假数据）：
--   - 真实账号 2 个；真实店铺授权 shop_auths「手工制作」(Ozon, 2026-10-26 授权)
--   - 真实同步来的订单 OZON-5d2 及其 order_event；settlement_sync_logs 520、order_sync_logs 81、
--     sync_run_logs 33、adapter_health_snapshots 33、admin_audit_log 12、email_send_logs 9、throttle_log 2
--     （这些是系统真实运行记录，即便动作本身是测试触发的，日志内容没有伪造）
--   - 字典/配置：permissions/role_permissions/roles、forwarder_catalog 106、platform_configs 55、
--     platform_auth_config 55、platform_credentials 55（app_key/secret 全为空，未接入）、platform_field_map 96、
--     license_platforms 37、country_tax_rates 9、fba_fee_tiers 16、push_error_codes 25、email_templates 24、
--     fee_categories 5、subscription_plans 5、credit_packages 4、translate_pack_defs 3、license_periods 4、
--     license_shop_tiers 8、service_pricing 21、shipment_stage_transitions 10（阶段机定义，不是货件数据）、
--     cn_sensitive_words / cn_category_qualifications / cn_platform_rules
--   - freight_forwarders 2 行（云途物流、慧航货运是真实存在的公司，保留档案；只删假凭据）
--   - 慧航的 forwarder_auths 行保留（provider=huoxiaoyi 这条事实是真的），但把占位凭据清空
--   - *_bak_* 迁移备份表（country_tax_rates_bak_taxfix / platform_configs_bak_20261012 /
--     subscription_plans_bak_20261010 / _bak_field_map_20261117 / _bak_license_20261117）
--     ——它们是那几次迁移唯一的回滚依据，不是假数据，本次不动。
--
-- 恢复入口：/opt/supabase/backups/prepurge-2026-11-17T0730z.dump
--   pg_restore -U postgres -d <db> --no-owner --no-privileges < 该文件
-- 用法：先 -f - 跑一遍（末尾是 ROLLBACK），核对数字后再把最后的 ROLLBACK 换成 COMMIT。
-- =============================================================================
\set ON_ERROR_STOP on
begin;

-- 0) 圈定范围 --------------------------------------------------------------
create temp table qa_uid on commit drop as
  select id from public.profiles
  where username like 'qa-%' or username like 'throttle-probe%'
     or username in ('nginx-burst','ipa','ipb');
select 'qa_accounts='||count(*) from qa_uid;

create temp table demo_ship on commit drop as
  select id from public.shipments
  where remark = 'DEMO-20261117' or remark = '门户演示数据';
create temp table demo_ord on commit drop as
  select id from public.orders where remark like 'DEMO-20261117%';
create temp table demo_stmt on commit drop as
  select id from public.statements
  where source = 'import' and period_from = '2026-10-20' and period_to = '2026-11-17';
select 'demo_ship='||count(*)||' demo_ord='||(select count(*) from demo_ord)
       ||' demo_stmt='||(select count(*) from demo_stmt) from demo_ship;

-- 1) 对账/账单链（先子后父）------------------------------------------------
delete from public.statement_disputes        where statement_id in (select id from demo_stmt);
delete from public.statement_lines           where statement_id in (select id from demo_stmt);
delete from public.billing_lines             where statement_id in (select id from demo_stmt);
delete from public.statement_import_batches
 where batch_no = 'BI-DEMO-202611-01' or file_name ilike 'demo-bill%';
delete from public.statements                where id in (select id from demo_stmt);
-- 兜底：任何指向已删演示货件的费用行
delete from public.billing_lines             where shipment_id in (select id from demo_ship);

-- 2) 工单（演示触发）------------------------------------------------------
delete from public.work_orders
 where shipment_id in (select id from demo_ship)
    or title like '已作废单据出现在货代账单里%'
    or title like '已作废单据收到费用回传%'
    or title like '货代回传的阶段跳转被拒%';

-- 3) 货件周边明细 --------------------------------------------------------
delete from public.shipment_status_events    where shipment_id in (select id from demo_ship);
delete from public.label_files               where shipment_id in (select id from demo_ship);
delete from public.parcels                   where shipment_id in (select id from demo_ship);
delete from public.tracking_subscriptions    where shipment_id in (select id from demo_ship);
-- 推单/回传日志：现存 22 条全部来自演示货件与链路探针，没有真实货代交互
delete from public.push_logs;
delete from public.automation_runs           where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae';

-- 4) 通知：自动化引擎生成的（标题还是没翻译的 i18n key）+ 幽灵账号的
delete from public.notifications             where title like 'notif.gen.%';
delete from public.notifications             where user_id is not null
                                              and user_id not in (select id from auth.users);

-- 5) 货件与订单 ----------------------------------------------------------
delete from public.order_events              where order_id in (select id from demo_ord);
delete from public.shipments                 where id in (select id from demo_ship);
delete from public.orders                    where id in (select id from demo_ord);

-- 6) 支付/权益夹具（WDTEST_* 与幽灵租户）---------------------------------
delete from public.wechat_bill_rows          where out_trade_no like 'WDTEST%';
delete from public.reconciliation_runs       where coalesce(only_local::text,'') like '%WDTEST%'
                                              or coalesce(detail::text,'') like '%WDTEST%';
delete from public.settle_mail_outbox        where order_no like 'WDTEST%';
delete from public.quota_recharges           where user_id not in (select id from auth.users);
delete from public.benefit_grants            where user_id not in (select id from auth.users);
delete from public.shop_licenses             where user_id not in (select id from auth.users);
delete from public.translate_packs           where user_id not in (select id from auth.users);
-- invoice_paid_sources / invoice_quota / v_order_refund_summary 是视图（不可删），
-- 它们的"幽灵行"全部来自 payment_orders；invoices / invoice_links 实测 0 行。
delete from public.payment_orders            where user_id not in (select id from auth.users);
-- 真实账号上那两笔从未支付的 ¥15 测试单（native、无交易号）
delete from public.payment_orders            where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae'
                                              and status = 'pending' and coalesce(wechat_trade_no,'') = '';

-- 7) QA/压测账号及其租户默认行 -------------------------------------------
delete from public.automation_rules  where user_id in (select id from qa_uid);
delete from public.fee_accounts      where user_id in (select id from qa_uid);
delete from public.fee_settings      where user_id in (select id from qa_uid);
delete from public.subscriptions     where user_id in (select id from qa_uid);
delete from public.tenant_quotas     where user_id in (select id from qa_uid);
delete from public.notifications     where user_id in (select id from qa_uid);
delete from public.profiles          where id in (select id from qa_uid);
delete from auth.users               where id in (select id from qa_uid);

-- 8) 幽灵租户残留（账号早就不存在了）-------------------------------------
delete from public.subscriptions     where user_id is not null and user_id not in (select id from auth.users);
delete from public.tenant_quotas     where user_id is not null and user_id not in (select id from auth.users);

-- 9) AI 模块的测试残渣 ----------------------------------------------
delete from public.agent_tool_logs   where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae';
delete from public.agent_conversations where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae';
delete from public.ai_history        where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae';
delete from public.ai_usage_logs     where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae';

-- 10) 货代侧假凭据 -------------------------------------------------------
delete from public.logistics_channels    where code like 'YT-%';
delete from public.forwarder_warehouses  where code like 'YT-%';
-- 云途：PORTALDEMOAPP + 回调端点已不存在，整条授权是门户演示夹具
delete from public.forwarder_auths       where app_key = 'PORTALDEMOAPP';
-- 慧航：授权行本身是真的（provider=huoxiaoyi 这个事实保留），只清空我填的占位凭据
-- 注意 forwarder_auths 没有 merchant_id 列，外部账号/租户是 external_account / external_tenant_id
update public.forwarder_auths
   set credentials_enc = null, webhook_secret_enc = null, app_key = '',
       external_account = null, external_tenant_id = null, callback_url = '',
       auth_state = 'registered', reviewed_at = null, authorized_at = null, registered_at = now(),
       last_error = '凭据为链路验证时的占位值，已于 2026-11-17 清空；待录入真实系统授权码 / AppKey / AppSecret'
 where provider = 'huoxiaoyi';

-- 11) 复核：应删的都要是 0 ----------------------------------------------
select 'chk_shipments_demo' as chk, count(*) as n from public.shipments where remark like 'DEMO%' or remark like '门户%'
union all select 'chk_orders_demo',      count(*) from public.orders where remark like 'DEMO%'
union all select 'chk_billing_left',     count(*) from public.billing_lines
union all select 'chk_statements',       count(*) from public.statements
union all select 'chk_work_orders',      count(*) from public.work_orders
union all select 'chk_push_logs',        count(*) from public.push_logs
union all select 'chk_label_files',      count(*) from public.label_files
union all select 'chk_parcels',          count(*) from public.parcels
union all select 'chk_sse',              count(*) from public.shipment_status_events
union all select 'chk_auto_runs',        count(*) from public.automation_runs
union all select 'chk_notif_gen',        count(*) from public.notifications where title like 'notif.gen.%'
union all select 'chk_notif_ghost',      count(*) from public.notifications where user_id not in (select id from auth.users)
union all select 'chk_qa_profiles',      count(*) from public.profiles where username like 'qa-%' or username like 'throttle-probe%' or username in ('nginx-burst','ipa','ipb')
union all select 'chk_qa_authusers',     count(*) from auth.users where id in (select id from qa_uid)
union all select 'chk_ghost_sub',        count(*) from public.subscriptions where user_id not in (select id from auth.users)
union all select 'chk_ghost_quota',      count(*) from public.tenant_quotas where user_id not in (select id from auth.users)
union all select 'chk_ghost_pay_view',   count(*) from public.invoice_paid_sources where user_id not in (select id from auth.users)
union all select 'chk_wdtest_pay',       count(*) from public.payment_orders where order_no like 'WDTEST%'
union all select 'chk_wechat_rows',      count(*) from public.wechat_bill_rows
union all select 'chk_recon_runs',       count(*) from public.reconciliation_runs
union all select 'chk_agent_conv',       count(*) from public.agent_conversations
union all select 'chk_yt_channels',      count(*) from public.logistics_channels where code like 'YT-%'
union all select 'chk_yt_warehouses',    count(*) from public.forwarder_warehouses where code like 'YT-%'
union all select 'chk_portal_demo_auth', count(*) from public.forwarder_auths where app_key = 'PORTALDEMOAPP'
union all select 'chk_hx_creds',         count(*) from public.forwarder_auths where provider='huoxiaoyi' and coalesce(credentials_enc,'') <> ''
order by 1;

-- 12) 复核：真实数据必须还在 --------------------------------------------
select 'real_profiles' as keep, count(*) as n from public.profiles
union all select 'real_auth_users',   count(*) from auth.users
union all select 'real_shop_auths',   count(*) from public.shop_auths
union all select 'real_ozon_order',   count(*) from public.orders where remark like 'Ozon FBS%'
union all select 'real_sync_logs',    count(*) from public.settlement_sync_logs
union all select 'real_order_sync',   count(*) from public.order_sync_logs
union all select 'real_audit_log',    count(*) from public.admin_audit_log
union all select 'real_forwarders',   count(*) from public.freight_forwarders
union all select 'real_hx_auth',      count(*) from public.forwarder_auths where provider='huoxiaoyi'
union all select 'leftover_ship',     count(*) from public.shipments
union all select 'leftover_orders',   count(*) from public.orders
union all select 'leftover_notif',    count(*) from public.notifications
union all select 'leftover_fee_acct', count(*) from public.fee_accounts
union all select 'leftover_auto_rule',count(*) from public.automation_rules
union all select 'leftover_sub',      count(*) from public.subscriptions
union all select 'leftover_quota',    count(*) from public.tenant_quotas
order by 1;

rollback;
