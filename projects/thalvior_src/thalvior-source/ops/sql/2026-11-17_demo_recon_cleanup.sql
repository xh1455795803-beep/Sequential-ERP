-- 2026-11-17 演示数据清理（一键回滚 seed-recon.cjs + seed-net.sql + 账单导入落库结果）
--
-- 用途：/logistics* 与货代门户演示用的那批数据（16 票货件、33 条费用行、1 张云途月度账单、
--       争议/工单、2 个货代仓、3 个渠道）全部删掉，回到干净工作区。
--       真实用户数据不受影响：所有删除都以 shipments.remark = 'DEMO-20261117'
--       或 seed 里写死的 UUID 为边界。
--
-- 用法（生产）：
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - \
--     < ops/sql/2026-11-17_demo_recon_cleanup.sql
-- 重新造数据：
--   node /tmp/seed-recon.cjs > /tmp/seed.sql && sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -f - < /tmp/seed.sql
--   sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -f - < /tmp/seed-net.sql
--   账单链路演示：functions/bill-import 以 batch_no=BI-DEMO-202611-01 导入 /tmp/demo-bill.csv
--
-- 注意：freight_forwarders（云途物流）的档案字段是 update 补齐的，不是新增行，这里不回滚——
--       删掉会让货代列表重新变成空线，且原始值是预置目录默认值，回滚收益为负。

\set ON_ERROR_STOP on
begin;

-- 0) 圈定演示范围
create temp table demo_ship on commit drop as
  select id from shipments where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae' and remark = 'DEMO-20261117';

create temp table demo_stmt on commit drop as
  select id from statements
   where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae'
     and source = 'import' and period_from = '2026-10-20' and period_to = '2026-11-17';

-- 1) 对账链路（先子后父）
delete from statement_disputes where statement_id in (select id from demo_stmt);
delete from statement_lines    where statement_id in (select id from demo_stmt);
update billing_lines set statement_id = null where statement_id in (select id from demo_stmt);

delete from statement_import_batches
 where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae'
   and (batch_no = 'BI-DEMO-202611-01' or file_name ilike 'demo-bill%');

delete from statements where id in (select id from demo_stmt);

-- 2) 作废单据产生的争议/工单
delete from work_orders
 where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae'
   and (shipment_id in (select id from demo_ship) or title like '已作废单据出现在货代账单里%');

-- 3) 货件周边明细
delete from shipment_status_events where shipment_id in (select id from demo_ship);
delete from label_files            where shipment_id in (select id from demo_ship);
delete from parcels                where shipment_id in (select id from demo_ship);
delete from tracking_subscriptions where shipment_id in (select id from demo_ship);
delete from billing_lines          where shipment_id in (select id from demo_ship);
-- 推单日志没有指向 shipments 的外键（只有 user_id FK），不跟着删就会留下指向已删货件的孤儿审计行
delete from push_logs              where shipment_id in (select id from demo_ship);

-- 4) 货件与订单
delete from shipments where id in (select id from demo_ship);
delete from orders
 where user_id = '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae' and remark = 'DEMO-20261117';

-- 5) seed-net.sql 造的仓与渠道（写死 UUID，避免误删用户手工建的）
delete from logistics_channels where id in (
  '2f000001-0000-4000-8000-000000000001',
  '2f000002-0000-4000-8000-000000000001',
  '2f000003-0000-4000-8000-000000000001');
delete from forwarder_warehouses where id in (
  '1f000001-0000-4000-8000-000000000001',
  '1f000002-0000-4000-8000-000000000001');

commit;

-- 6) 校验：全部应为 0
select 'shipments_left'  as chk, count(*) as n from shipments  where remark = 'DEMO-20261117'
union all select 'orders_left',   count(*) from orders   where remark = 'DEMO-20261117'
union all select 'billing_left',  count(*) from billing_lines where shipment_id in (select id from shipments where remark = 'DEMO-20261117')
union all select 'stmt_left',     count(*) from statements where source = 'import' and period_from = '2026-10-20'
union all select 'batch_left',    count(*) from statement_import_batches where batch_no = 'BI-DEMO-202611-01'
union all select 'wo_left',       count(*) from work_orders where title like '已作废单据出现在货代账单里%'
union all select 'wh_left',       count(*) from forwarder_warehouses where code in ('YT-SZ','YT-YW')
union all select 'ch_left',       count(*) from logistics_channels where code like 'YT-%'
-- 真正的"残留"判定必须查孤儿行本身，不能借道 shipments：删完货件后
-- `push_logs where shipment_id in (select ... from shipments where remark=...)` 恒等于 0，是假绿。
union all select 'pushlog_orphan',count(*) from push_logs pl
   where pl.shipment_id is not null
     and not exists (select 1 from shipments s where s.id = pl.shipment_id)
order by 1;
