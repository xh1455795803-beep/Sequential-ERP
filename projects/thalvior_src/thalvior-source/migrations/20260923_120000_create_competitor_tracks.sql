-- 竞品监控表：记录竞品链接、价格、销量，跟踪竞品动态
CREATE TABLE IF NOT EXISTS public.competitor_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT,
  url TEXT,
  price NUMERIC,
  sales INTEGER,
  status TEXT DEFAULT '监控中',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);