-- =====================================================================
-- zz_20261117_fw05_view_progress_cols.sql
-- 给 v_shipment_progress 补三列：label_source / batch_no / push_attempt
--
-- 起因（2026-11-17，货件看板改造实测反馈）：看板要把「推单幂等键 batch_no」
--   「面单来源 label_source（4 值枚举，不是布尔）」「推单尝试次数 push_attempt」
--   和四态并排显示，但视图里没有这三列，前端只能再发一次 shipments 全量查询
--   在内存里按 shipment_id 合并。租户内全表二次拉取，量一大就是性能坑。
--   视图存在的意义就是"一次查完"，所以补在视图上，而不是让每个页面各自 join。
--
-- !! 位置约束（2026-11-17 生产实测踩到，必须写进注释防复发）：
--   CREATE OR REPLACE VIEW **不能改已有列的名字，也不能在中间插列**——
--   PostgreSQL 按 ordinal_position 逐位比对列名，插列会让第 15 位起整体右移，
--   于是报：
--     ERROR: cannot change name of view column "apply_count" to "label_source"
--   唯一安全的增列方式是**追加到末尾**。若一定要调整列序，只能
--   DROP VIEW + CREATE VIEW，而 DROP 会级联打断所有依赖（含 PostgREST
--   的 relationship 缓存与前端已生成的 select 字段顺序），必须全链路一起改。
--   因此本迁移保留原 30 列原序，新 3 列放在第 31~33 位。
--
-- 幂等：CREATE OR REPLACE VIEW + 末尾追加。自检见文件末尾。
-- =====================================================================
SET search_path = public;

CREATE OR REPLACE VIEW public.v_shipment_progress AS
SELECT s.id AS shipment_id, s.user_id, s.order_id, s.platform_order_no,
       f.name AS forwarder_name, w.name AS warehouse_name, c.name AS channel_name,
       s.push_state, s.stage, s.doc_status, s.norm_status, s.raw_status,
       s.tracking_no, s.label_state,
       s.apply_count, s.apply_failed_code, s.apply_failed_reason,
       s.intercept_state, s.estimated_amount, s.actual_amount, s.fee_currency,
       (SELECT count(*) FROM parcels p WHERE p.shipment_id = s.id) AS parcel_total,
       (SELECT count(*) FROM parcels p WHERE p.shipment_id = s.id AND p.inbound_status = 'signed') AS parcel_signed,
       (SELECT count(*) FROM work_orders wo WHERE wo.shipment_id = s.id AND wo.status <> 'closed') AS open_work_orders,
       s.created_at, s.pushed_at, s.received_at, s.packed_at, s.handover_at, s.closed_at,
       -- ↓ 31~33：本迁移新增，只能追加在末尾（见上方位置约束）
       s.label_source, s.batch_no, s.push_attempt
  FROM shipments s
  LEFT JOIN freight_forwarders f ON f.id = s.forwarder_id
  LEFT JOIN forwarder_warehouses w ON w.id = s.warehouse_id
  LEFT JOIN logistics_channels c ON c.id = s.channel_id;

COMMENT ON VIEW public.v_shipment_progress IS
  '货件进度一览（33 列）。订单详情页「货代处理进度」与货件看板共用，'
  '一次查完四态 + 面单来源 + 幂等键 + 包裹/工单计数，前端不应再为此二次拉 shipments。'
  '对位妙手已知缺陷「选了货代但订单下看不到处理进度」。';

-- 自检 1：新增三列必须真的在视图上
-- 自检 2：前 30 列的名字与顺序必须一个都没变（防"改列名/插列"这类破坏性重写）
DO $q$
DECLARE v integer;
        head text;
        want text := 'shipment_id,user_id,order_id,platform_order_no,forwarder_name,warehouse_name,channel_name,push_state,stage,doc_status,norm_status,raw_status,tracking_no,label_state,apply_count,apply_failed_code,apply_failed_reason,intercept_state,estimated_amount,actual_amount,fee_currency,parcel_total,parcel_signed,open_work_orders,created_at,pushed_at,received_at,packed_at,handover_at,closed_at';
BEGIN
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='v_shipment_progress'
     AND column_name IN ('batch_no','label_source','push_attempt');
  IF v <> 3 THEN
    RAISE EXCEPTION '[fw05 自检失败] 补列只命中 %/3', v;
  END IF;
  SELECT string_agg(column_name, ',' ORDER BY ordinal_position) INTO head
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='v_shipment_progress'
     AND ordinal_position <= 30;
  IF head <> want THEN
    RAISE EXCEPTION E'[fw05 自检失败] 原 30 列被改动了：\n  现: %\n  期: %', head, want;
  END IF;
  SELECT count(*) INTO v FROM information_schema.columns
   WHERE table_schema='public' AND table_name='v_shipment_progress';
  RAISE NOTICE '[fw05 自检通过] v_shipment_progress 现有 % 列（原 30），原列序未变', v;
END $q$;
