-- 采集箱架构升级：对标商用 ERP（公用采集箱 → 认领到平台采集箱 → 上架）
-- 1) collect_items 增加失败原因、认领店铺、认领时间
-- 2) 新增 collect_settings 表：价格公式 / 库存规则 / 违禁词 / 自动认领

-- ===== collect_items 状态流转 =====
-- 采集失败 → 待处理（公用采集箱）→ 已认领（claimed_shop，平台采集箱）→ 已上架

ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS claimed_shop TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

-- ===== 采集设置表（每租户一行） =====
CREATE TABLE IF NOT EXISTS public.collect_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 价格公式：售价 = 采购价 × (1 + markup%) + 固定费，再取尾数
  price_markup NUMERIC(6,3) NOT NULL DEFAULT 30,      -- 加价率 %
  price_fixed_fee NUMERIC(12,2) NOT NULL DEFAULT 0,   -- 固定费用（头程/包装）
  price_ending TEXT NOT NULL DEFAULT '',              -- 尾数：.99 / .95 / 空=不处理
  -- 库存规则
  default_stock INTEGER NOT NULL DEFAULT 100,         -- 认领后默认库存
  -- 违禁词：逗号分隔，命中则从标题/描述中移除
  banned_words TEXT NOT NULL DEFAULT '',
  -- 自动认领：采集成功后自动认领到该店铺（空=不自动）
  auto_claim_shop TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS：租户只能读写自己的设置
ALTER TABLE public.collect_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_all_collect_settings ON public.collect_settings;
CREATE POLICY users_all_collect_settings ON public.collect_settings
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
