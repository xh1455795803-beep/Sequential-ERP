-- ============================================
-- WMS 测试数据清理脚本
-- 保留：表结构、RLS、触发器、Edge Function
-- 删除：所有业务数据（seed 写入的）
-- ============================================

BEGIN;

-- 按外键依赖顺序，从子表到主表 TRUNCATE + RESTART IDENTITY

-- 出库相关（shipment 链路最长，先删）
TRUNCATE TABLE wms_pick_tasks CASCADE;
TRUNCATE TABLE wms_package_items CASCADE;
TRUNCATE TABLE wms_packages CASCADE;
TRUNCATE TABLE wms_shipment_items CASCADE;
TRUNCATE TABLE wms_shipments CASCADE;
TRUNCATE TABLE wms_wave_items CASCADE;
TRUNCATE TABLE wms_wave_tasks CASCADE;

-- 入库相关
TRUNCATE TABLE wms_putaway_tasks CASCADE;
TRUNCATE TABLE wms_receipt_scans CASCADE;
TRUNCATE TABLE wms_asn_items CASCADE;
TRUNCATE TABLE wms_asns CASCADE;

-- 库存（必须在 asn/shipment 之后，因为它们引用 inventory）
TRUNCATE TABLE wms_inventory_logs CASCADE;
TRUNCATE TABLE wms_inventory CASCADE;

-- 退件
TRUNCATE TABLE wms_return_items CASCADE;
TRUNCATE TABLE wms_returns CASCADE;

-- 盘点
TRUNCATE TABLE wms_stocktaking_items CASCADE;
TRUNCATE TABLE wms_stocktaking CASCADE;

-- 调拨 / 组套
TRUNCATE TABLE wms_transfer_items CASCADE;
TRUNCATE TABLE wms_transfers CASCADE;
TRUNCATE TABLE wms_kitting_orders CASCADE;
TRUNCATE TABLE wms_bom_items CASCADE;
TRUNCATE TABLE wms_bom CASCADE;

-- 计费
TRUNCATE TABLE wms_bill_items CASCADE;
TRUNCATE TABLE wms_bills CASCADE;
TRUNCATE TABLE wms_billing_rates CASCADE;

-- 承运商 API 日志
TRUNCATE TABLE wms_carrier_api_logs CASCADE;

-- 员工/绩效
TRUNCATE TABLE wms_staff_performance CASCADE;
TRUNCATE TABLE wms_staff_tasks CASCADE;

-- 调整单（ERP 旧表）
TRUNCATE TABLE inventory_adjustments CASCADE;
TRUNCATE TABLE stock_adjustments CASCADE;

-- 基础数据（最后删）
TRUNCATE TABLE wms_locations CASCADE;
TRUNCATE TABLE wms_zones CASCADE;
TRUNCATE TABLE wms_warehouses CASCADE;
TRUNCATE TABLE wms_carriers CASCADE;
TRUNCATE TABLE wms_skus CASCADE;

-- 新模块配置（保留角色/设置结构，删除用户数据）
TRUNCATE TABLE wms_user_roles CASCADE;  -- 删所有用户角色分配
TRUNCATE TABLE wms_customers CASCADE;   -- 删所有 3PL 客户
TRUNCATE TABLE wms_sync_status CASCADE; -- 删同步日志
TRUNCATE TABLE wms_audit_log CASCADE;   -- 删审计日志
TRUNCATE TABLE wms_settings CASCADE;    -- 删用户设置（保留表结构）
TRUNCATE TABLE wms_webhook_deliveries CASCADE; -- 删 webhook 投递日志

-- 注意：以下表保留空结构（不清）：
--   wms_roles — 保留 7 个角色定义
--   webhooks  — 保留订阅配置
--   wms_carrier_integrations — 保留承运商 API 配置（SF/JD/USPS/DHL）

-- 重置所有序列
SELECT setval(pg_get_serial_sequence('wms_inventory_logs', 'id'), 1, false);
SELECT setval(pg_get_serial_sequence('wms_carrier_api_logs', 'id'), 1, false);

COMMIT;

-- 验证
DO $$
DECLARE
    v_count integer;
BEGIN
    SELECT count(*) INTO v_count FROM wms_inventory;
    RAISE NOTICE 'inventory remaining: %', v_count;
    SELECT count(*) INTO v_count FROM wms_shipments;
    RAISE NOTICE 'shipments remaining: %', v_count;
    SELECT count(*) INTO v_count FROM wms_warehouses;
    RAISE NOTICE 'warehouses remaining: %', v_count;
    SELECT count(*) INTO v_count FROM wms_skus;
    RAISE NOTICE 'skus remaining: %', v_count;
END $$;
