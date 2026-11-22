-- 采集箱全字段增强：对标商用采集（变体/评分/评论/卖家/库存/销量/原价/详情图）
-- 幂等语法，重复执行安全

ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS brand TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS currency TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS platform TEXT;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS images JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- 完整版扩展字段
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS variants JSONB DEFAULT '[]'::jsonb;          -- 规格变体（颜色/尺寸/SKU/价格/图）
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS detail_images JSONB DEFAULT '[]'::jsonb;     -- 详情图（描述内嵌图）
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS original_price NUMERIC;                       -- 原价/划线价
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS rating NUMERIC(3,2);                          -- 评分 4.50
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS reviews INTEGER;                              -- 评论数
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS seller TEXT;                                  -- 卖家/店铺名
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS stock INTEGER;                                -- 库存（可抓到时）
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS sales INTEGER;                                -- 销量（月销/已售）
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS raw JSONB;                                    -- 原始抓取数据（审计/重解析）

-- 索引：平台筛选 + 时间排序
CREATE INDEX IF NOT EXISTS idx_collect_items_platform ON public.collect_items (platform);
CREATE INDEX IF NOT EXISTS idx_collect_items_created_at ON public.collect_items (created_at DESC);
