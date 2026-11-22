-- ============================================================================
-- Wave E · Ads 模块下线：兜底删除 9 张 ad_* 表
--
-- 现网已于 2026-11-17 15:37 删除（pg_dump -Fc 备份：
--   ~/thalvior-backups/ads-del-20261117-1537.tar.gz，含删除前的页面/路由快照）。
-- 但 zz_20261116_baseline_production_schema.sql 的旧副本仍会 CREATE TABLE 这些表，
-- 因此从旧基线从零部署的环境需要本文件把 ads 相关结构再清一遍。
--
-- 幂等：全部 IF EXISTS，重复执行无副作用。CASCADE 一并带走索引/约束/策略/授权。
-- 说明：财务侧「广告费」费用科目（fee_accounts.code = 'marketing.ads'）是成本科目，
--       不属于广告投放模块，本文件刻意不动。
-- ============================================================================
SET search_path = public;

BEGIN;

DROP TABLE IF EXISTS public.ad_attributions CASCADE;
DROP TABLE IF EXISTS public.ad_budgets      CASCADE;
DROP TABLE IF EXISTS public.ad_orders       CASCADE;
DROP TABLE IF EXISTS public.ad_spend        CASCADE;
DROP TABLE IF EXISTS public.ad_keywords     CASCADE;
DROP TABLE IF EXISTS public.ad_ads          CASCADE;
DROP TABLE IF EXISTS public.ad_groups       CASCADE;
DROP TABLE IF EXISTS public.ad_campaigns    CASCADE;
DROP TABLE IF EXISTS public.ad_accounts     CASCADE;

COMMIT;

-- RBAC 残留：ads 模块的 28 条 permissions（含 71 条 role_permissions 授权）。
-- 由 20261025_rbac_s1.sql 播种，模块下线后必须一并撤销，否则权限矩阵里仍挂着 /ads/* 路由。
BEGIN;

CREATE TEMP TABLE wE_ads_perm_ids ON COMMIT DROP AS
SELECT id FROM public.permissions
WHERE key ~ '^ads\.' OR module = 'ads' OR scope_ref ~ '^ad_';

DELETE FROM public.role_permissions
WHERE permission_id IN (SELECT id FROM wE_ads_perm_ids);

DELETE FROM public.sub_account_permissions
WHERE permission_id IN (SELECT id FROM wE_ads_perm_ids);

DELETE FROM public.permissions
WHERE id IN (SELECT id FROM wE_ads_perm_ids);

COMMIT;
