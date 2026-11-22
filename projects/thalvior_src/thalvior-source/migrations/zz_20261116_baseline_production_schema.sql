-- ============================================================================
-- 权威结构基线 · 生产库 public schema（2026-11-16 08:2x 由 Qoder 抓取）
--
-- 【为什么必须有这个文件】实测：在"生产库副本 + 清空 public"的公平环境下，按文件名
--   顺序回放仓库原有 67 个迁移 → 55 成功 / 13 失败，空库最终只有 84 张表，
--   而线上 139 张、1452 列。等于说按本仓库从零部署根本起不来。
--   这是"页面功能看着成型、换环境就报错/不能用"的直接根因（缺表、缺列、缺函数、缺 RLS）。
--
-- 【做法】pg_dump --schema=public --schema-only 取线上真实结构，程序改写为幂等语句：
--   表/索引/序列 IF NOT EXISTS；函数/类型/约束/授权用 DO+EXCEPTION 包裹；
--   策略、触发器先 DROP IF EXISTS；函数体按 dollar-quote 完整切分（非按行切）。
--   并额外补一段"列对账"：1452 条 ADD COLUMN IF NOT EXISTS —— 因为
--   CREATE TABLE IF NOT EXISTS 会掩盖老表缺列（实测 payment_orders.package_code 就是这种）。
--
-- 【执行顺序】1 表体 → 2 序列 → 3 列对账 → 4 索引/约束/RLS策略/触发器/函数/视图/注释
--
-- 【已知的 13 个遗留失败迁移】不重写（避免破坏既有环境历史），由本基线统一兜正。
-- 【待清理、本文件有意不含】public.zz_test_fn(p uuid) 空测试函数；*_bak* 快照表建议后续单独处置。
-- 【命名 zz_ 开头】保证排序最后执行。
-- ============================================================================

SET search_path = public;

-- ---- 0. 扩展（线上 public schema 内实际装有 dblink；此前仓库迁移未声明，
--      导致 tenant_root() 等依赖 dblink 的函数在空库创建失败）----
CREATE EXTENSION IF NOT EXISTS dblink SCHEMA public;

-- ---- 1. 表体（139 张）----
CREATE TABLE IF NOT EXISTS public.automation_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    trigger text DEFAULT '订单创建'::text NOT NULL,
    condition text,
    action text,
    workflow_def jsonb DEFAULT '{}'::jsonb,
    enabled boolean DEFAULT true NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.orders (
    id text NOT NULL,
    buyer text DEFAULT ''::text NOT NULL,
    product text DEFAULT ''::text NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    status text DEFAULT '待处理'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    address text,
    shop_id uuid,
    shop_name text DEFAULT ''::text NOT NULL,
    external_order_id text,
    phone text DEFAULT ''::text NOT NULL,
    items jsonb DEFAULT '[]'::jsonb NOT NULL,
    remark text DEFAULT ''::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.after_sales (
    id text DEFAULT ('AS'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL,
    order_id text DEFAULT ''::text NOT NULL,
    buyer text DEFAULT ''::text NOT NULL,
    product text DEFAULT ''::text NOT NULL,
    reason text DEFAULT ''::text NOT NULL,
    status text DEFAULT '待处理'::text NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE IF NOT EXISTS public.agent_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    intent text,
    status text DEFAULT '成功'::text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_pending_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    action_type text NOT NULL,
    title text,
    detail text,
    params jsonb,
    status text DEFAULT 'pending'::text,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.agent_tool_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    tool text NOT NULL,
    params text,
    result_summary text,
    status text DEFAULT '成功'::text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ai_cash_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    service_key text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    unit_price numeric DEFAULT 0 NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    free_used integer DEFAULT 0 NOT NULL,
    paid_used integer DEFAULT 0 NOT NULL,
    balance_after numeric,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_free_quotas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    image_translate_free integer DEFAULT 5 NOT NULL,
    shop_plan_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    service_key text DEFAULT ''::text NOT NULL,
    service_name text DEFAULT ''::text NOT NULL,
    input_text text DEFAULT ''::text NOT NULL,
    output_text text DEFAULT ''::text NOT NULL,
    cost numeric DEFAULT 0 NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    service_key text DEFAULT ''::text NOT NULL,
    service_name text DEFAULT ''::text NOT NULL,
    cost numeric DEFAULT 0 NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    prompt_tokens integer DEFAULT 0 NOT NULL,
    completion_tokens integer DEFAULT 0 NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    credits numeric
);

CREATE TABLE IF NOT EXISTS public.announcements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    content text,
    status text DEFAULT '已发布'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    key_value text NOT NULL,
    scope text DEFAULT 'read'::text NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.api_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    key_id uuid,
    method text DEFAULT 'GET'::text NOT NULL,
    path text NOT NULL,
    status_code integer,
    ip text,
    called_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.automation_failures (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    run_id uuid,
    rule_id uuid,
    error text,
    retry_at timestamp with time zone,
    retries integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.automation_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rule_id uuid,
    trigger_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    result text,
    duration_ms integer
);

CREATE TABLE IF NOT EXISTS public.benefit_grants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    benefit_key text NOT NULL,
    source_package text,
    granted_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.bills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    bill_no text NOT NULL,
    type text,
    amount numeric,
    status text DEFAULT '待支付'::text,
    created_at text
);

CREATE TABLE IF NOT EXISTS public.brands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    logo text,
    country text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    parent_id uuid,
    sort integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cn_category_qualifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_key text NOT NULL,
    category_path text NOT NULL,
    required_qualifications jsonb DEFAULT '[]'::jsonb NOT NULL,
    notes text,
    source_url text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    category_keywords text[] DEFAULT '{}'::text[] NOT NULL,
    notes_en text
);

CREATE TABLE IF NOT EXISTS public.cn_listing_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    product_id text,
    platform_key text NOT NULL,
    generation_type text DEFAULT 'generate'::text NOT NULL,
    prompt_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    compliance jsonb,
    score numeric(5,2),
    score_detail jsonb,
    model text,
    tokens_used integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cn_platform_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_key text NOT NULL,
    platform_name text NOT NULL,
    title_max_chars integer NOT NULL,
    title_max_bytes integer,
    main_image_count integer,
    main_image_min_px integer,
    detail_image_max_px integer,
    sku_max_count integer,
    sales_attr_max integer,
    sku_code_max_len integer,
    price_min numeric,
    price_unit numeric,
    weight_required boolean DEFAULT false NOT NULL,
    desc_max_chars integer,
    rule_notes jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_url text NOT NULL,
    source_note text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_name_en text
);

CREATE TABLE IF NOT EXISTS public.cn_sensitive_words (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    word text NOT NULL,
    category text NOT NULL,
    platform_scope text[] DEFAULT '{}'::text[] NOT NULL,
    severity text DEFAULT 'high'::text NOT NULL,
    suggestion text,
    source_url text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    suggestion_en text
);

CREATE TABLE IF NOT EXISTS public.collect_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    source text,
    category text,
    price numeric,
    status text DEFAULT '待采集'::text,
    image text,
    sku text,
    description text,
    brand text,
    currency text,
    platform text,
    images jsonb DEFAULT '[]'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    variants jsonb DEFAULT '[]'::jsonb,
    detail_images jsonb DEFAULT '[]'::jsonb,
    original_price numeric,
    rating numeric(3,2),
    reviews integer,
    seller text,
    stock integer,
    sales integer,
    raw jsonb,
    error_message text,
    claimed_shop text,
    claimed_at timestamp with time zone,
    claimed_shop_id uuid
);

CREATE TABLE IF NOT EXISTS public.collect_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    platform text,
    source_type text DEFAULT '关键词'::text NOT NULL,
    source_value text,
    category text,
    interval_hours integer DEFAULT 24 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    last_run_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.collect_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    price_markup numeric(6,3) DEFAULT 30 NOT NULL,
    price_fixed_fee numeric(12,2) DEFAULT 0 NOT NULL,
    price_ending text DEFAULT ''::text NOT NULL,
    default_stock integer DEFAULT 100 NOT NULL,
    banned_words text DEFAULT ''::text NOT NULL,
    auto_claim_shop text DEFAULT ''::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.competitor_tracks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    platform text,
    url text,
    price numeric,
    sales integer,
    status text DEFAULT '监控中'::text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cost_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date text,
    category text DEFAULT '采购'::text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.country_tax_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    country_code text NOT NULL,
    country_name text NOT NULL,
    duty_rate numeric DEFAULT 0 NOT NULL,
    vat_rate numeric DEFAULT 0 NOT NULL,
    tax_free_threshold numeric,
    note text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.country_tax_rates_bak_taxfix (
    id uuid,
    user_id uuid,
    country_code text,
    country_name text,
    duty_rate numeric,
    vat_rate numeric,
    tax_free_threshold numeric,
    note text,
    sort_order integer,
    created_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.credit_packages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    package_code text NOT NULL,
    name text NOT NULL,
    credits numeric DEFAULT 0 NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    original_price numeric DEFAULT 0 NOT NULL,
    per_credit numeric DEFAULT 0 NOT NULL,
    tag text,
    recommended boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    code_hash text NOT NULL,
    scene text DEFAULT 'login'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_send_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scene text NOT NULL,
    recipient text NOT NULL,
    lang text DEFAULT 'zh'::text NOT NULL,
    subject text,
    render_ok boolean DEFAULT true NOT NULL,
    fallback boolean DEFAULT false NOT NULL,
    success boolean DEFAULT false NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scene text NOT NULL,
    lang text DEFAULT 'zh'::text NOT NULL,
    name text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    type text DEFAULT '订单'::text NOT NULL,
    level text DEFAULT '警告'::text NOT NULL,
    source text,
    title text NOT NULL,
    message text,
    related_id text,
    status text DEFAULT '待处理'::text NOT NULL,
    handled_by text,
    handled_at timestamp with time zone,
    resolved_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fba_fee_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    tier_key text NOT NULL,
    tier_label text NOT NULL,
    max_dimension numeric NOT NULL,
    max_weight numeric NOT NULL,
    delivery_fee numeric NOT NULL,
    storage_rate numeric DEFAULT 0.87 NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fee_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    category_id uuid NOT NULL,
    code text NOT NULL,
    name_key text NOT NULL,
    is_allocatable boolean DEFAULT true NOT NULL,
    default_allocation text DEFAULT 'order_amount_ratio'::text NOT NULL,
    is_negative_allowed boolean DEFAULT false NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 100 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT fee_accounts_default_allocation_check CHECK ((default_allocation = ANY (ARRAY['none'::text, 'order_amount_ratio'::text, 'sku_quantity_ratio'::text, 'order_even'::text])))
);

CREATE TABLE IF NOT EXISTS public.fee_categories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name_key text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fee_settings (
    user_id uuid NOT NULL,
    single_fee_threshold numeric(14,2) DEFAULT 10000 NOT NULL,
    dup_account_limit integer DEFAULT 2 NOT NULL,
    fee_gt_revenue_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    category text,
    amount numeric,
    created_at text
);

CREATE TABLE IF NOT EXISTS public.forwarder_catalog (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    channel text,
    region text,
    days text,
    scale text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.freight_forwarders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    status text DEFAULT '合作中'::text NOT NULL,
    contact text DEFAULT ''::text NOT NULL,
    phone text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.fulfillment_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    sku text NOT NULL,
    product text,
    warehouse text,
    qty integer,
    status text DEFAULT '待备货'::text
);

CREATE TABLE IF NOT EXISTS public.fx_rates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    currency text NOT NULL,
    rate numeric DEFAULT 1 NOT NULL,
    date text,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inbound_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_no text NOT NULL,
    warehouse text,
    status text DEFAULT '待入库'::text,
    created_at text,
    sku text,
    qty integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.income_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date text,
    platform text,
    shop text,
    order_no text,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    type text DEFAULT '销售收入'::text NOT NULL,
    status text DEFAULT '已确认'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inventory (
    id text NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    warehouse text DEFAULT ''::text NOT NULL,
    available integer DEFAULT 0 NOT NULL,
    locked integer DEFAULT 0 NOT NULL,
    in_transit integer DEFAULT 0 NOT NULL,
    safety_stock integer DEFAULT 0 NOT NULL,
    status text DEFAULT '正常'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE IF NOT EXISTS public.invoice_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id uuid NOT NULL,
    payment_order_no text NOT NULL,
    user_id uuid NOT NULL,
    amount numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT invoice_links_amount_check CHECK ((amount >= (0)::numeric))
);

CREATE TABLE IF NOT EXISTS public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    invoice_no text,
    invoice_type text DEFAULT 'normal'::text NOT NULL,
    title_type text DEFAULT 'personal'::text NOT NULL,
    title text NOT NULL,
    tax_no text,
    amount numeric DEFAULT 0 NOT NULL,
    content text DEFAULT '信息技术服务费'::text NOT NULL,
    email text,
    remark text,
    status text DEFAULT 'pending'::text NOT NULL,
    reject_reason text,
    order_nos jsonb DEFAULT '[]'::jsonb NOT NULL,
    file_url text,
    issued_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    void_reason text
);

CREATE TABLE IF NOT EXISTS public.payment_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_no text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    pay_type text DEFAULT 'native'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    wechat_trade_no text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    plan_id uuid,
    credits_granted numeric,
    package_code text,
    platform_code text,
    license_shop_count integer,
    license_period text,
    period_months integer
);

CREATE TABLE IF NOT EXISTS public.license_periods (
    period_code text NOT NULL,
    label text NOT NULL,
    months integer NOT NULL,
    discount numeric(4,2) NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.license_platforms (
    platform_code text NOT NULL,
    name text NOT NULL,
    category text DEFAULT '主流平台'::text NOT NULL,
    base_price numeric(10,2) DEFAULT 20 NOT NULL,
    icon_key text DEFAULT ''::text,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.license_shop_tiers (
    shop_count integer NOT NULL,
    volume_discount numeric(4,2) NOT NULL,
    label text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listing_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    product_id text,
    platform text DEFAULT ''::text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    generation_type text DEFAULT 'generate'::text NOT NULL,
    prompt_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    result jsonb DEFAULT '{}'::jsonb NOT NULL,
    score numeric(5,2),
    score_detail jsonb,
    model text,
    tokens_used integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listing_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    task_id uuid,
    product text,
    platform text,
    action text,
    result text DEFAULT '成功'::text NOT NULL,
    message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listing_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    local_platform text,
    target_platform text,
    field_map text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listing_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    product text DEFAULT ''::text NOT NULL,
    source text DEFAULT ''::text NOT NULL,
    target_platforms text DEFAULT ''::text NOT NULL,
    status text DEFAULT '待刊登'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listing_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text DEFAULT ''::text NOT NULL,
    platform text DEFAULT ''::text NOT NULL,
    title_rule text DEFAULT ''::text NOT NULL,
    desc_rule text DEFAULT ''::text NOT NULL,
    price_rule text DEFAULT ''::text NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_auth_id uuid,
    product_id text,
    platform text DEFAULT 'WooCommerce'::text NOT NULL,
    status text DEFAULT '发布中'::text NOT NULL,
    wc_product_id text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.locations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    warehouse_id uuid,
    warehouse_code text,
    zone text,
    shelf text,
    bin text,
    capacity integer DEFAULT 0 NOT NULL,
    used integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.logistics_channels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    carrier text,
    days text,
    status text DEFAULT '启用'::text,
    priority integer DEFAULT 0,
    forwarder_name text DEFAULT ''::text,
    region text DEFAULT ''::text,
    price text DEFAULT ''::text
);

CREATE TABLE IF NOT EXISTS public.materials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    type text,
    size text,
    created_at text
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    title text DEFAULT ''::text NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    type text DEFAULT '系统'::text NOT NULL,
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.oauth_apps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text,
    redirect_uri text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.operation_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    action text NOT NULL,
    module text,
    detail text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    condition text,
    action text,
    status text DEFAULT '启用'::text
);

CREATE TABLE IF NOT EXISTS public.order_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    key text NOT NULL,
    value text,
    description text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.order_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_auth_id uuid,
    shop_name text DEFAULT ''::text NOT NULL,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    fetched_count integer DEFAULT 0 NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    error_message text,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.outbound_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_no text NOT NULL,
    warehouse text,
    status text DEFAULT '待出库'::text,
    created_at text,
    sku text,
    qty integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.parcels (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    parcel_no text,
    waybill_no text,
    order_id text,
    weight numeric DEFAULT 0 NOT NULL,
    length integer DEFAULT 0 NOT NULL,
    width integer DEFAULT 0 NOT NULL,
    height integer DEFAULT 0 NOT NULL,
    status text DEFAULT '待打包'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.payables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    supplier text,
    invoice_no text,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    due_date text,
    status text DEFAULT '未付'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    module text NOT NULL,
    resource text NOT NULL,
    action text NOT NULL,
    name text NOT NULL,
    name_en text NOT NULL,
    group_code text NOT NULL,
    risk_level text DEFAULT 'medium'::text NOT NULL,
    scope_type text DEFAULT 'route'::text NOT NULL,
    scope_ref text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permissions_key_ck CHECK ((key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'::text)),
    CONSTRAINT permissions_risk_ck CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT permissions_scope_ck CHECK ((scope_type = ANY (ARRAY['route'::text, 'table'::text, 'endpoint'::text, 'rpc'::text])))
);

CREATE TABLE IF NOT EXISTS public.platform_auth_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform_key text NOT NULL,
    platform_name text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    auth_type text DEFAULT 'manual'::text NOT NULL,
    oauth_ready boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    note text DEFAULT ''::text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    oauth_flow text DEFAULT 'oauth'::text,
    token_ttl_days integer,
    api_base_url text,
    seller_level_path text,
    authorize_endpoint text,
    token_endpoint text,
    shop_list_endpoint text,
    shop_list_method text DEFAULT 'GET'::text,
    callback_param text DEFAULT 'code'::text,
    shop_list_field_path jsonb DEFAULT '{}'::jsonb,
    cred_fields jsonb DEFAULT '[]'::jsonb,
    verify_mode text DEFAULT 'none'::text,
    verify_endpoint text,
    verify_credential_map jsonb DEFAULT '{}'::jsonb,
    supports_shop_list boolean DEFAULT false NOT NULL,
    max_shops_per_auth integer,
    token_scope_note text,
    free_shop_limit integer DEFAULT 2 NOT NULL,
    market_service_id text,
    market_api_base text,
    CONSTRAINT platform_auth_config_auth_type_check CHECK ((auth_type = ANY (ARRAY['oauth'::text, 'manual'::text]))),
    CONSTRAINT platform_auth_config_cred_fields_check CHECK (((jsonb_typeof(cred_fields) = 'array'::text) AND (NOT (cred_fields @? '$[*]?(!(exists (@."type")) || @."type" != "password" && @."type" != "text")'::jsonpath)))),
    CONSTRAINT platform_auth_config_free_shop_limit_check CHECK ((free_shop_limit >= 0)),
    CONSTRAINT platform_auth_config_oauth_flow_check CHECK ((oauth_flow = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text]))),
    CONSTRAINT platform_auth_config_shop_list_method_check CHECK ((shop_list_method = ANY (ARRAY['GET'::text, 'POST'::text, 'PUT'::text, 'PATCH'::text, 'DELETE'::text]))),
    CONSTRAINT platform_auth_config_verify_mode_check CHECK ((verify_mode = ANY (ARRAY['api'::text, 'none'::text])))
);

CREATE TABLE IF NOT EXISTS public.platform_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    type text,
    api_key text,
    status text DEFAULT '启用'::text,
    created_at timestamp with time zone DEFAULT now(),
    region text,
    auth_type text DEFAULT 'manual'::text,
    store_note text,
    logo_url text,
    sites jsonb DEFAULT '[]'::jsonb,
    auth_flow text DEFAULT 'manual'::text,
    managed_mode text,
    sort_order integer DEFAULT 0 NOT NULL,
    auth_state text DEFAULT 'not_ready'::text,
    auth_guide jsonb DEFAULT '{}'::jsonb,
    logo_letter text,
    logo_gradient text,
    CONSTRAINT platform_configs_auth_flow_check CHECK ((auth_flow = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text, 'manual'::text]))),
    CONSTRAINT platform_configs_auth_state_check CHECK ((auth_state = ANY (ARRAY['ready'::text, 'not_ready'::text, 'unsupported'::text])))
);

CREATE TABLE IF NOT EXISTS public.platform_configs_bak_20261012 (
    id uuid,
    name text,
    type text,
    api_key text,
    status text,
    created_at timestamp with time zone,
    region text,
    auth_type text
);

CREATE TABLE IF NOT EXISTS public.platform_fee_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_auth_id uuid NOT NULL,
    platform text NOT NULL,
    order_id text,
    platform_order_no text DEFAULT ''::text NOT NULL,
    fee_account_id uuid NOT NULL,
    sku text DEFAULT ''::text NOT NULL,
    item_name text DEFAULT ''::text NOT NULL,
    amount numeric(14,2) DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    allocation_type text DEFAULT 'none'::text NOT NULL,
    allocation_group_id uuid,
    is_abnormal boolean DEFAULT false NOT NULL,
    abnormal_reason text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_fee_records_allocation_type_check CHECK ((allocation_type = ANY (ARRAY['none'::text, 'order_amount_ratio'::text, 'sku_quantity_ratio'::text, 'order_even'::text])))
);

CREATE TABLE IF NOT EXISTS public.platform_field_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    platform text NOT NULL,
    target_column text NOT NULL,
    api_endpoint text,
    api_path text,
    value_kind text DEFAULT 'string'::text NOT NULL,
    coverage text DEFAULT 'auto'::text NOT NULL,
    manual_hint jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_field_map_api_endpoint_check CHECK (((api_endpoint IS NOT NULL) AND (api_endpoint = ANY (ARRAY['token'::text, 'shop_list'::text, 'profile'::text, 'check'::text])))),
    CONSTRAINT platform_field_map_coverage_check CHECK ((coverage = ANY (ARRAY['auto'::text, 'manual_only'::text, 'never'::text]))),
    CONSTRAINT platform_field_map_manual_hint_check CHECK ((jsonb_typeof(manual_hint) = 'object'::text)),
    CONSTRAINT platform_field_map_target_column_check CHECK ((target_column = ANY (ARRAY['platform_shop_id'::text, 'region'::text, 'global_store_id'::text, 'global_store_name'::text, 'global_store_source'::text, 'shop_name'::text, 'biz_model'::text, 'seller_level'::text, 'subject_account_id'::text, 'auth_scope'::text, 'authorized_at_ts'::text, 'auth_method'::text, 'auth_group_id'::text, 'validity_days'::text, 'shop_alias'::text, 'shop_type'::text, 'group_ids'::text, 'shop_status'::text, 'sort_order'::text, 'is_new'::text, 'remark'::text, 'notify_enabled'::text, 'unbound_at'::text, 'last_checked_at'::text, 'data_source'::text, 'manual_fields'::text]))),
    CONSTRAINT platform_field_map_value_kind_check CHECK ((value_kind = ANY (ARRAY['string'::text, 'bool'::text, 'int'::text, 'timestamp'::text, 'enum'::text])))
);

CREATE TABLE IF NOT EXISTS public.pricing_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    markup_type text DEFAULT 'percent'::text NOT NULL,
    markup_value numeric(12,2) DEFAULT 0 NOT NULL,
    commission_rate numeric(5,2) DEFAULT 0 NOT NULL,
    freight numeric(12,2) DEFAULT 0 NOT NULL,
    target_currency text DEFAULT 'USD'::text NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_templates_markup_type_check CHECK ((markup_type = ANY (ARRAY['percent'::text, 'fixed'::text])))
);

CREATE TABLE IF NOT EXISTS public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id text,
    sku text,
    attributes text,
    price numeric(12,2),
    stock integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    user_id uuid,
    CONSTRAINT product_variants_no_new CHECK (((product_id IS NULL) OR (product_id <> 'new'::text)))
);

CREATE TABLE IF NOT EXISTS public.products (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    sku text NOT NULL,
    category text DEFAULT ''::text NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    status text DEFAULT '在售'::text NOT NULL,
    image text DEFAULT ''::text NOT NULL,
    sales integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    description text,
    variants jsonb DEFAULT '[]'::jsonb,
    cost numeric(12,2),
    images jsonb DEFAULT '[]'::jsonb,
    primary_image text,
    source_platform text DEFAULT ''::text,
    source_url text DEFAULT ''::text,
    extras jsonb DEFAULT '{}'::jsonb,
    updated_at timestamp with time zone DEFAULT now(),
    shop_id text,
    images_backup jsonb,
    i18n jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid NOT NULL,
    username text NOT NULL,
    avatar_url text,
    created_at timestamp without time zone DEFAULT now(),
    role text DEFAULT 'tenant_user'::text,
    status text DEFAULT 'active'::text NOT NULL,
    owner_id uuid,
    is_sub_account boolean DEFAULT false NOT NULL,
    tenant_role text,
    tenant_id uuid
);

CREATE TABLE IF NOT EXISTS public.profit_records (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_id text DEFAULT ''::text NOT NULL,
    product text DEFAULT ''::text NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    revenue numeric DEFAULT 0 NOT NULL,
    cost numeric DEFAULT 0 NOT NULL,
    shipping numeric DEFAULT 0 NOT NULL,
    platform_fee numeric DEFAULT 0 NOT NULL,
    ad_fee numeric DEFAULT 0 NOT NULL,
    profit numeric DEFAULT 0 NOT NULL,
    margin numeric DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    order_id uuid NOT NULL,
    product_id text,
    sku text DEFAULT ''::text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    image text,
    qty integer DEFAULT 0 NOT NULL,
    price numeric(12,2) DEFAULT 0 NOT NULL,
    amount numeric(12,2) DEFAULT 0 NOT NULL,
    received_qty integer,
    source_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    po_no text NOT NULL,
    supplier_id uuid,
    supplier_name text,
    status text DEFAULT '待采购'::text NOT NULL,
    expect_date date,
    note text,
    total_amount numeric(12,2) DEFAULT 0 NOT NULL,
    platform_order_no text,
    item_count integer DEFAULT 0 NOT NULL,
    inbound_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    sku text NOT NULL,
    product text,
    qty integer,
    supplier text,
    status text DEFAULT '待采购'::text
);

CREATE TABLE IF NOT EXISTS public.purchase_returns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    return_no text,
    po_no text,
    supplier_id uuid,
    sku text,
    qty integer DEFAULT 0 NOT NULL,
    reason text,
    status text DEFAULT '待处理'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.purchase_suggestions (
    id text NOT NULL,
    sku text NOT NULL,
    name text NOT NULL,
    available integer DEFAULT 0 NOT NULL,
    safety_stock integer DEFAULT 0 NOT NULL,
    daily_sales integer DEFAULT 0 NOT NULL,
    suggest_qty integer DEFAULT 0 NOT NULL,
    level text DEFAULT '正常'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE IF NOT EXISTS public.quota_recharges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    amount numeric DEFAULT 0 NOT NULL,
    method text DEFAULT '模拟支付'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.receivables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    customer text,
    invoice_no text,
    amount numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CNY'::text NOT NULL,
    due_date text,
    status text DEFAULT '未收'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.reconciliations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    bill_no text NOT NULL,
    amount numeric,
    status text DEFAULT '待核销'::text,
    created_at text
);

CREATE TABLE IF NOT EXISTS public.return_orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    order_no text NOT NULL,
    sku text,
    qty integer DEFAULT 0,
    warehouse text DEFAULT ''::text,
    supplier text DEFAULT ''::text,
    reason text DEFAULT ''::text,
    status text DEFAULT '待退货'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    effect text DEFAULT 'allow'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT role_permissions_effect_ck CHECK ((effect = ANY (ARRAY['allow'::text, 'deny'::text])))
);

CREATE TABLE IF NOT EXISTS public.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    name_en text NOT NULL,
    description text,
    rank integer DEFAULT 50 NOT NULL,
    scope text DEFAULT 'tenant'::text NOT NULL,
    is_builtin boolean DEFAULT false NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    tenant_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_scope_ck CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NULL))))
);

CREATE TABLE IF NOT EXISTS public.service_pricing (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    service_name text NOT NULL,
    model text,
    unit_price numeric DEFAULT 0,
    unit text DEFAULT '次'::text,
    status text DEFAULT '启用'::text,
    created_at timestamp with time zone DEFAULT now(),
    service_key text DEFAULT ''::text NOT NULL,
    billing_mode text DEFAULT 'flat'::text NOT NULL,
    input_price_per_mtok numeric DEFAULT 0 NOT NULL,
    output_price_per_mtok numeric DEFAULT 0 NOT NULL,
    price_tiers jsonb,
    source_url text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    markup numeric DEFAULT 1 NOT NULL,
    credits_per_use numeric,
    cash_price numeric
);

CREATE TABLE IF NOT EXISTS public.settlement_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_auth_id uuid,
    shop_name text DEFAULT ''::text NOT NULL,
    platform text DEFAULT ''::text NOT NULL,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    fetched_orders integer DEFAULT 0 NOT NULL,
    fee_count integer DEFAULT 0 NOT NULL,
    inserted_count integer DEFAULT 0 NOT NULL,
    updated_count integer DEFAULT 0 NOT NULL,
    abnormal_count integer DEFAULT 0 NOT NULL,
    error_message text,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.settlement_sync_state (
    shop_auth_id uuid NOT NULL,
    user_id uuid,
    last_synced_at timestamp with time zone,
    last_status text,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shipments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    tracking_no text NOT NULL,
    carrier text,
    destination text,
    status text DEFAULT '运输中'::text,
    tracking_events jsonb DEFAULT '[]'::jsonb,
    origin text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    order_id text,
    tracking_status text DEFAULT 'created'::text,
    tracking_last_check timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.shipping_quotes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    carrier text DEFAULT ''::text NOT NULL,
    channel text DEFAULT ''::text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    currency text DEFAULT 'USD'::text NOT NULL,
    days text DEFAULT ''::text NOT NULL,
    features text DEFAULT ''::text NOT NULL,
    recommended boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shipping_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    order_id text,
    sku text,
    qty integer DEFAULT 0 NOT NULL,
    warehouse text,
    carrier text,
    status text DEFAULT '待拣货'::text NOT NULL,
    picked_at timestamp with time zone,
    packed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shop_auths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_name text NOT NULL,
    platform text NOT NULL,
    region text,
    status text DEFAULT '未授权'::text,
    authorized_at text,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    shop_domain text,
    scope text,
    credentials_enc text,
    verify_at timestamp with time zone,
    verify_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_type text,
    platform_shop_id text,
    global_store_id text,
    global_store_name text,
    biz_model text,
    seller_level text,
    subject_account_id text,
    auth_scope text,
    authorized_at_ts timestamp with time zone,
    auth_method text DEFAULT 'manual'::text,
    auth_group_id uuid,
    validity_days integer,
    shop_alias text,
    shop_type text DEFAULT 'cross'::text,
    shop_status text DEFAULT '未检测'::text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    is_new boolean DEFAULT false NOT NULL,
    remark text,
    notify_enabled boolean DEFAULT true NOT NULL,
    unbound_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    data_source text DEFAULT 'api'::text NOT NULL,
    manual_fields text[] DEFAULT '{}'::text[] NOT NULL,
    group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    global_store_source text DEFAULT 'platform'::text,
    CONSTRAINT shop_auths_auth_method_check CHECK ((auth_method = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text, 'manual'::text]))),
    CONSTRAINT shop_auths_global_store_source_check CHECK ((global_store_source = ANY (ARRAY['platform'::text, 'suggested'::text, 'manual'::text]))),
    CONSTRAINT shop_auths_status_check CHECK ((status = ANY (ARRAY['已授权'::text, '待验证'::text, '即将到期'::text, '已过期'::text, '已停用'::text, '未授权'::text, '对接中'::text, '正常'::text])))
);

CREATE TABLE IF NOT EXISTS public.shop_groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#1E6FFF'::text,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shop_licenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_code text NOT NULL,
    shop_count integer DEFAULT 2 NOT NULL,
    amount numeric DEFAULT 0,
    period text DEFAULT 'month'::text,
    status text DEFAULT 'active'::text,
    started_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    platform_code text,
    order_no text
);

CREATE TABLE IF NOT EXISTS public.shop_listing_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    shop_id text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    fields jsonb DEFAULT '{}'::jsonb NOT NULL,
    uploads jsonb DEFAULT '{}'::jsonb NOT NULL,
    user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shop_status_check_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    shop_id uuid,
    platform text,
    status text,
    error text,
    checked_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shop_sync_state (
    shop_auth_id uuid NOT NULL,
    user_id uuid,
    last_synced_at timestamp with time zone,
    last_status text,
    last_error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shops (
    id text NOT NULL,
    name text NOT NULL,
    platform text DEFAULT ''::text NOT NULL,
    region text DEFAULT ''::text NOT NULL,
    status text DEFAULT '正常'::text NOT NULL,
    today_sales numeric(12,2) DEFAULT 0 NOT NULL,
    today_orders integer DEFAULT 0 NOT NULL,
    product_count integer DEFAULT 0 NOT NULL,
    rating numeric(3,1) DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid
);

CREATE TABLE IF NOT EXISTS public.sku_mappings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    local_sku text NOT NULL,
    platform_sku text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sms_codes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    code text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_ip text
);

CREATE TABLE IF NOT EXISTS public.source_auths (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    source_name text NOT NULL,
    platform text NOT NULL,
    status text DEFAULT '正常'::text,
    authorized_at text,
    credentials_enc text,
    verify_note text,
    verify_at timestamp with time zone,
    auth_type text DEFAULT 'manual'::text
);

CREATE TABLE IF NOT EXISTS public.split_rules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name text NOT NULL,
    platform text,
    region text,
    warehouse text,
    priority integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_adjustments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sku text,
    warehouse text,
    reason text,
    qty integer DEFAULT 0 NOT NULL,
    type text DEFAULT '盘点调整'::text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sku text,
    warehouse text,
    level text DEFAULT '警告'::text NOT NULL,
    current_qty integer DEFAULT 0 NOT NULL,
    threshold integer DEFAULT 0 NOT NULL,
    status text DEFAULT '未处理'::text NOT NULL,
    resolved_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sku text,
    warehouse text,
    biz_type text,
    change_qty integer DEFAULT 0 NOT NULL,
    after_qty integer DEFAULT 0 NOT NULL,
    operator text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_strategies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    sku text,
    warehouse text,
    min_qty integer DEFAULT 0 NOT NULL,
    max_qty integer DEFAULT 0 NOT NULL,
    reorder_point integer DEFAULT 0 NOT NULL,
    lead_time integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_sync_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    shop_auth_id uuid,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    status text DEFAULT '成功'::text NOT NULL,
    pushed_count integer DEFAULT 0 NOT NULL,
    success_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    skipped_count integer DEFAULT 0 NOT NULL,
    error_message text,
    duration_ms integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.stock_sync_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id text,
    sku_mappings_id uuid,
    user_id uuid,
    shop_auth_id uuid,
    local_sku text DEFAULT ''::text NOT NULL,
    old_qty integer DEFAULT 0 NOT NULL,
    new_qty integer DEFAULT 0 NOT NULL,
    status text DEFAULT '待推送'::text NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    pushed_at timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.stock_takes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_no text,
    warehouse text,
    sku text,
    system_qty integer DEFAULT 0 NOT NULL,
    actual_qty integer DEFAULT 0 NOT NULL,
    diff integer DEFAULT 0 NOT NULL,
    operator text,
    status text DEFAULT '待盘点'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sub_account_audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    tenant_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    sub_account_id uuid,
    action text NOT NULL,
    target text,
    result text NOT NULL,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sub_account_audit_result_ck CHECK ((result = ANY (ARRAY['allow'::text, 'deny'::text, 'success'::text, 'error'::text])))
);

CREATE TABLE IF NOT EXISTS public.sub_account_permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sub_account_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    effect text DEFAULT 'allow'::text NOT NULL,
    granted_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sub_account_permissions_effect_ck CHECK ((effect = ANY (ARRAY['allow'::text, 'deny'::text])))
);

CREATE TABLE IF NOT EXISTS public.sub_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text DEFAULT ''::text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    role text DEFAULT '运营'::text NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    auth_user_id uuid,
    role_id uuid,
    invite_token text,
    invited_at timestamp with time zone,
    activated_at timestamp with time zone,
    last_login_at timestamp with time zone,
    invited_by uuid,
    CONSTRAINT sub_accounts_status_ck CHECK ((status = ANY (ARRAY['待激活'::text, '启用'::text, '停用'::text, '已离职'::text])))
);

CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    plan_key text NOT NULL,
    name text NOT NULL,
    price numeric DEFAULT 0 NOT NULL,
    period text DEFAULT '月'::text NOT NULL,
    description text,
    quota numeric DEFAULT 0 NOT NULL,
    features jsonb DEFAULT '[]'::jsonb NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    max_shops integer DEFAULT 1 NOT NULL,
    max_products integer DEFAULT 100 NOT NULL,
    price_quarter numeric,
    price_year numeric,
    discount_quarter numeric,
    discount_year numeric,
    tier_rank integer DEFAULT 0,
    max_subaccounts integer DEFAULT 0,
    image_space_mb integer DEFAULT 0,
    collect_quota_monthly integer DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.subscription_plans_bak_20261010 (
    id uuid,
    plan_key text,
    name text,
    price numeric,
    period text,
    description text,
    quota numeric,
    features jsonb,
    sort_order integer,
    status text,
    created_at timestamp with time zone,
    max_shops integer,
    max_products integer,
    price_quarter numeric,
    price_year numeric,
    discount_quarter numeric,
    discount_year numeric,
    tier_rank integer,
    max_subaccounts integer,
    image_space_mb integer,
    collect_quota_monthly integer
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    plan_id uuid,
    plan_name text DEFAULT ''::text NOT NULL,
    amount numeric DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    started_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.suppliers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    name text NOT NULL,
    contact text,
    phone text,
    status text DEFAULT '合作中'::text
);

CREATE TABLE IF NOT EXISTS public.tenant_quotas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    balance numeric DEFAULT 100 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    plan_id uuid,
    plan_name text DEFAULT ''::text NOT NULL,
    plan_expires_at timestamp with time zone,
    credits numeric DEFAULT 0,
    workbench_credits numeric DEFAULT 0,
    workbench_free_date date,
    workbench_free_today numeric DEFAULT 0,
    agent_credits numeric DEFAULT 0,
    agent_free_date date,
    agent_free_today numeric DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.traffic_stats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    channel text NOT NULL,
    visits integer,
    orders integer,
    conversion numeric
);

CREATE TABLE IF NOT EXISTS public.translate_packs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    pack_code text NOT NULL,
    name text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    remaining integer DEFAULT 0 NOT NULL,
    source text DEFAULT 'pending'::text,
    amount numeric DEFAULT 0,
    status text DEFAULT 'active'::text,
    purchased_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.warehouses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    code text,
    name text NOT NULL,
    country text,
    city text,
    address text,
    status text DEFAULT '启用'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.waybills (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    waybill_no text,
    shipment_id uuid,
    carrier text,
    tracking_no text,
    weight numeric DEFAULT 0 NOT NULL,
    fee numeric DEFAULT 0 NOT NULL,
    status text DEFAULT '已生成'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.webhooks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    url text NOT NULL,
    event text DEFAULT 'order.created'::text NOT NULL,
    secret text,
    status text DEFAULT '启用'::text NOT NULL,
    last_triggered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- ---- 2. 序列（1 条语句）----

CREATE SEQUENCE IF NOT EXISTS public.invoice_no_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS id text DEFAULT ('AS'::text || replace((gen_random_uuid())::text, '-'::text, ''::text)) NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS order_id text DEFAULT ''::text NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS buyer text DEFAULT ''::text NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS product text DEFAULT ''::text NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS reason text DEFAULT ''::text NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS status text DEFAULT '待处理'::text NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS amount numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.after_sales ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS role text NOT NULL;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS content text NOT NULL;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS intent text;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.agent_conversations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS token text NOT NULL;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS action_type text NOT NULL;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS params jsonb;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone NOT NULL;
ALTER TABLE public.agent_pending_actions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS tool text NOT NULL;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS params text;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS result_summary text;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.agent_tool_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS service_key text NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1 NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS free_used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS paid_used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS balance_after numeric;
ALTER TABLE public.ai_cash_usage ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS image_translate_free integer DEFAULT 5 NOT NULL;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS shop_plan_code text;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ai_free_quotas ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS service_key text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS service_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS input_text text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS output_text text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.ai_history ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS service_key text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS service_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS prompt_tokens integer DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS completion_tokens integer DEFAULT 0 NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS quantity integer DEFAULT 1 NOT NULL;
ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS credits numeric;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS title text NOT NULL;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS content text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS status text DEFAULT '已发布'::text;
ALTER TABLE public.announcements ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS key_value text NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS scope text DEFAULT 'read'::text NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS last_used_at timestamp with time zone;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS key_id uuid;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS method text DEFAULT 'GET'::text NOT NULL;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS path text NOT NULL;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS status_code integer;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS ip text;
ALTER TABLE public.api_logs ADD COLUMN IF NOT EXISTS called_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS run_id uuid;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS rule_id uuid;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS retry_at timestamp with time zone;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS retries integer DEFAULT 0 NOT NULL;
ALTER TABLE public.automation_failures ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS trigger text DEFAULT '订单创建'::text NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS workflow_def jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS last_run_at timestamp with time zone;
ALTER TABLE public.automation_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS rule_id uuid;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS trigger_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS result text;
ALTER TABLE public.automation_runs ADD COLUMN IF NOT EXISTS duration_ms integer;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS benefit_key text NOT NULL;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS source_package text;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS granted_at timestamp with time zone DEFAULT now();
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone NOT NULL;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text;
ALTER TABLE public.benefit_grants ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS bill_no text NOT NULL;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS status text DEFAULT '待支付'::text;
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS logo text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.brands ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS parent_id uuid;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS sort integer DEFAULT 0 NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS platform_key text NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS category_path text NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS required_qualifications jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS category_keywords text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.cn_category_qualifications ADD COLUMN IF NOT EXISTS notes_en text;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS platform_key text NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS generation_type text DEFAULT 'generate'::text NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS prompt_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS compliance jsonb;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS score numeric(5,2);
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS score_detail jsonb;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_listing_generations ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS platform_key text NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS platform_name text NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS title_max_chars integer NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS title_max_bytes integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS main_image_count integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS main_image_min_px integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS detail_image_max_px integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS sku_max_count integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS sales_attr_max integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS sku_code_max_len integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS price_min numeric;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS price_unit numeric;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS weight_required boolean DEFAULT false NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS desc_max_chars integer;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS rule_notes jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS source_url text NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS source_note text;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_platform_rules ADD COLUMN IF NOT EXISTS platform_name_en text;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS word text NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS category text NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS platform_scope text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS severity text DEFAULT 'high'::text NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS suggestion text;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cn_sensitive_words ADD COLUMN IF NOT EXISTS suggestion_en text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS status text DEFAULT '待采集'::text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS currency text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS detail_images jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS original_price numeric;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS rating numeric(3,2);
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS reviews integer;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS seller text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS stock integer;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS sales integer;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS raw jsonb;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS claimed_shop text;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone;
ALTER TABLE public.collect_items ADD COLUMN IF NOT EXISTS claimed_shop_id uuid;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS source_type text DEFAULT '关键词'::text NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS source_value text;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS interval_hours integer DEFAULT 24 NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS last_run_at timestamp with time zone;
ALTER TABLE public.collect_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS price_markup numeric(6,3) DEFAULT 30 NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS price_fixed_fee numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS price_ending text DEFAULT ''::text NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS default_stock integer DEFAULT 100 NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS banned_words text DEFAULT ''::text NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS auto_claim_shop text DEFAULT ''::text NOT NULL;
ALTER TABLE public.collect_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS sales integer;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS status text DEFAULT '监控中'::text;
ALTER TABLE public.competitor_tracks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS category text DEFAULT '采购'::text NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS currency text DEFAULT 'CNY'::text NOT NULL;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.cost_records ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS country_code text NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS country_name text NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS duty_rate numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS vat_rate numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS tax_free_threshold numeric;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.country_tax_rates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS country_code text;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS country_name text;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS duty_rate numeric;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS vat_rate numeric;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS tax_free_threshold numeric;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.country_tax_rates_bak_taxfix ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS package_code text NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS credits numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS original_price numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS per_credit numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS recommended boolean DEFAULT false NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.credit_packages ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS email text NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS code_hash text NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS scene text DEFAULT 'login'::text NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS used boolean DEFAULT false NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS attempts integer DEFAULT 0 NOT NULL;
ALTER TABLE public.email_codes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS scene text NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS recipient text NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS lang text DEFAULT 'zh'::text NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS render_ok boolean DEFAULT true NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS fallback boolean DEFAULT false NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS success boolean DEFAULT false NOT NULL;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.email_send_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS scene text NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS lang text DEFAULT 'zh'::text NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS subject text NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS body text NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.email_templates ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS type text DEFAULT '订单'::text NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS level text DEFAULT '警告'::text NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS title text NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS related_id text;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS status text DEFAULT '待处理'::text NOT NULL;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS handled_by text;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS handled_at timestamp with time zone;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS resolved_note text;
ALTER TABLE public.exceptions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS tier_key text NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS tier_label text NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS max_dimension numeric NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS max_weight numeric NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS delivery_fee numeric NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS storage_rate numeric DEFAULT 0.87 NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.fba_fee_tiers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS category_id uuid NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS code text NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS name_key text NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS is_allocatable boolean DEFAULT true NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS default_allocation text DEFAULT 'order_amount_ratio'::text NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS is_negative_allowed boolean DEFAULT false NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 100 NOT NULL;
ALTER TABLE public.fee_accounts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fee_categories ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fee_categories ADD COLUMN IF NOT EXISTS code text NOT NULL;
ALTER TABLE public.fee_categories ADD COLUMN IF NOT EXISTS name_key text NOT NULL;
ALTER TABLE public.fee_categories ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.fee_categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fee_settings ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.fee_settings ADD COLUMN IF NOT EXISTS single_fee_threshold numeric(14,2) DEFAULT 10000 NOT NULL;
ALTER TABLE public.fee_settings ADD COLUMN IF NOT EXISTS dup_account_limit integer DEFAULT 2 NOT NULL;
ALTER TABLE public.fee_settings ADD COLUMN IF NOT EXISTS fee_gt_revenue_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.fee_settings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.fees ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS channel text;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS days text;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS scale text;
ALTER TABLE public.forwarder_catalog ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS channel text DEFAULT ''::text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS region text DEFAULT ''::text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS status text DEFAULT '合作中'::text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS contact text DEFAULT ''::text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS phone text DEFAULT ''::text NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.freight_forwarders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS sku text NOT NULL;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS qty integer;
ALTER TABLE public.fulfillment_plans ADD COLUMN IF NOT EXISTS status text DEFAULT '待备货'::text;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS currency text NOT NULL;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS rate numeric DEFAULT 1 NOT NULL;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.fx_rates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS order_no text NOT NULL;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS status text DEFAULT '待入库'::text;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.inbound_orders ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS date text;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS shop text;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS currency text DEFAULT 'CNY'::text NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS type text DEFAULT '销售收入'::text NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS status text DEFAULT '已确认'::text NOT NULL;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.income_records ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS id text NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS sku text NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS warehouse text DEFAULT ''::text NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS available integer DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS locked integer DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS in_transit integer DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS safety_stock integer DEFAULT 0 NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS status text DEFAULT '正常'::text NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.inventory ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS invoice_id uuid NOT NULL;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS payment_order_no text NOT NULL;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS amount numeric NOT NULL;
ALTER TABLE public.invoice_links ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS invoice_type text DEFAULT 'normal'::text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS title_type text DEFAULT 'personal'::text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS title text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS tax_no text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS content text DEFAULT '信息技术服务费'::text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS remark text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS reject_reason text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS order_nos jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS file_url text;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS issued_at timestamp with time zone;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS void_reason text;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS period_code text NOT NULL;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS label text NOT NULL;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS months integer NOT NULL;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS discount numeric(4,2) NOT NULL;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.license_periods ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS platform_code text NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS category text DEFAULT '主流平台'::text NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS base_price numeric(10,2) DEFAULT 20 NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS icon_key text DEFAULT ''::text;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.license_platforms ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.license_shop_tiers ADD COLUMN IF NOT EXISTS shop_count integer NOT NULL;
ALTER TABLE public.license_shop_tiers ADD COLUMN IF NOT EXISTS volume_discount numeric(4,2) NOT NULL;
ALTER TABLE public.license_shop_tiers ADD COLUMN IF NOT EXISTS label text NOT NULL;
ALTER TABLE public.license_shop_tiers ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.license_shop_tiers ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS platform text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS language text DEFAULT 'en'::text NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS generation_type text DEFAULT 'generate'::text NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS prompt_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS result jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS score numeric(5,2);
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS score_detail jsonb;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS tokens_used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.listing_generations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS task_id uuid;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS result text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS message text;
ALTER TABLE public.listing_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS local_platform text;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS target_platform text;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS field_map text;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.listing_mappings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS product text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS source text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS target_platforms text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS status text DEFAULT '待刊登'::text NOT NULL;
ALTER TABLE public.listing_tasks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS platform text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS title_rule text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS desc_rule text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS price_rule text DEFAULT ''::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.listing_templates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS shop_auth_id uuid;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS platform text DEFAULT 'WooCommerce'::text NOT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS status text DEFAULT '发布中'::text NOT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS wc_product_id text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS warehouse_id uuid;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS warehouse_code text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS zone text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS shelf text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS bin text;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS capacity integer DEFAULT 0 NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS used integer DEFAULT 0 NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS days text;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS forwarder_name text DEFAULT ''::text;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS region text DEFAULT ''::text;
ALTER TABLE public.logistics_channels ADD COLUMN IF NOT EXISTS price text DEFAULT ''::text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS size text;
ALTER TABLE public.materials ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS title text DEFAULT ''::text NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS content text DEFAULT ''::text NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS type text DEFAULT '系统'::text NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read boolean DEFAULT false NOT NULL;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS client_id text NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS client_secret text;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS redirect_uri text;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.oauth_apps ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS action text NOT NULL;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS module text;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE public.operation_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS condition text;
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.order_rules ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS key text NOT NULL;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS value text;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.order_settings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS shop_auth_id uuid;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS shop_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS fetched_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS inserted_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS updated_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS failed_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS duration_ms integer DEFAULT 0 NOT NULL;
ALTER TABLE public.order_sync_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS id text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS buyer text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS product text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS sku text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS channel text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS amount numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD'::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS status text DEFAULT '待处理'::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shop_id uuid;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shop_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS external_order_id text;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS phone text DEFAULT ''::text NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS items jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS remark text DEFAULT ''::text NOT NULL;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS order_no text NOT NULL;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS status text DEFAULT '待出库'::text;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.outbound_orders ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS parcel_no text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS waybill_no text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS length integer DEFAULT 0 NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS width integer DEFAULT 0 NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS height integer DEFAULT 0 NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS status text DEFAULT '待打包'::text NOT NULL;
ALTER TABLE public.parcels ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS currency text DEFAULT 'CNY'::text NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS due_date text;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS status text DEFAULT '未付'::text NOT NULL;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.payables ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS order_no text NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS pay_type text DEFAULT 'native'::text NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS wechat_trade_no text;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS credits_granted numeric;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS package_code text;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS platform_code text;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS license_shop_count integer;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS license_period text;
ALTER TABLE public.payment_orders ADD COLUMN IF NOT EXISTS period_months integer;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS key text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS module text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS resource text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS action text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS name_en text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS group_code text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS risk_level text DEFAULT 'medium'::text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS scope_type text DEFAULT 'route'::text NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS scope_ref text;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true NOT NULL;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS platform_key text NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS platform_name text NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS region text DEFAULT ''::text NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS auth_type text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS oauth_ready boolean DEFAULT false NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS note text DEFAULT ''::text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS oauth_flow text DEFAULT 'oauth'::text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS token_ttl_days integer;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS api_base_url text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS seller_level_path text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS authorize_endpoint text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS token_endpoint text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS shop_list_endpoint text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS shop_list_method text DEFAULT 'GET'::text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS callback_param text DEFAULT 'code'::text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS shop_list_field_path jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS cred_fields jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS verify_mode text DEFAULT 'none'::text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS verify_endpoint text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS verify_credential_map jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS supports_shop_list boolean DEFAULT false NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS max_shops_per_auth integer;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS token_scope_note text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS free_shop_limit integer DEFAULT 2 NOT NULL;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS market_service_id text;
ALTER TABLE public.platform_auth_config ADD COLUMN IF NOT EXISTS market_api_base text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS api_key text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS auth_type text DEFAULT 'manual'::text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS store_note text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS sites jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS auth_flow text DEFAULT 'manual'::text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS managed_mode text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS auth_state text DEFAULT 'not_ready'::text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS auth_guide jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS logo_letter text;
ALTER TABLE public.platform_configs ADD COLUMN IF NOT EXISTS logo_gradient text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS api_key text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.platform_configs_bak_20261012 ADD COLUMN IF NOT EXISTS auth_type text;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS shop_auth_id uuid NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS platform text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS platform_order_no text DEFAULT ''::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS fee_account_id uuid NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS sku text DEFAULT ''::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS item_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS amount numeric(14,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD'::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS raw jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS occurred_at timestamp with time zone;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS synced_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS allocation_type text DEFAULT 'none'::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS allocation_group_id uuid;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS is_abnormal boolean DEFAULT false NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS abnormal_reason text DEFAULT ''::text NOT NULL;
ALTER TABLE public.platform_fee_records ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS platform text NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS target_column text NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS api_endpoint text;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS api_path text;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS value_kind text DEFAULT 'string'::text NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS coverage text DEFAULT 'auto'::text NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS manual_hint jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS source_note text;
ALTER TABLE public.platform_field_map ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS markup_type text DEFAULT 'percent'::text NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS markup_value numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS commission_rate numeric(5,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS freight numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS target_currency text DEFAULT 'USD'::text NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS is_default boolean DEFAULT false NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.pricing_templates ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS attributes text;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS price numeric(12,2);
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS stock integer;
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.product_variants ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS id text DEFAULT (gen_random_uuid())::text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sku text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text DEFAULT ''::text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock integer DEFAULT 0 NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS status text DEFAULT '在售'::text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image text DEFAULT ''::text NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS sales integer DEFAULT 0 NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS cost numeric(12,2);
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS primary_image text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS source_platform text DEFAULT ''::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS source_url text DEFAULT ''::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS extras jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS shop_id text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS images_backup jsonb;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS i18n jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id uuid NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username text NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at timestamp without time zone DEFAULT now();
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'tenant_user'::text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_sub_account boolean DEFAULT false NOT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tenant_role text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS order_id text DEFAULT ''::text NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS product text DEFAULT ''::text NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS channel text DEFAULT ''::text NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS revenue numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS cost numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS shipping numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS platform_fee numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS ad_fee numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS profit numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS margin numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.profit_records ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS order_id uuid NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS sku text DEFAULT ''::text NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS price numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS amount numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS received_qty integer;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS po_no text NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS supplier_name text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS status text DEFAULT '待采购'::text NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS expect_date date;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS total_amount numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS platform_order_no text;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS item_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS inbound_at timestamp with time zone;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_orders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS sku text NOT NULL;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS product text;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS qty integer;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS supplier text;
ALTER TABLE public.purchase_plans ADD COLUMN IF NOT EXISTS status text DEFAULT '待采购'::text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS return_no text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS po_no text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS supplier_id uuid;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS status text DEFAULT '待处理'::text NOT NULL;
ALTER TABLE public.purchase_returns ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS id text NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS sku text NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS available integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS safety_stock integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS daily_sales integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS suggest_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS level text DEFAULT '正常'::text NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.purchase_suggestions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.quota_recharges ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.quota_recharges ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.quota_recharges ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.quota_recharges ADD COLUMN IF NOT EXISTS method text DEFAULT '模拟支付'::text NOT NULL;
ALTER TABLE public.quota_recharges ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS customer text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS invoice_no text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS currency text DEFAULT 'CNY'::text NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS due_date text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS status text DEFAULT '未收'::text NOT NULL;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.receivables ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS bill_no text NOT NULL;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS amount numeric;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS status text DEFAULT '待核销'::text;
ALTER TABLE public.reconciliations ADD COLUMN IF NOT EXISTS created_at text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS order_no text NOT NULL;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS warehouse text DEFAULT ''::text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS supplier text DEFAULT ''::text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS reason text DEFAULT ''::text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS status text DEFAULT '待退货'::text;
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.return_orders ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS role_id uuid NOT NULL;
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS permission_id uuid NOT NULL;
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS effect text DEFAULT 'allow'::text NOT NULL;
ALTER TABLE public.role_permissions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS key text NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS name_en text NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS rank integer DEFAULT 50 NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS scope text DEFAULT 'tenant'::text NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_builtin boolean DEFAULT false NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS is_system boolean DEFAULT false NOT NULL;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS tenant_id uuid;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS service_name text NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS model text;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS unit_price numeric DEFAULT 0;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS unit text DEFAULT '次'::text;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS service_key text DEFAULT ''::text NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS billing_mode text DEFAULT 'flat'::text NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS input_price_per_mtok numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS output_price_per_mtok numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS price_tiers jsonb;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS markup numeric DEFAULT 1 NOT NULL;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS credits_per_use numeric;
ALTER TABLE public.service_pricing ADD COLUMN IF NOT EXISTS cash_price numeric;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS shop_auth_id uuid;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS shop_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS platform text DEFAULT ''::text NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS fetched_orders integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS fee_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS inserted_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS updated_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS abnormal_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS duration_ms integer DEFAULT 0 NOT NULL;
ALTER TABLE public.settlement_sync_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS shop_auth_id uuid NOT NULL;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.settlement_sync_state ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS tracking_no text NOT NULL;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS destination text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS status text DEFAULT '运输中'::text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS tracking_events jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS tracking_status text DEFAULT 'created'::text;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS tracking_last_check timestamp with time zone;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS carrier text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS channel text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD'::text NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS days text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS features text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS recommended boolean DEFAULT false NOT NULL;
ALTER TABLE public.shipping_quotes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS order_id text;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS status text DEFAULT '待拣货'::text NOT NULL;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS picked_at timestamp with time zone;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS packed_at timestamp with time zone;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS shipped_at timestamp with time zone;
ALTER TABLE public.shipping_tasks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS shop_name text NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS platform text NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS status text DEFAULT '未授权'::text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS authorized_at text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS access_token text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS refresh_token text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS token_expires_at timestamp with time zone;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS shop_domain text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS credentials_enc text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS verify_at timestamp with time zone;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS verify_note text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS auth_type text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS platform_shop_id text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS global_store_id text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS global_store_name text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS biz_model text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS seller_level text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS subject_account_id text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS auth_scope text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS authorized_at_ts timestamp with time zone;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS auth_method text DEFAULT 'manual'::text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS auth_group_id uuid;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS validity_days integer;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS shop_alias text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS shop_type text DEFAULT 'cross'::text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS shop_status text DEFAULT '未检测'::text NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS is_new boolean DEFAULT false NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS remark text;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS notify_enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS unbound_at timestamp with time zone;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS last_checked_at timestamp with time zone;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS data_source text DEFAULT 'api'::text NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS manual_fields text[] DEFAULT '{}'::text[] NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS group_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL;
ALTER TABLE public.shop_auths ADD COLUMN IF NOT EXISTS global_store_source text DEFAULT 'platform'::text;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS color text DEFAULT '#1E6FFF'::text;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.shop_groups ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS plan_code text NOT NULL;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS shop_count integer DEFAULT 2 NOT NULL;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS period text DEFAULT 'month'::text;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS started_at timestamp with time zone DEFAULT now();
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS platform_code text;
ALTER TABLE public.shop_licenses ADD COLUMN IF NOT EXISTS order_no text;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS shop_id text NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS region text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS fields jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS uploads jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_listing_rules ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS shop_id uuid;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.shop_status_check_logs ADD COLUMN IF NOT EXISTS checked_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS shop_auth_id uuid NOT NULL;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS last_synced_at timestamp with time zone;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.shop_sync_state ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS id text NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS platform text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS region text DEFAULT ''::text NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS status text DEFAULT '正常'::text NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS today_sales numeric(12,2) DEFAULT 0 NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS today_orders integer DEFAULT 0 NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS product_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS rating numeric(3,1) DEFAULT 0 NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.sku_mappings ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sku_mappings ADD COLUMN IF NOT EXISTS listing_id uuid NOT NULL;
ALTER TABLE public.sku_mappings ADD COLUMN IF NOT EXISTS local_sku text NOT NULL;
ALTER TABLE public.sku_mappings ADD COLUMN IF NOT EXISTS platform_sku text NOT NULL;
ALTER TABLE public.sku_mappings ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS phone text NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS code text NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS used boolean DEFAULT false NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sms_codes ADD COLUMN IF NOT EXISTS client_ip text;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS source_name text NOT NULL;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS platform text NOT NULL;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS status text DEFAULT '正常'::text;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS authorized_at text;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS credentials_enc text;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS verify_note text;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS verify_at timestamp with time zone;
ALTER TABLE public.source_auths ADD COLUMN IF NOT EXISTS auth_type text DEFAULT 'manual'::text;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS platform text;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS region text;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS priority integer DEFAULT 0 NOT NULL;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.split_rules ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS reason text;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS type text DEFAULT '盘点调整'::text NOT NULL;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS note text;
ALTER TABLE public.stock_adjustments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS level text DEFAULT '警告'::text NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS current_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS threshold integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS status text DEFAULT '未处理'::text NOT NULL;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS resolved_note text;
ALTER TABLE public.stock_alerts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS biz_type text;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS change_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS after_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE public.stock_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS min_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS max_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS reorder_point integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS lead_time integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.stock_strategies ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS shop_auth_id uuid;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS trigger_type text DEFAULT 'manual'::text NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS status text DEFAULT '成功'::text NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS pushed_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS success_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS failed_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS skipped_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS error_message text;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS duration_ms integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_logs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS sku_mappings_id uuid;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS shop_auth_id uuid;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS local_sku text DEFAULT ''::text NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS old_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS new_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS status text DEFAULT '待推送'::text NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.stock_sync_queue ADD COLUMN IF NOT EXISTS pushed_at timestamp with time zone;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS plan_no text;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS warehouse text;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS sku text;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS system_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS actual_qty integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS diff integer DEFAULT 0 NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS operator text;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS status text DEFAULT '待盘点'::text NOT NULL;
ALTER TABLE public.stock_takes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS tenant_id uuid NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS actor_id uuid NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS sub_account_id uuid;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS action text NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS target text;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS result text NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS detail jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE public.sub_account_audit_log ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS sub_account_id uuid NOT NULL;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS permission_id uuid NOT NULL;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS effect text DEFAULT 'allow'::text NOT NULL;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS granted_by uuid;
ALTER TABLE public.sub_account_permissions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS email text DEFAULT ''::text NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS role text DEFAULT '运营'::text NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS auth_user_id uuid;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS role_id uuid;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS invite_token text;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS invited_at timestamp with time zone;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS activated_at timestamp with time zone;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS last_login_at timestamp with time zone;
ALTER TABLE public.sub_accounts ADD COLUMN IF NOT EXISTS invited_by uuid;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS plan_key text NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS period text DEFAULT '月'::text NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS quota numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS features jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0 NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_shops integer DEFAULT 1 NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_products integer DEFAULT 100 NOT NULL;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_quarter numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS price_year numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS discount_quarter numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS discount_year numeric;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS tier_rank integer DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS max_subaccounts integer DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS image_space_mb integer DEFAULT 0;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS collect_quota_monthly integer DEFAULT 0;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS plan_key text;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS price numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS period text;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS quota numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS features jsonb;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS sort_order integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS created_at timestamp with time zone;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS max_shops integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS max_products integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS price_quarter numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS price_year numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS discount_quarter numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS discount_year numeric;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS tier_rank integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS max_subaccounts integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS image_space_mb integer;
ALTER TABLE public.subscription_plans_bak_20261010 ADD COLUMN IF NOT EXISTS collect_quota_monthly integer;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS started_at timestamp with time zone;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS status text DEFAULT '合作中'::text;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS balance numeric DEFAULT 100 NOT NULL;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_id uuid;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_name text DEFAULT ''::text NOT NULL;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS plan_expires_at timestamp with time zone;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS credits numeric DEFAULT 0;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS workbench_credits numeric DEFAULT 0;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS workbench_free_date date;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS workbench_free_today numeric DEFAULT 0;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS agent_credits numeric DEFAULT 0;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS agent_free_date date;
ALTER TABLE public.tenant_quotas ADD COLUMN IF NOT EXISTS agent_free_today numeric DEFAULT 0;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS channel text NOT NULL;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS visits integer;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS orders integer;
ALTER TABLE public.traffic_stats ADD COLUMN IF NOT EXISTS conversion numeric;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS pack_code text NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS total integer DEFAULT 0 NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS remaining integer DEFAULT 0 NOT NULL;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS source text DEFAULT 'pending'::text;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS amount numeric DEFAULT 0;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS purchased_at timestamp with time zone DEFAULT now();
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone;
ALTER TABLE public.translate_packs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS code text;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS name text NOT NULL;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.warehouses ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS waybill_no text;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS shipment_id uuid;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS carrier text;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS tracking_no text;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS weight numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS fee numeric DEFAULT 0 NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS status text DEFAULT '已生成'::text NOT NULL;
ALTER TABLE public.waybills ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid() NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS user_id uuid NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS url text NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS event text DEFAULT 'order.created'::text NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS secret text;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS status text DEFAULT '启用'::text NOT NULL;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS last_triggered_at timestamp with time zone;
ALTER TABLE public.webhooks ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now() NOT NULL;

-- ---- 4a. 统一 DROP 视图（老迁移遗留视图列名不同，CREATE OR REPLACE VIEW 不允许改列名）----
DROP VIEW IF EXISTS public.invoice_paid_sources CASCADE;
DROP VIEW IF EXISTS public.invoice_quota CASCADE;
DROP VIEW IF EXISTS public.v_admin_invoices CASCADE;

DO $q$ BEGIN
ALTER TABLE ONLY public.after_sales ADD CONSTRAINT after_sales_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] after_sales_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_conversations ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] agent_conversations_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_pending_actions ADD CONSTRAINT agent_pending_actions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] agent_pending_actions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_tool_logs ADD CONSTRAINT agent_tool_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] agent_tool_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_cash_usage ADD CONSTRAINT ai_cash_usage_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] ai_cash_usage_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_free_quotas ADD CONSTRAINT ai_free_quotas_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] ai_free_quotas_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_history ADD CONSTRAINT ai_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] ai_history_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_usage_logs ADD CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] ai_usage_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.announcements ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] announcements_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] api_keys_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] api_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures ADD CONSTRAINT automation_failures_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_failures_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_rules ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_runs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.benefit_grants ADD CONSTRAINT benefit_grants_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] benefit_grants_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.bills ADD CONSTRAINT bills_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] bills_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.brands ADD CONSTRAINT brands_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] brands_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] categories_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_category_qualifications ADD CONSTRAINT cn_category_qualifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cn_category_qualifications_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_listing_generations ADD CONSTRAINT cn_listing_generations_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cn_listing_generations_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_platform_rules ADD CONSTRAINT cn_platform_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cn_platform_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_sensitive_words ADD CONSTRAINT cn_sensitive_words_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cn_sensitive_words_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items ADD CONSTRAINT collect_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_items_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_rules ADD CONSTRAINT collect_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings ADD CONSTRAINT collect_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_settings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.competitor_tracks ADD CONSTRAINT competitor_tracks_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] competitor_tracks_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cost_records ADD CONSTRAINT cost_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cost_records_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.country_tax_rates ADD CONSTRAINT country_tax_rates_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] country_tax_rates_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.credit_packages ADD CONSTRAINT credit_packages_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] credit_packages_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_codes ADD CONSTRAINT email_codes_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] email_codes_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_send_logs ADD CONSTRAINT email_send_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] email_send_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_templates ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] email_templates_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.exceptions ADD CONSTRAINT exceptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] exceptions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fba_fee_tiers ADD CONSTRAINT fba_fee_tiers_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fba_fee_tiers_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts ADD CONSTRAINT fee_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_accounts_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_categories ADD CONSTRAINT fee_categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_categories_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_settings ADD CONSTRAINT fee_settings_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_settings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fees ADD CONSTRAINT fees_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fees_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.forwarder_catalog ADD CONSTRAINT forwarder_catalog_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] forwarder_catalog_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.freight_forwarders ADD CONSTRAINT freight_forwarders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] freight_forwarders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fulfillment_plans ADD CONSTRAINT fulfillment_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fulfillment_plans_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fx_rates ADD CONSTRAINT fx_rates_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fx_rates_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inbound_orders ADD CONSTRAINT inbound_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] inbound_orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.income_records ADD CONSTRAINT income_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] income_records_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inventory ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] inventory_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links ADD CONSTRAINT invoice_links_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoice_links_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoices ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoices_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_periods ADD CONSTRAINT license_periods_pkey PRIMARY KEY (period_code);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] license_periods_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_platforms ADD CONSTRAINT license_platforms_pkey PRIMARY KEY (platform_code);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] license_platforms_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_shop_tiers ADD CONSTRAINT license_shop_tiers_pkey PRIMARY KEY (shop_count);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] license_shop_tiers_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations ADD CONSTRAINT listing_generations_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_generations_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_logs ADD CONSTRAINT listing_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_mappings ADD CONSTRAINT listing_mappings_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_mappings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_tasks ADD CONSTRAINT listing_tasks_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_tasks_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_templates ADD CONSTRAINT listing_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_templates_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings ADD CONSTRAINT listings_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations ADD CONSTRAINT locations_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] locations_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.logistics_channels ADD CONSTRAINT logistics_channels_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] logistics_channels_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] materials_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.notifications ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] notifications_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.oauth_apps ADD CONSTRAINT oauth_apps_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] oauth_apps_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.operation_logs ADD CONSTRAINT operation_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] operation_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_rules ADD CONSTRAINT order_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_settings ADD CONSTRAINT order_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_settings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs ADD CONSTRAINT order_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_sync_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.outbound_orders ADD CONSTRAINT outbound_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] outbound_orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.parcels ADD CONSTRAINT parcels_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] parcels_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payables ADD CONSTRAINT payables_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] payables_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payment_orders ADD CONSTRAINT payment_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] payment_orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_configs ADD CONSTRAINT platform_configs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_configs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.pricing_templates ADD CONSTRAINT pricing_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] pricing_templates_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.product_variants ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] product_variants_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] products_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profiles_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profit_records ADD CONSTRAINT profit_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profit_records_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_items_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_plans ADD CONSTRAINT purchase_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_plans_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns ADD CONSTRAINT purchase_returns_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_returns_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_suggestions ADD CONSTRAINT purchase_suggestions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_suggestions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.quota_recharges ADD CONSTRAINT quota_recharges_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] quota_recharges_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.receivables ADD CONSTRAINT receivables_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] receivables_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.reconciliations ADD CONSTRAINT reconciliations_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] reconciliations_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.return_orders ADD CONSTRAINT return_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] return_orders_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] role_permissions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] roles_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.service_pricing ADD CONSTRAINT service_pricing_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] service_pricing_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_logs ADD CONSTRAINT settlement_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] settlement_sync_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state ADD CONSTRAINT settlement_sync_state_pkey PRIMARY KEY (shop_auth_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] settlement_sync_state_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipments_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_quotes ADD CONSTRAINT shipping_quotes_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipping_quotes_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_tasks ADD CONSTRAINT shipping_tasks_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipping_tasks_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths ADD CONSTRAINT shop_auths_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_auths_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_groups ADD CONSTRAINT shop_groups_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_groups_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_licenses ADD CONSTRAINT shop_licenses_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_licenses_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_listing_rules ADD CONSTRAINT shop_listing_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_listing_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs ADD CONSTRAINT shop_status_check_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_status_check_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state ADD CONSTRAINT shop_sync_state_pkey PRIMARY KEY (shop_auth_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_sync_state_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shops ADD CONSTRAINT shops_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shops_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sku_mappings ADD CONSTRAINT sku_mappings_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sku_mappings_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sms_codes ADD CONSTRAINT sms_codes_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sms_codes_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.source_auths ADD CONSTRAINT source_auths_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] source_auths_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.split_rules ADD CONSTRAINT split_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] split_rules_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_adjustments ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_adjustments_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_alerts ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_alerts_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_logs ADD CONSTRAINT stock_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_strategies ADD CONSTRAINT stock_strategies_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_strategies_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_logs ADD CONSTRAINT stock_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_sync_logs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue ADD CONSTRAINT stock_sync_queue_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_sync_queue_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_takes ADD CONSTRAINT stock_takes_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_takes_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log ADD CONSTRAINT sub_account_audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_audit_log_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts ADD CONSTRAINT sub_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_accounts_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscription_plans ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] subscription_plans_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] subscriptions_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] suppliers_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.tenant_quotas ADD CONSTRAINT tenant_quotas_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] tenant_quotas_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.traffic_stats ADD CONSTRAINT traffic_stats_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] traffic_stats_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.translate_packs ADD CONSTRAINT translate_packs_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] translate_packs_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.warehouses ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] warehouses_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills ADD CONSTRAINT waybills_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] waybills_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.webhooks ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] webhooks_pkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_pending_actions ADD CONSTRAINT agent_pending_actions_token_key UNIQUE (token);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] agent_pending_actions_token_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_free_quotas ADD CONSTRAINT ai_free_quotas_user_id_key UNIQUE (user_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] ai_free_quotas_user_id_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_platform_rules ADD CONSTRAINT cn_platform_rules_platform_key_key UNIQUE (platform_key);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cn_platform_rules_platform_key_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings ADD CONSTRAINT collect_settings_user_id_key UNIQUE (user_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_settings_user_id_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.credit_packages ADD CONSTRAINT credit_packages_package_code_key UNIQUE (package_code);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] credit_packages_package_code_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_templates ADD CONSTRAINT email_templates_scene_lang_key UNIQUE (scene, lang);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] email_templates_scene_lang_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts ADD CONSTRAINT fee_accounts_user_id_code_key UNIQUE (user_id, code);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_accounts_user_id_code_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_categories ADD CONSTRAINT fee_categories_code_key UNIQUE (code);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_categories_code_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.forwarder_catalog ADD CONSTRAINT forwarder_catalog_name_key UNIQUE (name);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] forwarder_catalog_name_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links ADD CONSTRAINT invoice_links_payment_order_no_key UNIQUE (payment_order_no);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoice_links_payment_order_no_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payment_orders ADD CONSTRAINT payment_orders_order_no_key UNIQUE (order_no);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] payment_orders_order_no_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_key_key UNIQUE (key);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_key_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_uniq UNIQUE (module, resource, action);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_uniq :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_platform_key_key UNIQUE (platform_key);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_platform_key_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_unique UNIQUE (platform, target_column, api_endpoint);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_unique :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profiles_username_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions ADD CONSTRAINT role_permissions_uniq UNIQUE (role_id, permission_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] role_permissions_uniq :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles ADD CONSTRAINT roles_key_key UNIQUE (key);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] roles_key_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_listing_rules ADD CONSTRAINT shop_listing_rules_shop_id_key UNIQUE (shop_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_listing_rules_shop_id_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_uniq UNIQUE (sub_account_id, permission_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_uniq :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscription_plans ADD CONSTRAINT subscription_plans_plan_key_key UNIQUE (plan_key);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] subscription_plans_plan_key_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.tenant_quotas ADD CONSTRAINT tenant_quotas_user_id_key UNIQUE (user_id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] tenant_quotas_user_id_key :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts ADD CONSTRAINT fee_accounts_default_allocation_check CHECK ((default_allocation = ANY (ARRAY['none'::text, 'order_amount_ratio'::text, 'sku_quantity_ratio'::text, 'order_even'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_accounts_default_allocation_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links ADD CONSTRAINT invoice_links_amount_check CHECK ((amount >= (0)::numeric));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoice_links_amount_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_key_ck CHECK ((key ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'::text));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_key_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_risk_ck CHECK ((risk_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_risk_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions ADD CONSTRAINT permissions_scope_ck CHECK ((scope_type = ANY (ARRAY['route'::text, 'table'::text, 'endpoint'::text, 'rpc'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] permissions_scope_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_auth_type_check CHECK ((auth_type = ANY (ARRAY['oauth'::text, 'manual'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_auth_type_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_cred_fields_check CHECK (((jsonb_typeof(cred_fields) = 'array'::text) AND (NOT (cred_fields @? '$[*]?(!(exists (@."type")) || @."type" != "password" && @."type" != "text")'::jsonpath))));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_cred_fields_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_free_shop_limit_check CHECK ((free_shop_limit >= 0));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_free_shop_limit_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_oauth_flow_check CHECK ((oauth_flow = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_oauth_flow_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_shop_list_method_check CHECK ((shop_list_method = ANY (ARRAY['GET'::text, 'POST'::text, 'PUT'::text, 'PATCH'::text, 'DELETE'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_shop_list_method_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config ADD CONSTRAINT platform_auth_config_verify_mode_check CHECK ((verify_mode = ANY (ARRAY['api'::text, 'none'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_auth_config_verify_mode_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_configs ADD CONSTRAINT platform_configs_auth_flow_check CHECK ((auth_flow = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text, 'manual'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_configs_auth_flow_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_configs ADD CONSTRAINT platform_configs_auth_state_check CHECK ((auth_state = ANY (ARRAY['ready'::text, 'not_ready'::text, 'unsupported'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_configs_auth_state_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_allocation_type_check CHECK ((allocation_type = ANY (ARRAY['none'::text, 'order_amount_ratio'::text, 'sku_quantity_ratio'::text, 'order_even'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_allocation_type_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_api_endpoint_check CHECK (((api_endpoint IS NOT NULL) AND (api_endpoint = ANY (ARRAY['token'::text, 'shop_list'::text, 'profile'::text, 'check'::text]))));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_api_endpoint_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_coverage_check CHECK ((coverage = ANY (ARRAY['auto'::text, 'manual_only'::text, 'never'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_coverage_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_manual_hint_check CHECK ((jsonb_typeof(manual_hint) = 'object'::text));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_manual_hint_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_target_column_check CHECK ((target_column = ANY (ARRAY['platform_shop_id'::text, 'region'::text, 'global_store_id'::text, 'global_store_name'::text, 'global_store_source'::text, 'shop_name'::text, 'biz_model'::text, 'seller_level'::text, 'subject_account_id'::text, 'auth_scope'::text, 'authorized_at_ts'::text, 'auth_method'::text, 'auth_group_id'::text, 'validity_days'::text, 'shop_alias'::text, 'shop_type'::text, 'group_ids'::text, 'shop_status'::text, 'sort_order'::text, 'is_new'::text, 'remark'::text, 'notify_enabled'::text, 'unbound_at'::text, 'last_checked_at'::text, 'data_source'::text, 'manual_fields'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_target_column_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map ADD CONSTRAINT platform_field_map_value_kind_check CHECK ((value_kind = ANY (ARRAY['string'::text, 'bool'::text, 'int'::text, 'timestamp'::text, 'enum'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_field_map_value_kind_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.pricing_templates ADD CONSTRAINT pricing_templates_markup_type_check CHECK ((markup_type = ANY (ARRAY['percent'::text, 'fixed'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] pricing_templates_markup_type_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.product_variants ADD CONSTRAINT product_variants_no_new CHECK (((product_id IS NULL) OR (product_id <> 'new'::text)));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] product_variants_no_new :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions ADD CONSTRAINT role_permissions_effect_ck CHECK ((effect = ANY (ARRAY['allow'::text, 'deny'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] role_permissions_effect_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles ADD CONSTRAINT roles_scope_ck CHECK ((((scope = 'platform'::text) AND (tenant_id IS NULL)) OR ((scope = 'tenant'::text) AND (tenant_id IS NULL))));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] roles_scope_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths ADD CONSTRAINT shop_auths_auth_method_check CHECK ((auth_method = ANY (ARRAY['oauth'::text, 'token'::text, 'market'::text, 'manual'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_auths_auth_method_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths ADD CONSTRAINT shop_auths_global_store_source_check CHECK ((global_store_source = ANY (ARRAY['platform'::text, 'suggested'::text, 'manual'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_auths_global_store_source_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths ADD CONSTRAINT shop_auths_status_check CHECK ((status = ANY (ARRAY['已授权'::text, '待验证'::text, '即将到期'::text, '已过期'::text, '已停用'::text, '未授权'::text, '对接中'::text, '正常'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_auths_status_check :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log ADD CONSTRAINT sub_account_audit_result_ck CHECK ((result = ANY (ARRAY['allow'::text, 'deny'::text, 'success'::text, 'error'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_audit_result_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_effect_ck CHECK ((effect = ANY (ARRAY['allow'::text, 'deny'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_effect_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts ADD CONSTRAINT sub_accounts_status_ck CHECK ((status = ANY (ARRAY['待激活'::text, '启用'::text, '停用'::text, '已离职'::text])));
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_accounts_status_ck :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.after_sales ADD CONSTRAINT after_sales_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] after_sales_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_keys ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] api_keys_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs ADD CONSTRAINT api_logs_key_id_fkey FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] api_logs_key_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs ADD CONSTRAINT api_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] api_logs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures ADD CONSTRAINT automation_failures_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_failures_rule_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures ADD CONSTRAINT automation_failures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_failures_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_rules ADD CONSTRAINT automation_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_rules_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs ADD CONSTRAINT automation_runs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_runs_rule_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs ADD CONSTRAINT automation_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] automation_runs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.bills ADD CONSTRAINT bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] bills_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.brands ADD CONSTRAINT brands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] brands_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] categories_parent_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] categories_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items ADD CONSTRAINT collect_items_claimed_shop_id_fkey FOREIGN KEY (claimed_shop_id) REFERENCES shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_items_claimed_shop_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items ADD CONSTRAINT collect_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_items_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_rules ADD CONSTRAINT collect_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_rules_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings ADD CONSTRAINT collect_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] collect_settings_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.competitor_tracks ADD CONSTRAINT competitor_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] competitor_tracks_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cost_records ADD CONSTRAINT cost_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] cost_records_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.country_tax_rates ADD CONSTRAINT country_tax_rates_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] country_tax_rates_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.exceptions ADD CONSTRAINT exceptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] exceptions_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fba_fee_tiers ADD CONSTRAINT fba_fee_tiers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fba_fee_tiers_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts ADD CONSTRAINT fee_accounts_category_id_fkey FOREIGN KEY (category_id) REFERENCES fee_categories(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_accounts_category_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts ADD CONSTRAINT fee_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_accounts_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_settings ADD CONSTRAINT fee_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fee_settings_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fees ADD CONSTRAINT fees_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fees_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.freight_forwarders ADD CONSTRAINT freight_forwarders_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] freight_forwarders_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fulfillment_plans ADD CONSTRAINT fulfillment_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fulfillment_plans_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fx_rates ADD CONSTRAINT fx_rates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] fx_rates_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inbound_orders ADD CONSTRAINT inbound_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] inbound_orders_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.income_records ADD CONSTRAINT income_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] income_records_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inventory ADD CONSTRAINT inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] inventory_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links ADD CONSTRAINT invoice_links_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoice_links_invoice_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links ADD CONSTRAINT invoice_links_payment_order_no_fkey FOREIGN KEY (payment_order_no) REFERENCES payment_orders(order_no) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] invoice_links_payment_order_no_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations ADD CONSTRAINT listing_generations_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_generations_product_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations ADD CONSTRAINT listing_generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_generations_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_logs ADD CONSTRAINT listing_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_logs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_mappings ADD CONSTRAINT listing_mappings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listing_mappings_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings ADD CONSTRAINT listings_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listings_product_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings ADD CONSTRAINT listings_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listings_shop_auth_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings ADD CONSTRAINT listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] listings_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations ADD CONSTRAINT locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] locations_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations ADD CONSTRAINT locations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] locations_warehouse_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.logistics_channels ADD CONSTRAINT logistics_channels_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] logistics_channels_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.materials ADD CONSTRAINT materials_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] materials_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.oauth_apps ADD CONSTRAINT oauth_apps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] oauth_apps_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_rules ADD CONSTRAINT order_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_rules_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_settings ADD CONSTRAINT order_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_settings_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs ADD CONSTRAINT order_sync_logs_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_sync_logs_shop_auth_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs ADD CONSTRAINT order_sync_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] order_sync_logs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] orders_shop_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] orders_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.outbound_orders ADD CONSTRAINT outbound_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] outbound_orders_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.parcels ADD CONSTRAINT parcels_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] parcels_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payables ADD CONSTRAINT payables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] payables_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_fee_account_id_fkey FOREIGN KEY (fee_account_id) REFERENCES fee_accounts(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_fee_account_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_order_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_shop_auth_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records ADD CONSTRAINT platform_fee_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] platform_fee_records_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.pricing_templates ADD CONSTRAINT pricing_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] pricing_templates_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.products ADD CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] products_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profiles_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profiles_owner_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] profiles_tenant_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items ADD CONSTRAINT purchase_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_items_order_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items ADD CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_items_product_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items ADD CONSTRAINT purchase_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_items_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_orders_supplier_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders ADD CONSTRAINT purchase_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_orders_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_plans ADD CONSTRAINT purchase_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_plans_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns ADD CONSTRAINT purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_returns_supplier_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns ADD CONSTRAINT purchase_returns_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_returns_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_suggestions ADD CONSTRAINT purchase_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] purchase_suggestions_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.receivables ADD CONSTRAINT receivables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] receivables_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.reconciliations ADD CONSTRAINT reconciliations_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] reconciliations_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] role_permissions_permission_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] role_permissions_role_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] roles_tenant_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state ADD CONSTRAINT settlement_sync_state_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] settlement_sync_state_shop_auth_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state ADD CONSTRAINT settlement_sync_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] settlement_sync_state_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments ADD CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipments_order_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments ADD CONSTRAINT shipments_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipments_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_tasks ADD CONSTRAINT shipping_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shipping_tasks_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths ADD CONSTRAINT shop_auths_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_auths_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_groups ADD CONSTRAINT shop_groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_groups_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs ADD CONSTRAINT shop_status_check_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_status_check_logs_shop_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs ADD CONSTRAINT shop_status_check_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_status_check_logs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state ADD CONSTRAINT shop_sync_state_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_sync_state_shop_auth_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state ADD CONSTRAINT shop_sync_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shop_sync_state_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shops ADD CONSTRAINT shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] shops_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sku_mappings ADD CONSTRAINT sku_mappings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sku_mappings_listing_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.source_auths ADD CONSTRAINT source_auths_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] source_auths_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.split_rules ADD CONSTRAINT split_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] split_rules_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_adjustments ADD CONSTRAINT stock_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_adjustments_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_alerts ADD CONSTRAINT stock_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_alerts_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_logs ADD CONSTRAINT stock_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_logs_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_strategies ADD CONSTRAINT stock_strategies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_strategies_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue ADD CONSTRAINT stock_sync_queue_shop_auth_fkey FOREIGN KEY (shop_auth_id) REFERENCES shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_sync_queue_shop_auth_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue ADD CONSTRAINT stock_sync_queue_sku_mappings_id_fkey FOREIGN KEY (sku_mappings_id) REFERENCES sku_mappings(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_sync_queue_sku_mappings_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_takes ADD CONSTRAINT stock_takes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] stock_takes_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log ADD CONSTRAINT sub_account_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_audit_log_actor_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log ADD CONSTRAINT sub_account_audit_log_sub_account_id_fkey FOREIGN KEY (sub_account_id) REFERENCES sub_accounts(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_audit_log_sub_account_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log ADD CONSTRAINT sub_account_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_audit_log_tenant_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_granted_by_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_permission_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions ADD CONSTRAINT sub_account_permissions_sub_account_id_fkey FOREIGN KEY (sub_account_id) REFERENCES sub_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_account_permissions_sub_account_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts ADD CONSTRAINT sub_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_accounts_auth_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts ADD CONSTRAINT sub_accounts_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES profiles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_accounts_invited_by_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts ADD CONSTRAINT sub_accounts_role_id_fkey FOREIGN KEY (role_id) REFERENCES roles(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] sub_accounts_role_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscriptions ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES subscription_plans(id);
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] subscriptions_plan_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.suppliers ADD CONSTRAINT suppliers_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] suppliers_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.traffic_stats ADD CONSTRAINT traffic_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] traffic_stats_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.warehouses ADD CONSTRAINT warehouses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] warehouses_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills ADD CONSTRAINT waybills_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] waybills_shipment_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills ADD CONSTRAINT waybills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] waybills_user_id_fkey :  %', SQLERRM; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.webhooks ADD CONSTRAINT webhooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE '[基线约束跳过] webhooks_user_id_fkey :  %', SQLERRM; END $q$;

-- 与 pg_dump 头部一致：SQL 语言函数体在建函数时不做校验，
-- 避免同名重载函数因创建先后顺序被误判为引用不存在而丢失。
SET check_function_bodies = false;

-- ---- 4. 其余对象（999 条语句：索引/约束/RLS/触发器/函数/视图/注释）----

CREATE SCHEMA IF NOT EXISTS public;

COMMENT ON SCHEMA public IS 'standard public schema';

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.allocate_fees(p_order_id text, p_mode text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_order public.orders%rowtype;
  v_lines jsonb;
  v_line jsonb;
  v_sku text; v_name text; v_qty numeric; v_price numeric; v_weight numeric;
  v_total_weight numeric := 0;
  v_src record;
  v_derived int := 0;
  v_src_updated int := 0;
  v_share numeric; v_diff numeric;
  v_max_ln int;
begin
  if p_mode not in ('none','order_amount_ratio','sku_quantity_ratio','order_even') then
    raise exception 'invalid allocation mode: %', p_mode;
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found then raise exception 'order not found: %', p_order_id; end if;
  if v_order.user_id is null or v_order.user_id is distinct from v_uid then
    raise exception 'permission denied: order not owned by caller';
  end if;

  -- 清除旧分摊衍生行
  delete from public.platform_fee_records
   where order_id = p_order_id and allocation_group_id is not null;

  if p_mode = 'none' then
    update public.platform_fee_records set allocation_type = 'none'
     where order_id = p_order_id and allocation_group_id is null and sku = '';
    return jsonb_build_object('order_id', p_order_id, 'mode', p_mode,
      'cleared', true, 'derived_rows', 0, 'source_records', 0);
  end if;

  drop table if exists tmp_alloc_ln;  -- 同事务多次调用（切换分摊方式）安全
  create temp table tmp_alloc_ln (
    ln int primary key, gkey text not null, sku text not null default '',
    name text, qty numeric, weight numeric
  ) on commit drop;

  v_lines := coalesce(v_order.items, '[]'::jsonb);
  if jsonb_typeof(v_lines) <> 'array' then v_lines := '[]'::jsonb; end if;

  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_sku  := coalesce(trim(coalesce(v_line->>'sku','')), '');
    v_name := coalesce(v_line->>'name','');
    v_qty  := greatest(0, coalesce((v_line->>'qty')::numeric, 0));
    if v_name = '' and v_sku = '' then continue; end if;
    if p_mode = 'order_even' then
      v_weight := 1;
    elsif p_mode = 'sku_quantity_ratio' then
      v_weight := v_qty;
    else -- order_amount_ratio
      v_weight := 0;
      if v_sku <> '' then
        select coalesce(
          (select price from public.product_variants
            where sku = v_sku and user_id = v_order.user_id
            order by updated_at desc nulls last limit 1),
          (select price from public.products
            where sku = v_sku and user_id = v_order.user_id limit 1),
          0) into v_price;
        v_weight := v_qty * coalesce(v_price, 0);
      end if;
      if v_weight <= 0 then v_weight := v_qty; end if;  -- 价格缺失回退按数量
    end if;
    if v_weight <= 0 then v_weight := 1; end if;
    -- 合并权重：有 SKU 按 SKU 合并；无 SKU 行按「行名」独立成组
    update tmp_alloc_ln set weight = weight + v_weight, qty = qty + v_qty
     where gkey = (case when v_sku <> '' then 'sku:' || v_sku else 'ln:' || v_name end)
       and (v_sku <> '' or name = v_name);
    if not found then
      insert into tmp_alloc_ln(ln, gkey, sku, name, qty, weight)
      values ((select coalesce(max(ln),0)+1 from tmp_alloc_ln),
              case when v_sku <> '' then 'sku:' || v_sku else 'ln:' || v_name end,
              v_sku, v_name, v_qty, v_weight);
    end if;
  end loop;

  select coalesce(sum(weight),0) into v_total_weight from tmp_alloc_ln;
  if (select count(*) from tmp_alloc_ln) = 0 or v_total_weight <= 0 then
    raise exception '订单无可分摊的 SKU 行（items 为空或权重全 0）';
  end if;

  for v_src in
    select * from public.platform_fee_records
     where order_id = p_order_id and sku = '' and allocation_group_id is null
     order by created_at asc
  loop
    -- 每个费用记录重新计算分摊（临时表先清后建，避免同事务重复建表报错）
    drop table if exists tmp_alloc_share;
    create temp table tmp_alloc_share (ln int primary key, share numeric) on commit drop;
    insert into tmp_alloc_share(ln, share)
      select t.ln, round(v_src.amount * t.weight / v_total_weight, 2) from tmp_alloc_ln t;
    -- 尾差补到权重最大行，保证 Σ分摊 = 原费用额
    select s.ln into v_max_ln
      from tmp_alloc_share s join tmp_alloc_ln t using (ln)
      order by t.weight desc, t.ln asc limit 1;
    select coalesce(sum(share),0) into v_diff from tmp_alloc_share;
    v_diff := v_src.amount - v_diff;
    update tmp_alloc_share set share = share + v_diff where ln = v_max_ln;

    for v_line in
      select to_jsonb(t) || jsonb_build_object('share', s.share) as row
      from tmp_alloc_ln t join tmp_alloc_share s using (ln) order by t.ln
    loop
      v_share := (v_line->>'share')::numeric;
      if v_share = 0 then continue; end if;
      insert into public.platform_fee_records
        (user_id, shop_auth_id, platform, order_id, platform_order_no, fee_account_id,
         sku, item_name, amount, currency, raw, occurred_at, allocation_type, allocation_group_id)
      values (
        v_order.user_id, v_src.shop_auth_id, v_src.platform, p_order_id, v_src.platform_order_no,
        v_src.fee_account_id, v_line->>'sku', coalesce(v_line->>'name',''),
        v_share, v_src.currency,
        jsonb_build_object('allocated_from', v_src.id, 'allocation', p_mode,
          'weight', (v_line->>'weight')::numeric, 'qty', (v_line->>'qty')::numeric,
          'source_amount', v_src.amount),
        v_src.occurred_at, p_mode, v_src.id);
      v_derived := v_derived + 1;
    end loop;

    update public.platform_fee_records set allocation_type = p_mode, synced_at = now()
     where id = v_src.id;
    v_src_updated := v_src_updated + 1;
  end loop;

  return jsonb_build_object('order_id', p_order_id, 'mode', p_mode, 'cleared', false,
    'lines', (select count(*) from tmp_alloc_ln), 'total_weight', v_total_weight,
    'derived_rows', v_derived, 'source_records', v_src_updated);
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.deduct_inventory_on_ship() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_agg  jsonb := '{}'::jsonb;  -- sku -> 合并后的扣减数量
  v_item jsonb;
  v_sku  text;
  v_key  text;
  v_qty  integer;
  v_raw  numeric;
  v_any  boolean := false;      -- items 中是否存在有效 sku 条目
BEGIN
  IF NEW.status = '已发货' AND OLD.status IS DISTINCT FROM '已发货' THEN
    -- ── 解析 items：合并同 sku 数量 ──
    BEGIN
      IF jsonb_typeof(NEW.items) = 'array' THEN
        FOR v_item IN SELECT jsonb_array_elements(NEW.items) LOOP
          CONTINUE WHEN jsonb_typeof(v_item) IS DISTINCT FROM 'object';
          v_sku := btrim(COALESCE(v_item->>'sku', ''));
          CONTINUE WHEN v_sku = '';
          IF jsonb_typeof(v_item->'qty') = 'number' THEN
            v_raw := (v_item->'qty')::text::numeric;
            v_qty := CASE WHEN v_raw > 0 AND v_raw = floor(v_raw) THEN v_raw::int ELSE 1 END;
          ELSE
            v_qty := 1;  -- qty 缺失/非数字：视为 1
          END IF;
          v_agg := jsonb_set(v_agg, ARRAY[v_sku],
                   to_jsonb(COALESCE((v_agg->>v_sku)::int, 0) + v_qty));
          v_any := true;
        END LOOP;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      -- 解析失败：清空聚合，走降级兜底，不报错中断发货
      v_agg := '{}'::jsonb;
      v_any := false;
    END;

    -- ── 兜底：无任何有效条目时按 NEW.sku 扣 1（保持旧行为） ──
    IF NOT v_any THEN
      IF COALESCE(NEW.sku, '') <> '' THEN
        v_agg := jsonb_build_object(NEW.sku, 1);
      ELSE
        v_agg := '{}'::jsonb;  -- 无 sku 无有效 items：无从扣减，诚实跳过
      END IF;
    END IF;

    -- ── 逐 sku 扣减：inventory.available + products.stock 双联动 ──
    FOR v_key, v_qty IN SELECT key, (value #>> '{}')::int FROM jsonb_each(v_agg) LOOP
      UPDATE public.inventory
      SET available = GREATEST(available - v_qty, 0), updated_at = now()
      WHERE sku = v_key AND user_id = NEW.user_id;

      UPDATE public.products
      SET stock = GREATEST(stock - v_qty, 0), updated_at = now()
      WHERE user_id = NEW.user_id
        AND id = COALESCE(
          (SELECT product_id FROM public.product_variants WHERE sku = v_key AND user_id = NEW.user_id LIMIT 1),
          (SELECT id FROM public.products WHERE sku = v_key AND user_id = NEW.user_id LIMIT 1));
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_automation_execute(p_rule public.automation_rules, p_title text, p_content text, p_result text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_run_id uuid;
  v_start  timestamptz;
BEGIN
  v_start := clock_timestamp();

  INSERT INTO automation_runs(user_id, rule_id, trigger_at, status, result, duration_ms)
  VALUES (p_rule.user_id, p_rule.id, now(), '成功', p_result, 0)
  RETURNING id INTO v_run_id;

  UPDATE automation_rules SET last_run_at = now() WHERE id = p_rule.id;

  INSERT INTO notifications(user_id, title, content, type)
  VALUES (p_rule.user_id, p_title, p_content, '自动化');

  UPDATE automation_runs
     SET duration_ms = greatest(0, (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int)
   WHERE id = v_run_id;
EXCEPTION WHEN OTHERS THEN
  BEGIN
    IF v_run_id IS NOT NULL THEN
      UPDATE automation_runs
         SET status = '失败',
             result = '执行失败: ' || SQLERRM,
             duration_ms = greatest(0, (extract(epoch FROM (clock_timestamp() - v_start)) * 1000)::int)
       WHERE id = v_run_id;
    END IF;
    INSERT INTO automation_failures(user_id, run_id, rule_id, error, retries)
    VALUES (p_rule.user_id, v_run_id, p_rule.id, SQLERRM, 0);
  EXCEPTION WHEN OTHERS THEN
    NULL; -- 兜底：记录失败本身失败时静默，绝不阻断业务写入
  END;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_automation_on_order() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r automation_rules; v_uid uuid; v_min numeric; v_shop text; v_content text;
BEGIN
  v_uid := NEW.user_id;
  IF v_uid IS NULL AND NEW.shop_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM shops WHERE id = NEW.shop_id LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = v_uid AND trigger = '订单创建'
               AND status = '启用' AND enabled = true
  LOOP
    IF r.condition IS NOT NULL AND r.condition ~ '[0-9]' THEN
      v_min := (regexp_match(r.condition, '([0-9]+(\.[0-9]+)?'))[1]::numeric;
      IF NEW.amount < v_min THEN CONTINUE; END IF;
    END IF;
    v_shop := coalesce(nullif(NEW.shop_name, ''), '-');
    v_content := 'notif.c.autoOrder::' || jsonb_build_array(
      NEW.id, coalesce(nullif(NEW.buyer, ''), '-'), NEW.currency, NEW.amount::text, v_shop,
      coalesce(nullif(NEW.product, ''), '-'))::text;
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoOrder', v_content,
      'notif.r.autoOrder::' || jsonb_build_array(NEW.id::text, NEW.currency, NEW.amount::text, v_shop)::text);
  END LOOP;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_automation_on_stock() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  r automation_rules; v_uid uuid; v_threshold numeric; v_email text; v_secret text;
BEGIN
  v_uid := NEW.user_id;
  IF v_uid IS NULL AND NEW.shop_id IS NOT NULL THEN
    SELECT user_id INTO v_uid FROM shops WHERE id = NEW.shop_id LIMIT 1;
  END IF;
  IF v_uid IS NULL THEN RETURN NEW; END IF;

  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = v_uid AND trigger = '库存低于阈值'
               AND status = '启用' AND enabled = true
  LOOP
    v_threshold := 10;
    IF r.condition ~ '[0-9]' THEN
      v_threshold := (regexp_match(r.condition, '([0-9]+)'))[1]::numeric;
    END IF;
    IF TG_OP = 'INSERT' THEN
      CONTINUE WHEN NEW.stock >= v_threshold;
    ELSE
      CONTINUE WHEN NOT (coalesce(OLD.stock, 0) >= v_threshold AND NEW.stock < v_threshold);
    END IF;
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoStock',
      'notif.c.autoStock::' || jsonb_build_array(NEW.sku, NEW.stock::text, coalesce(NEW.name, '-'))::text,
      'notif.r.autoStock::' || jsonb_build_array(NEW.sku, NEW.stock::text)::text);

    -- 邮件渠道补齐（pg_net 异步；24h 同场景去重由 mailer dedupeHours 保证，失败不阻塞）
    SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
    v_secret := nullif(current_setting('app.mailer_secret', true), '');
    IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
      BEGIN
        PERFORM net.http_post(
          url := 'http://kong:8000/functions/v1/mailer',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'x-mailer-secret', v_secret
          ),
          body := jsonb_build_object(
            'action', 'send',
            'scene', 'stock_alert',
            'email', v_email,
            'lang', 'zh',
            'dedupeHours', 24,
            'vars', jsonb_build_object(
              'sku', NEW.sku,
              'name', coalesce(NEW.name, '-'),
              'stock', NEW.stock::text
            )
          )
        );
      EXCEPTION WHEN OTHERS THEN NULL; -- 邮件失败不阻断库存事务
      END;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_automation_on_waybill() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  r automation_rules; v_no text;
BEGIN
  v_no := coalesce(nullif(NEW.tracking_no, ''), nullif(NEW.waybill_no, ''), NEW.id::text);
  FOR r IN SELECT * FROM automation_rules
             WHERE user_id = NEW.user_id AND trigger = '物流异常'
               AND status = '启用' AND enabled = true
  LOOP
    PERFORM public.fn_automation_execute(r, 'notif.gen.autoWaybill',
      'notif.c.autoWaybill::' || jsonb_build_array(v_no, coalesce(nullif(NEW.carrier, ''), '-'), NEW.status)::text,
      'notif.r.autoWaybill::' || jsonb_build_array(v_no, NEW.status)::text);
  END LOOP;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_automation_seed_defaults() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO automation_rules(user_id, name, trigger, condition, action, workflow_def, enabled, status) VALUES
    (NEW.id, 'auto.seed.orderCreated',     '订单创建',     '',          '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.lowStock',         '库存低于阈值', '库存 < 10', '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.logistics',        '物流异常', '',     '发送站内通知', '{"preset":true}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditRecipient',   '自动审单', '姓名/电话/地址非空',                  '拦截发货并通知', '{"preset":true,"audit_code":"recipient"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditInventory',   '自动审单', 'inventory.available ≥ 订单各 SKU 数量', '拦截发货并通知', '{"preset":true,"audit_code":"inventory"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditAmount',      '自动审单', 'order.amount > 0',                    '拦截发货并通知', '{"preset":true,"audit_code":"amount"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditDupShip',     '自动审单', '订单已存在未取消运单',              '拦截发货并通知', '{"preset":true,"audit_code":"dup_ship"}'::jsonb, true, '启用'),
    (NEW.id, 'auto.seed.auditShopAuth',    '自动审单', '店铺状态=已授权 且 token 未过期',       '拦截发货并通知', '{"preset":true,"audit_code":"shop_auth"}'::jsonb, true, '启用');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- 预置失败不阻断注册
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_guard_invoice_status() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF NEW.status = 'issued' AND OLD.status <> 'issued'
     AND current_user NOT IN ('service_role','supabase_admin','postgres')
     AND NOT has_role(auth.uid(), 'admin'::text) THEN
    RAISE EXCEPTION 'only admins can issue invoices';
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_invoice_guard_columns() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF current_user IN ('service_role','supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    NEW.amount := OLD.amount;
    NEW.content := OLD.content;
    NEW.order_nos := OLD.order_nos;
    NEW.invoice_no := OLD.invoice_no;
    NEW.issued_at := OLD.issued_at;
    NEW.file_url := OLD.file_url;
    NEW.user_id := OLD.user_id;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoice update not allowed for current role';
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_invoice_insert_guard() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF current_user IN ('service_role','supabase_admin','postgres') THEN
    RETURN NEW;
  END IF;
  IF has_role(auth.uid(), 'admin') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'invoices must be created via request_invoice rpc';
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_invoice_links_cleanup() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
BEGIN
  IF NEW.status IN ('void','rejected') AND OLD.status NOT IN ('void','rejected') THEN
    DELETE FROM public.invoice_links WHERE invoice_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_notify_waybill_shipped() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth'
    AS $$
DECLARE
  v_email text; v_secret text; v_no text; v_carrier text;
BEGIN
  v_no := coalesce(nullif(NEW.tracking_no, ''), nullif(NEW.waybill_no, ''), NEW.id::text);
  v_carrier := coalesce(nullif(NEW.carrier, ''), '-');
  -- 站内通知
  INSERT INTO notifications(user_id, title, content, type)
  VALUES (NEW.user_id, 'notif.gen.waybillShipped',
    'notif.c.waybillShipped::' || jsonb_build_array(v_no, v_carrier, NEW.status)::text, '物流');
  -- 邮件（pg_net 异步，失败不阻塞发货事务）
  SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    BEGIN
      PERFORM net.http_post(
        url := 'http://kong:8000/functions/v1/mailer',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-mailer-secret', v_secret
        ),
        body := jsonb_build_object(
          'action', 'send',
          'scene', 'order_shipped',
          'email', v_email,
          'lang', 'zh',
          'vars', jsonb_build_object(
            'waybillNo', v_no,
            'carrier', v_carrier,
            'status', NEW.status
          )
        )
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW; -- 通知失败不阻断运单写入
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_pricing_template_default_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.is_default THEN
    UPDATE public.pricing_templates
       SET is_default = false, updated_at = now()
     WHERE user_id = NEW.user_id AND id <> NEW.id AND is_default;
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.fn_pricing_templates_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.gotrue_send_sms_hook(input jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'net'
    AS $$
DECLARE
  hook_secret text;
BEGIN
  SELECT value INTO hook_secret FROM private.gotrue_hooks WHERE key = 'sms_hook';

  PERFORM net.http_post(
    url := 'http://envoy:8000/functions/v1/gotrue-sms',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-internal-hook', COALESCE(hook_secret, '')
    ),
    body := input
  );

  RETURN '{"messages":[{"status":"sent"}]}'::jsonb;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'gotrue_send_sms_hook error: %', SQLERRM;
  RETURN '{"messages":[{"status":"failed"}]}'::jsonb;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.grant_new_user_free_quota() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.ai_free_quotas (user_id, image_translate_free)
  VALUES (NEW.id, 5)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  free_plan_id uuid;
BEGIN
  INSERT INTO public.profiles (id, username)
  VALUES (
    NEW.id,
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'username', ''),
      split_part(coalesce(NEW.email, ''), '@', 1),
      'user_' || replace(NEW.id::text, '-', '')
    )
  )
  ON CONFLICT (id) DO NOTHING;

  -- AI 额度账户（balance 为该租户可用余额，单位：元）
  IF NOT EXISTS (SELECT 1 FROM public.tenant_quotas q WHERE q.user_id = NEW.id) THEN
    INSERT INTO public.tenant_quotas (user_id, balance, plan_name)
    VALUES (NEW.id, 0, '');
  END IF;

  -- 默认免费版订阅
  SELECT id INTO free_plan_id FROM public.subscription_plans WHERE plan_key = 'free' LIMIT 1;
  IF free_plan_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.subscriptions s WHERE s.user_id = NEW.id) THEN
    INSERT INTO public.subscriptions (user_id, plan_id, plan_name, amount, status, started_at)
    VALUES (NEW.id, free_plan_id, '免费版', 0, 'active', now());
  END IF;

  RETURN NEW;
EXCEPTION WHEN unique_violation THEN
  INSERT INTO public.profiles (id, username)
  VALUES (NEW.id, 'user_' || replace(NEW.id::text, '-', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.has_perm(p_key text) RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tenant_role text;
  v_role_id uuid;
  v_perm_id uuid;
  v_role_allow boolean := false;
  v_role_deny boolean := false;
  v_sub_allow boolean := false;
  v_sub_deny boolean := false;
begin
  if v_uid is null or p_key is null then
    return false;
  end if;

  -- ① 平台超管绕过（profiles.role='admin'，沿用既有 has_role）
  if public.has_role(v_uid, 'admin') then
    return true;
  end if;

  select p.owner_id, p.tenant_role into v_owner, v_tenant_role
    from public.profiles p where p.id = v_uid;

  if v_owner is null then
    -- ② 租户主账号（owner）：按 spec §4.2 owner 行（内置 owner 角色；G18 后台不可见、G20/G21 仅 view）
    select r.id into v_role_id from public.roles r where r.key = 'owner' and r.is_builtin;
  else
    -- ③ 子账号：优先 sub_accounts.role_id，其次 profiles.tenant_role 回退
    select sa.role_id into v_role_id
      from public.sub_accounts sa
     where sa.auth_user_id = v_uid and sa.status = '启用';
    if v_role_id is null then
      select r.id into v_role_id from public.roles r where r.key = v_tenant_role and r.is_builtin;
    end if;
  end if;

  select p.id into v_perm_id from public.permissions p where p.key = p_key and p.is_active;
  if v_perm_id is null then
    return false;
  end if;

  if v_role_id is not null then
    select coalesce(bool_or(rp.effect = 'allow'), false),
           coalesce(bool_or(rp.effect = 'deny'), false)
      into v_role_allow, v_role_deny
      from public.role_permissions rp
     where rp.role_id = v_role_id and rp.permission_id = v_perm_id;
  end if;

  if v_owner is not null then
    select coalesce(bool_or(sp.effect = 'allow'), false),
           coalesce(bool_or(sp.effect = 'deny'), false)
      into v_sub_allow, v_sub_deny
      from public.sub_account_permissions sp
     where sp.permission_id = v_perm_id
       and sp.sub_account_id in (select sa.id from public.sub_accounts sa where sa.auth_user_id = v_uid);
  end if;

  -- 优先级判定
  if v_sub_deny then  return false; end if;
  if v_sub_allow then return true;  end if;
  if v_role_deny then return false; end if;
  return v_role_allow;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

COMMENT ON FUNCTION public.has_perm(p_key text) IS '唯一权威权限判定入口。平台超管 > 子账号 deny > 子账号 allow > 角色 deny > 角色 allow > 默认 deny。spec §7.4';

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND role = _role
  );
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.invoiceable_orders(p_user_id uuid) RETURNS TABLE(order_no text, amount numeric, paid_at timestamp with time zone, package_code text)
    LANGUAGE sql STABLE
    AS $$
  select po.order_no, po.amount, po.paid_at, po.package_code
  from public.payment_orders po
  where po.user_id = p_user_id
    and po.status = 'paid'
    and not exists (
      select 1 from public.invoices i
      where i.user_id = po.user_id
        and i.status in ('pending','issued')
        and i.order_nos ? po.order_no
    )
  order by po.paid_at desc nulls last;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.listings_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin new.updated_at = now(); return new; end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.my_permissions() RETURNS SETOF text
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_tenant_role text;
  v_role_id uuid;
begin
  if v_uid is null then
    return;
  end if;

  if public.has_role(v_uid, 'admin') then
    return query select p.key from public.permissions p where p.is_active order by p.key;
    return;
  end if;

  select p.owner_id, p.tenant_role into v_owner, v_tenant_role
    from public.profiles p where p.id = v_uid;

  if v_owner is null then
    select r.id into v_role_id from public.roles r where r.key = 'owner' and r.is_builtin;
  else
    select sa.role_id into v_role_id
      from public.sub_accounts sa
     where sa.auth_user_id = v_uid and sa.status = '启用';
    if v_role_id is null then
      select r.id into v_role_id from public.roles r where r.key = v_tenant_role and r.is_builtin;
    end if;
  end if;

  return query
    select p.key
      from public.permissions p
     where p.is_active
       and ( (v_role_id is not null and exists (
                select 1 from public.role_permissions rp
                 where rp.role_id = v_role_id and rp.permission_id = p.id and rp.effect = 'allow'))
             or (v_owner is not null and exists (
                select 1 from public.sub_account_permissions sp
                 where sp.permission_id = p.id and sp.effect = 'allow'
                   and sp.sub_account_id in (select sa.id from public.sub_accounts sa where sa.auth_user_id = v_uid))) )
       and not exists (
                select 1 from public.sub_account_permissions sp
                 where sp.permission_id = p.id and sp.effect = 'deny'
                   and sp.sub_account_id in (select sa.id from public.sub_accounts sa where sa.auth_user_id = v_uid))
       and not exists (
                select 1 from public.role_permissions rp
                 where rp.role_id = v_role_id and rp.permission_id = p.id and rp.effect = 'deny')
     order by p.key;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.next_invoice_no() RETURNS text
    LANGUAGE plpgsql
    AS $$
declare
  d   text := to_char(now() at time zone 'Asia/Shanghai', 'YYYYMMDD');
  n   bigint;
begin
  n := nextval('public.invoice_no_seq');
  return 'INV' || d || lpad(n::text, 4, '0');
end;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_bill_due() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.due_date IS NOT NULL AND NEW.status = '待支付' AND NEW.amount > 0 THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.billDue',
      'notif.c.billDue::' || jsonb_build_array(
        NEW.id::text, NEW.amount::text, to_char(NEW.due_date, 'YYYY-MM-DD'))::text,
      '财务'
    );
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_inventory_low() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND NEW.available < NEW.safety_stock)
     OR (TG_OP = 'UPDATE' AND NEW.available < NEW.safety_stock AND OLD.available >= OLD.safety_stock) THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.inventoryLow',
      'notif.c.invLow::' || jsonb_build_array(
        coalesce(NEW.name, '-'), coalesce(NEW.sku, '-'),
        NEW.available::text, NEW.safety_stock::text)::text,
      '库存');
  END IF;
  RETURN NEW;
END; $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_order_abnormal() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.status = '售后中' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.orderAbnormal',
      'notif.c.orderAftersale::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text,
      '订单'
    );
  END IF;
  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_order_created() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    NEW.user_id,
    'notif.gen.orderCreated',
    'notif.c.orderCreated::' || jsonb_build_array(
      coalesce(nullif(NEW.channel, ''), '-'),
      coalesce(nullif(NEW.shop_name, ''), '-'),
      coalesce(nullif(NEW.buyer, ''), '-'),
      coalesce(nullif(NEW.product, ''), '-'),
      coalesce(NEW.currency, '-'),
      NEW.amount::text)::text,
    '订单');
  RETURN NEW;
END; $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.notify_order_status_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  -- 只有 status 真正变了才发
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = '待发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderPendingShipment',
      'notif.c.orderPay::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status = '已发货' OR NEW.status = '部分发货' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderShipped',
      'notif.c.orderShipped::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status = '已完成' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCompleted',
      'notif.c.orderDone::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.amount::text)::text, '订单');
  ELSIF NEW.status = '已取消' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderCancelled',
      'notif.c.orderCancel::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  ELSIF NEW.status IN ('售后中', '退款中', '退款完成') THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderAfterSale',
      'notif.c.orderAfterSaleSt::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.status)::text, '订单');
  ELSIF NEW.status = '付款成功' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderPaid',
      'notif.c.orderPaid::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'), NEW.amount::text)::text, '订单');
  ELSIF NEW.status = '已到仓' THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (NEW.user_id, 'notif.gen.orderArrived',
      'notif.c.orderArrived::' || jsonb_build_array(NEW.id::text, coalesce(nullif(NEW.buyer, ''), '-'))::text, '订单');
  END IF;

  RETURN NEW;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.on_auth_user_seed_fees() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  perform public.seed_fee_accounts(new.id);
  return new;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.order_list_guarded(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS SETOF public.orders
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: order module requires login' using errcode = '42501';
  end if;
  if not public.has_perm('order.order.view') then
    perform public.rbac_write_audit(v_uid, 'order.order.view', 'order.list', 'deny', 'orders', jsonb_build_object('phase', 'guard'));
    raise exception 'PERMISSION_DENIED: order.order.view' using errcode = '42501';
  end if;
  return query
    select o.* from public.orders o
     where o.user_id = public.tenant_root(v_uid)
     order by o.created_at desc nulls last
     limit greatest(1, least(coalesce(p_limit, 50), 500))
     offset greatest(0, coalesce(p_offset, 0));
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.order_update_remark_guarded(p_order_id text, p_remark text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_hit text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: order module requires login' using errcode = '42501';
  end if;
  if not public.has_perm('order.order.remark') then
    perform public.rbac_write_audit(v_uid, 'order.order.remark', 'order.remark', 'deny', p_order_id, jsonb_build_object('phase', 'guard'));
    raise exception 'PERMISSION_DENIED: order.order.remark' using errcode = '42501';
  end if;
  update public.orders o set remark = coalesce(p_remark, '')
   where o.id = p_order_id and o.user_id = public.tenant_root(v_uid)
  returning o.id into v_hit;
  if v_hit is null then
    raise exception 'ORDER_NOT_FOUND: %', p_order_id using errcode = 'P0002';
  end if;
  perform public.rbac_write_audit(v_uid, 'order.order.remark', 'order.remark', 'allow', v_hit, jsonb_build_object('phase', 'guard'));
  return jsonb_build_object('ok', true, 'order_id', v_hit, 'remark', coalesce(p_remark, ''));
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.order_update_status_guarded(p_order_id text, p_status text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_hit text;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED: order module requires login' using errcode = '42501';
  end if;
  if not public.has_perm('order.order.edit') then
    perform public.rbac_write_audit(v_uid, 'order.order.edit', 'order.status', 'deny', p_order_id, jsonb_build_object('phase', 'guard'));
    raise exception 'PERMISSION_DENIED: order.order.edit' using errcode = '42501';
  end if;
  update public.orders o set status = p_status
   where o.id = p_order_id and o.user_id = public.tenant_root(v_uid)
  returning o.id into v_hit;
  if v_hit is null then
    raise exception 'ORDER_NOT_FOUND: %', p_order_id using errcode = 'P0002';
  end if;
  perform public.rbac_write_audit(v_uid, 'order.order.edit', 'order.status', 'allow', v_hit, jsonb_build_object('phase', 'guard', 'status', p_status));
  return jsonb_build_object('ok', true, 'order_id', v_hit, 'status', p_status);
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.purchase_inbound(p_order_id uuid, p_items jsonb DEFAULT '[]'::jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  v_order public.purchase_orders;
  v_item jsonb;
  v_item_id uuid;
  v_qty integer;
  v_price numeric;
  v_product_id text;
  v_stock_updated integer := 0;
  v_cost_updated integer := 0;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION '未登录';
  END IF;

  SELECT * INTO v_order FROM public.purchase_orders
    WHERE id = p_order_id AND user_id = v_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION '采购单不存在';
  END IF;
  IF v_order.status IN ('已入库', '已取消') THEN
    RAISE EXCEPTION '采购单已是终态（%）', v_order.status;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_items) = 'array' THEN p_items ELSE '[]'::jsonb END)
  LOOP
    v_item_id := (v_item->>'item_id')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'received_qty', '')::integer, NULL);
    v_price := NULLIF(v_item->>'price', '')::numeric;
    IF v_item_id IS NULL THEN CONTINUE; END IF;

    UPDATE public.purchase_items
      SET received_qty = COALESCE(v_qty, received_qty, qty),
          price = COALESCE(v_price, price)
      WHERE id = v_item_id AND order_id = p_order_id AND user_id = v_user;
    IF NOT FOUND THEN CONTINUE; END IF;

    IF COALESCE(v_qty, 0) > 0 THEN
      SELECT product_id INTO v_product_id FROM public.purchase_items WHERE id = v_item_id;
      IF v_product_id IS NOT NULL THEN
        UPDATE public.products
          SET stock = stock + v_qty,
              cost = CASE WHEN COALESCE(v_price, 0) > 0 THEN v_price ELSE cost END,
              updated_at = now()
          WHERE id = v_product_id AND user_id = v_user;
        IF FOUND THEN
          v_stock_updated := v_stock_updated + 1;
          IF COALESCE(v_price, 0) > 0 THEN v_cost_updated := v_cost_updated + 1; END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  UPDATE public.purchase_orders
    SET status = '已入库', inbound_at = now(), updated_at = now()
    WHERE id = p_order_id AND user_id = v_user;

  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_user,
    'notif.gen.poInbound',
    'notif.c.poInbound::' || jsonb_build_array(
      v_order.po_no, v_stock_updated::text, v_cost_updated::text)::text,
    '采购'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'po_no', v_order.po_no,
    'stock_updated', v_stock_updated,
    'cost_updated', v_cost_updated
  );
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.rbac_write_audit(p_actor uuid, p_perm_key text, p_action text, p_result text, p_target text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tenant uuid;
  v_sub uuid;
begin
  v_tenant := public.tenant_root(p_actor);
  if v_tenant is null then
    return;
  end if;
  select sa.id into v_sub from public.sub_accounts sa where sa.auth_user_id = p_actor limit 1;
  insert into public.sub_account_audit_log
    (tenant_id, actor_id, sub_account_id, action, target, result, detail)
  values
    (v_tenant, p_actor, v_sub, p_action, coalesce(p_target, p_perm_key), p_result,
     coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('perm_key', p_perm_key));
exception when others then
  null;  -- 审计失败不阻断业务主流程
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.rbac_write_audit_durable(p_actor uuid, p_perm_key text, p_action text, p_result text, p_target text, p_detail jsonb DEFAULT '{}'::jsonb) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_tenant uuid;
  v_sub uuid;
  v_sql text;
  v_ok boolean := false;
begin
  begin
    v_tenant := public.tenant_root(p_actor);
    if v_tenant is null then
      return false;
    end if;
    select sa.id into v_sub from public.sub_accounts sa where sa.auth_user_id = p_actor limit 1;
    v_sql := format(
      'insert into public.sub_account_audit_log (tenant_id, actor_id, sub_account_id, action, target, result, detail) values (%L::uuid, %L::uuid, %L::uuid, %L, %L, %L, %L::jsonb)',
      v_tenant, p_actor, v_sub,
      coalesce(p_action, ''), coalesce(p_target, p_perm_key), coalesce(p_result, 'deny'),
      (coalesce(p_detail, '{}'::jsonb) || jsonb_build_object('perm_key', p_perm_key))::text
    );
    perform public.dblink_exec(
      'dbname=' || current_database() || ' options=''-c statement_timeout=3000''',
      v_sql
    );
    v_ok := true;
  exception when others then
    v_ok := false;  -- 独立连接写入失败 → 返回 false，调用方回退到事务内写入
  end;
  return v_ok;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.request_invoice(p_order_nos text[], p_invoice_type text DEFAULT 'normal'::text, p_title_type text DEFAULT 'personal'::text, p_title text DEFAULT NULL::text, p_tax_no text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_remark text DEFAULT NULL::text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $_$
DECLARE
  v_user uuid := auth.uid();
  v_amount numeric;
  v_content text;
  v_invoice_id uuid;
  v_valid_cnt int;
  v_orders text[];
  v_user_email text;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_order_nos IS NULL OR cardinality(p_order_nos) = 0 THEN
    RAISE EXCEPTION 'no payment orders selected';
  END IF;
  -- 去重，防同一单重复计费
  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_orders FROM unnest(p_order_nos) AS x;
  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'invoice title is required';
  END IF;
  IF length(btrim(p_title)) > 200 THEN
    RAISE EXCEPTION '发票抬头不能超过200字';
  END IF;
  IF p_invoice_type NOT IN ('normal','special') THEN
    RAISE EXCEPTION 'invalid invoice type';
  END IF;
  IF p_title_type NOT IN ('personal','corporate') THEN
    RAISE EXCEPTION 'invalid title type';
  END IF;
  -- 企业抬头：税号必填，且须为 15/18/20 位统一社会信用代码（与前端 TAX_NO_RE 一致，18 位字符集已兼容 Q 开头老规则）
  IF p_title_type = 'corporate' THEN
    IF p_tax_no IS NULL OR btrim(p_tax_no) = '' THEN
      RAISE EXCEPTION '企业抬头必须填写税号';
    END IF;
    IF upper(btrim(p_tax_no)) !~ '^(?:[0-9A-Z]{15}|[0-9A-HJ-NPQRTUWXY]{18}|[0-9A-Z]{20})$' THEN
      RAISE EXCEPTION '税号格式不正确：统一社会信用代码为 15/18/20 位大写字母数字';
    END IF;
  END IF;
  -- 邮箱：电子发票交付通道，企业/个人抬头均必填且须符合邮箱格式
  IF p_email IS NULL OR btrim(p_email) = '' THEN
    RAISE EXCEPTION '请填写接收邮箱，电子发票将发送至该邮箱';
  END IF;
  IF btrim(p_email) !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION '邮箱格式不正确';
  END IF;
  -- 备注：选填，超长拒绝
  IF p_remark IS NOT NULL AND length(btrim(p_remark)) > 500 THEN
    RAISE EXCEPTION '备注不能超过500字';
  END IF;

  -- 校验：全部勾选单必须属于本人 + paid + 未被活动发票占用
  SELECT count(*) INTO v_valid_cnt
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid'
  LEFT JOIN public.invoice_links l ON l.payment_order_no = po.order_no
  LEFT JOIN public.invoices i ON i.id = l.invoice_id AND i.status IN ('pending','issued')
  WHERE i.id IS NULL;
  IF v_valid_cnt <> cardinality(v_orders) THEN
    RAISE EXCEPTION 'some payment orders are invalid or already invoiced';
  END IF;

  -- 金额：服务端计算，不信任前端
  SELECT round(coalesce(sum(po.amount), 0), 2) INTO v_amount
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';
  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invoice amount must be positive';
  END IF;

  -- 开票内容：按用途自动映射（优先级 订阅 > 平台授权 > 积分 > 兜底）
  SELECT CASE
    WHEN bool_or(po.plan_id IS NOT NULL) THEN '软件订阅服务费'
    WHEN bool_or(po.package_code IS NOT NULL AND po.package_code NOT LIKE 'credits%') THEN '平台技术服务费'
    WHEN bool_or(po.package_code LIKE 'credits%' OR po.credits_granted IS NOT NULL) THEN '平台积分充值'
    ELSE '信息技术服务费'
  END INTO v_content
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';

  -- 写入发票（pending，票号/开票状态由管理员后续操作）；税号统一大写
  INSERT INTO public.invoices
    (user_id, invoice_type, title_type, title, tax_no, amount, content, email, remark, status, order_nos)
  VALUES (
    v_user, p_invoice_type, p_title_type, btrim(p_title),
    nullif(upper(btrim(coalesce(p_tax_no, ''))), ''),
    v_amount, v_content,
    nullif(btrim(coalesce(p_email, '')), ''),
    nullif(btrim(coalesce(p_remark, '')), ''),
    'pending', to_jsonb(v_orders)
  ) RETURNING id INTO v_invoice_id;

  -- 写入关联（UNIQUE(payment_order_no) 兜底并发重复占用）
  INSERT INTO public.invoice_links (invoice_id, payment_order_no, user_id, amount)
  SELECT v_invoice_id, po.order_no, v_user, po.amount
  FROM unnest(v_orders) AS w(order_no)
  JOIN public.payment_orders po
    ON po.order_no = w.order_no AND po.user_id = v_user AND po.status = 'paid';

  -- 通知所有管理员：收到新开票申请（站内；admin 账号邮箱为测试域，不发邮件）
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user;
  INSERT INTO public.notifications (user_id, title, content, type)
  SELECT p.id,
         'notif.gen.invoiceNewRequest',
         'notif.c.invReq::' || jsonb_build_array(
            coalesce((SELECT username FROM public.profiles WHERE id = v_user), v_user::text),
            coalesce(v_user_email, '-'),
            to_char(v_amount, 'FM999999990.00'),
            btrim(p_title),
            cardinality(v_orders)::text)::text,
         '发票'
  FROM public.profiles p
  WHERE p.role = 'admin';

  RETURN v_invoice_id;
END;
$_$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.request_invoice_issue(p_invoice_id uuid, p_invoice_no text, p_file_url text DEFAULT NULL::text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  -- SECURITY DEFINER 下 current_user 已是函数 owner，不能用 current_user 判断调用者；
  -- 必须凭 JWT claims 的 role 区分真实调用方（用户 JWT=authenticated，服务端=service_role）
  v_caller_role text := coalesce(auth.jwt() ->> 'role', '');
  v_owner uuid;
  v_email text;
  v_title text;
  v_amount numeric;
  v_status text;
  v_no text := btrim(coalesce(p_invoice_no, ''));
  v_url text := nullif(btrim(coalesce(p_file_url, '')), '');
  v_secret text;
BEGIN
  -- 仅管理员：admin 角色 JWT 或 service_role
  IF (v_user IS NULL OR NOT has_role(v_user, 'admin'::text))
     AND v_caller_role <> 'service_role' THEN
    RAISE EXCEPTION '只有管理员可以执行开票操作';
  END IF;
  IF v_no = '' THEN
    RAISE EXCEPTION '发票号不能为空';
  END IF;
  IF length(v_no) > 100 THEN
    RAISE EXCEPTION '发票号不能超过100字';
  END IF;
  IF v_url IS NOT NULL AND v_url !~ '^https?://' THEN
    RAISE EXCEPTION '发票文件链接必须以 http(s):// 开头';
  END IF;

  SELECT user_id, email, title, amount, status
    INTO v_owner, v_email, v_title, v_amount, v_status
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票不存在';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '只有待开票状态的发票可以执行开票';
  END IF;

  -- 幂等防重：同号发票（非本票）已存在则拒绝
  IF EXISTS (SELECT 1 FROM public.invoices WHERE invoice_no = v_no AND id <> p_invoice_id) THEN
    RAISE EXCEPTION '发票号 % 已存在，请更换发票号', v_no;
  END IF;

  UPDATE public.invoices
  SET status = 'issued',
      invoice_no = v_no,
      file_url = v_url,
      issued_at = now(),
      updated_at = now()
  WHERE id = p_invoice_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票状态已变化，请刷新后重试';
  END IF;

  -- 站内通知申请用户
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_owner,
    'notif.gen.invoiceIssued',
    'notif.c.invIssued::' || jsonb_build_array(
      v_no, to_char(v_amount, 'FM999999990.00'), coalesce(v_title, '-'), coalesce(v_email, '-'))::text,
    '发票'
  );

  -- 邮件通知（pg_net 异步，失败不阻塞开票事务）
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'http://kong:8000/functions/v1/mailer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-mailer-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send',
        'scene', 'invoice_issued',
        'email', v_email,
        'lang', 'zh',
        'vars', jsonb_build_object(
          'invoiceNo', v_no,
          'amount', to_char(v_amount, 'FM999999990.00'),
          'title', coalesce(v_title, '')
        )
      )
    );
  END IF;

  RETURN v_no;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.request_invoice_reject(p_invoice_id uuid, p_reason text) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'auth', 'extensions'
    AS $$
DECLARE
  v_user uuid := auth.uid();
  -- 同上：SECURITY DEFINER 下凭 JWT claims 判断调用方角色
  v_caller_role text := coalesce(auth.jwt() ->> 'role', '');
  v_owner uuid;
  v_email text;
  v_title text;
  v_status text;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_secret text;
BEGIN
  IF (v_user IS NULL OR NOT has_role(v_user, 'admin'::text))
     AND v_caller_role <> 'service_role' THEN
    RAISE EXCEPTION '只有管理员可以执行驳回操作';
  END IF;
  IF v_reason = '' THEN
    RAISE EXCEPTION '驳回原因不能为空';
  END IF;
  IF length(v_reason) > 200 THEN
    RAISE EXCEPTION '驳回原因不能超过200字';
  END IF;

  SELECT user_id, email, title, status
    INTO v_owner, v_email, v_title, v_status
  FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票不存在';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION '只有待开票状态的发票可以驳回';
  END IF;

  UPDATE public.invoices
  SET status = 'rejected',
      reject_reason = v_reason,
      updated_at = now()
  WHERE id = p_invoice_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION '发票状态已变化，请刷新后重试';
  END IF;

  -- 站内通知申请用户（links_cleanup 触发器会解除支付订单占用，额度自动恢复）
  INSERT INTO public.notifications (user_id, title, content, type)
  VALUES (
    v_owner,
    'notif.gen.invoiceRejected',
    'notif.c.invRejected::' || jsonb_build_array(coalesce(v_title, '-'), v_reason)::text,
    '发票'
  );

  -- 邮件通知（pg_net 异步）
  v_secret := nullif(current_setting('app.mailer_secret', true), '');
  IF v_email IS NOT NULL AND v_secret IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'http://kong:8000/functions/v1/mailer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-mailer-secret', v_secret
      ),
      body := jsonb_build_object(
        'action', 'send',
        'scene', 'invoice_rejected',
        'email', v_email,
        'lang', 'zh',
        'vars', jsonb_build_object(
          'reason', v_reason,
          'title', coalesce(v_title, '')
        )
      )
    );
  END IF;

  RETURN v_reason;
END;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.seed_fee_accounts(p_user uuid) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_role text := current_setting('role', true);
begin
  -- ═══ 越权防护（R2 修复，spec §11）════════════════════════════════════════════
  --   p_user 必须落在调用者的租户范围内；否则任何登录用户都能给别的租户写费账户。
  --   允许的上下文：
  --     ① p_user = auth.uid()                       → 为自己写
  --     ② p_user = tenant_root(auth.uid())          → 为自己所属租户的租户根写（同租户内）
  --     ③ auth.uid() IS NULL 的系统上下文（auth.on_auth_user_created 触发器 /
  --        service_role 服务端 Edge Function / 直连数据库运维）—— 这些上下文本就有
  --        数据库写权限，不是跨租户越权面；保留以免打断注册链路（handle_new_user 调用本函数）。
  --   拒绝：anon 角色（EXECUTE 已从 anon/PUBLIC 收回）+ 跨租户用户上下文。
  if v_role = 'anon' then
    raise exception 'PERMISSION_DENIED: seed_fee_accounts is not available to anonymous callers'
      using errcode = '42501';
  end if;
  if auth.uid() is not null
     and p_user <> auth.uid()
     and p_user <> public.tenant_root(auth.uid()) then
    raise exception 'PERMISSION_DENIED: cannot seed fee accounts for another tenant'
      using errcode = '42501';
  end if;
  insert into public.fee_settings(user_id) values (p_user) on conflict (user_id) do nothing;

  with c(code) as (values ('platform'),('logistics'),('marketing'),('finance'),('other')),
  cat as (select id, code from public.fee_categories)
  insert into public.fee_accounts
    (user_id, category_id, code, name_key, is_allocatable, default_allocation, is_negative_allowed, sort_order)
  select p_user, cat.id, v.code, 'fee.account.' || v.code, v.allocatable, v.def_alloc, v.neg_allowed, v.sort
  from (values
    -- platform 平台费用
    ('platform.commission',        'platform', true,  'order_amount_ratio', true,  10),
    ('platform.category_commission','platform',true,  'order_amount_ratio', false, 11),
    ('platform.service_fee',       'platform', true,  'order_amount_ratio', true,  12),
    ('platform.subscription',      'platform', false, 'none',               false, 13),
    ('platform.listing_fee',       'platform', false, 'none',               false, 14),
    ('platform.other',             'platform', true,  'order_even',         false, 15),
    -- logistics 物流费用
    ('logistics.shipping_fee',     'logistics', true, 'sku_quantity_ratio', true,  20),
    ('logistics.first_leg',        'logistics', true, 'sku_quantity_ratio', false, 21),
    ('logistics.last_mile',        'logistics', true, 'sku_quantity_ratio', false, 22),
    ('logistics.warehouse',        'logistics', true, 'sku_quantity_ratio', false, 23),
    ('logistics.fba_fee',          'logistics', true, 'sku_quantity_ratio', false, 24),
    ('logistics.long_term_storage','logistics', true, 'sku_quantity_ratio', false, 25),
    ('logistics.packing',          'logistics', true, 'order_even',         false, 26),
    ('logistics.customs_clearance','logistics', true, 'order_amount_ratio', false, 27),
    -- marketing 营销费用
    ('marketing.ads',              'marketing', true, 'order_amount_ratio', false, 30),
    ('marketing.promotion_discount','marketing',true, 'order_amount_ratio', true,  31),
    ('marketing.flash_sale',       'marketing', true, 'order_amount_ratio', false, 32),
    ('marketing.coupon',           'marketing', true, 'order_amount_ratio', true,  33),
    ('marketing.affiliate',        'marketing', true, 'order_amount_ratio', false, 34),
    ('marketing.influencer',       'marketing', false,'none',               false, 35),
    ('marketing.other',            'marketing', true, 'order_amount_ratio', false, 36),
    -- finance 金融费用
    ('finance.payment_fee',        'finance', true, 'order_amount_ratio', false, 40),
    ('finance.withdrawal_fee',     'finance', false,'none',               false, 41),
    ('finance.fx_loss',            'finance', true, 'order_amount_ratio', false, 42),
    ('finance.refund_fee',         'finance', true, 'order_amount_ratio', true,  43),
    ('finance.return_handling',    'finance', true, 'order_amount_ratio', false, 44),
    ('finance.interest',           'finance', true, 'order_amount_ratio', false, 45),
    ('finance.other',              'finance', true, 'order_amount_ratio', false, 46),
    -- other 其他
    ('other.tariff',               'other', true, 'order_amount_ratio', false, 50),
    ('other.tax',                  'other', true, 'order_amount_ratio', true,  51),
    ('other.compensation',         'other', true, 'order_amount_ratio', true,  52),
    ('other.misc',                 'other', true, 'order_even',         false, 53)
  ) as v(code, cat_code, allocatable, def_alloc, neg_allowed, sort)
  join cat on cat.code = v.cat_code
  on conflict (user_id, code) do nothing;
end 
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.stock_sync_enqueue_on_available_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  m       record;
  matched integer := 0;
BEGIN
  -- 幂等：同值变更不入队、不告警
  IF NEW.available IS NOT DISTINCT FROM OLD.available THEN
    RETURN NEW;
  END IF;

  -- 该 SKU 的有效刊登映射（listing 成功 + 远程 ID 存在 + 店铺已授权 + WooCommerce）
  FOR m IN
    SELECT sm.id AS sku_mappings_id, l.shop_auth_id
    FROM public.sku_mappings sm
    JOIN public.listings    l  ON l.id = sm.listing_id
    JOIN public.shop_auths  sa ON sa.id = l.shop_auth_id
    WHERE sm.local_sku = NEW.sku
      AND l.status = '成功'
      AND COALESCE(l.wc_product_id, '') <> ''
      AND sa.status = '已授权'
      AND sa.platform ILIKE 'woocommerce'
  LOOP
    INSERT INTO public.stock_sync_queue
      (product_id, sku_mappings_id, user_id, shop_auth_id, local_sku, old_qty, new_qty, status)
    VALUES
      (NEW.id, m.sku_mappings_id, NEW.user_id, m.shop_auth_id, NEW.sku, OLD.available, NEW.available, '待推送');
    matched := matched + 1;
  END LOOP;

  -- 主人红线：库存变更但无任何生效映射 → 缺映射告警进通知模块
  IF matched = 0 THEN
    INSERT INTO public.notifications (user_id, title, content, type)
    VALUES (
      NEW.user_id,
      'notif.gen.stockNoMapping',
      'notif.c.stockNoMap::' || jsonb_build_array(
        coalesce(NEW.name, '-'), coalesce(NEW.sku, '-'),
        OLD.available::text, NEW.available::text)::text,
      '库存'
    );
  END IF;

  RETURN NEW;
END $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.sync_aftersale_order_status() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF COALESCE(NEW.order_id, '') = '' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> '已拒绝' THEN
      UPDATE public.orders SET status = '售后中'
      WHERE id = NEW.order_id AND status NOT IN ('售后中', '已取消');
    END IF;
  ELSE
    IF NEW.status = '已完成' THEN
      UPDATE public.orders SET status = '已完成'
      WHERE id = NEW.order_id AND status = '售后中';
    ELSIF NEW.status = '已拒绝' THEN
      UPDATE public.orders SET status = '待发货'
      WHERE id = NEW.order_id AND status = '售后中';
    ELSIF NEW.status IN ('待审核', '处理中') THEN
      UPDATE public.orders SET status = '售后中'
      WHERE id = NEW.order_id AND status NOT IN ('售后中', '已取消');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.tenant_root() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  select public.tenant_root(auth.uid())
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.tenant_root(p_uid uuid) RETURNS uuid
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_cur uuid := p_uid;
  v_next uuid;
  v_depth integer := 0;
begin
  if v_cur is null then
    return null;
  end if;
  -- 最多向上追溯 8 层，防御异常数据导致的环
  loop
    exit when v_depth >= 8;
    select p.owner_id into v_next from public.profiles p where p.id = v_cur;
    exit when v_next is null or v_next = v_cur;
    v_cur := v_next;
    v_depth := v_depth + 1;
  end loop;
  return v_cur;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

COMMENT ON FUNCTION public.tenant_root(p_uid uuid) IS '返回 uid 所属租户根（profiles.owner_id 链）；owner_id 为空者自身即租户根。spec §6.3 方案 A';

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.touch_invoices() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.trg_profiles_rbac_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  if new.owner_id        is distinct from old.owner_id
     or new.is_sub_account is distinct from old.is_sub_account
     or new.tenant_role    is distinct from old.tenant_role
     or new.tenant_id      is distinct from old.tenant_id then
    if auth.uid() is not null
       and not public.has_role(auth.uid(), 'admin')
       and auth.uid() <> public.tenant_root(auth.uid()) then
      raise exception 'PERMISSION_DENIED: cannot modify RBAC columns of profiles'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.upsert_fee_records(p_rows jsonb) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_uid uuid;
  v_inserted int := 0;
  v_updated int := 0;
  v_map jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    return jsonb_build_object('rows', 0, 'inserted', 0, 'updated', 0, 'map', '{}'::jsonb);
  end if;

  create temp table tmp_fee_upsert (
    rid text primary key,
    user_id uuid, shop_auth_id uuid, platform text, order_id text, platform_order_no text,
    fee_account_id uuid, amount numeric, currency text, raw jsonb, occurred_at timestamptz
  ) on commit drop;

  insert into tmp_fee_upsert(rid, user_id, shop_auth_id, platform, order_id, platform_order_no,
                             fee_account_id, amount, currency, raw, occurred_at)
  select x->>'_rid', (x->>'user_id')::uuid, (x->>'shop_auth_id')::uuid, x->>'platform', x->>'order_id',
         coalesce(x->>'platform_order_no',''), (x->>'fee_account_id')::uuid,
         round((x->>'amount')::numeric, 2), coalesce(x->>'currency','USD'),
         coalesce(x->'raw','{}'::jsonb), nullif(x->>'occurred_at','')::timestamptz
  from jsonb_array_elements(p_rows) x;

  -- 全量行必须归属同一用户（服务端调用；user 隔离在 RPC 内强校验）
  if (select count(distinct user_id) from tmp_fee_upsert) <> 1 then
    raise exception 'all rows must share one user_id';
  end if;
  select user_id into v_uid from tmp_fee_upsert limit 1;

  -- 1) 已存在的冲突行（按部分唯一索引键回查）
  create temp table tmp_fee_existing on commit drop as
  select u.rid, f.id as rec_id, f.amount as cur_amount, f.currency as cur_ccy,
         f.occurred_at as cur_occ, f.raw as cur_raw
  from tmp_fee_upsert u
  join public.platform_fee_records f
    on f.platform = u.platform and f.platform_order_no = u.platform_order_no
   and f.fee_account_id = u.fee_account_id
  where f.sku = '' and f.allocation_group_id is null and f.user_id = v_uid;

  -- 2) 内容有变化的行 → 更新（记入 changed）
  create temp table tmp_fee_changed on commit drop as
  select e.rec_id
  from tmp_fee_existing e
  join tmp_fee_upsert u using (rid)
  where u.amount is distinct from e.cur_amount
     or u.currency is distinct from e.cur_ccy
     or u.occurred_at is distinct from e.cur_occ
     or u.raw is distinct from e.cur_raw;

  with upd as (
    update public.platform_fee_records f
    set amount = u.amount, currency = u.currency, raw = u.raw,
        occurred_at = u.occurred_at, synced_at = now(),
        allocation_type = 'none', is_abnormal = false, abnormal_reason = ''
    from tmp_fee_changed c
    join tmp_fee_existing e on e.rec_id = c.rec_id
    join tmp_fee_upsert u on u.rid = e.rid
    where f.id = c.rec_id
    returning f.id
  )
  select count(*) into v_updated from upd;

  -- 已更新行的衍生分摊行删除（数据已变，需重新分摊）
  delete from public.platform_fee_records d
  where d.allocation_group_id in (select rec_id from tmp_fee_changed);

  -- 3) 新行 → 插入（ON CONFLICT DO NOTHING 兜底并发重复）
  with ins as (
    insert into public.platform_fee_records
      (user_id, shop_auth_id, platform, order_id, platform_order_no, fee_account_id,
       sku, item_name, amount, currency, raw, occurred_at, synced_at,
       allocation_type, allocation_group_id)
    select user_id, shop_auth_id, platform, order_id, platform_order_no, fee_account_id,
           '', '', amount, currency, raw, occurred_at, now(), 'none', null
    from tmp_fee_upsert u
    where not exists (select 1 from tmp_fee_existing e where e.rid = u.rid)
    order by rid
    on conflict (platform, platform_order_no, fee_account_id) where sku = '' and allocation_group_id is null
    do nothing
    returning id
  )
  select count(*) into v_inserted from ins;

  -- 4) rid → 记录 id 精确回查
  select coalesce(jsonb_object_agg(u.rid, f.id), '{}'::jsonb) into v_map
  from tmp_fee_upsert u
  join public.platform_fee_records f
    on f.platform = u.platform and f.platform_order_no = u.platform_order_no
   and f.fee_account_id = u.fee_account_id
  where f.sku = '' and f.allocation_group_id is null and f.user_id = v_uid;

  return jsonb_build_object('rows', jsonb_array_length(p_rows),
    'inserted', v_inserted, 'updated', v_updated, 'map', v_map);
end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
CREATE OR REPLACE FUNCTION public.zz_test_fn(p uuid) RETURNS void
    LANGUAGE plpgsql
    AS $$ begin end $$;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

COMMENT ON COLUMN public.ai_usage_logs.quantity IS '按张/次计费的数量（如生图张数）';

COMMENT ON TABLE public.cn_category_qualifications IS '国内平台类目→资质对照表';

COMMENT ON TABLE public.cn_platform_rules IS '国内平台商品发布规则（数值可配置，来源可追溯）';

COMMENT ON TABLE public.cn_sensitive_words IS '国内平台违禁词/极限词库（可增删改，按平台范围生效）';

CREATE OR REPLACE VIEW public.invoice_paid_sources WITH (security_invoker='true') AS
 SELECT po.id,
    po.user_id,
    po.order_no,
    po.amount,
    po.status,
    po.plan_id,
    po.credits_granted,
    po.package_code,
    po.platform_code,
    po.paid_at,
    po.created_at,
        CASE
            WHEN (po.plan_id IS NOT NULL) THEN 'subscription'::text
            WHEN ((po.package_code ~~ 'credits%'::text) OR ((po.package_code IS NULL) AND (po.credits_granted IS NOT NULL))) THEN 'credits'::text
            WHEN (po.package_code IS NOT NULL) THEN 'platform'::text
            ELSE 'other'::text
        END AS usage_kind,
    (active.payment_order_no IS NOT NULL) AS is_used
   FROM (public.payment_orders po
     LEFT JOIN ( SELECT l.payment_order_no
           FROM (public.invoice_links l
             JOIN public.invoices i ON (((i.id = l.invoice_id) AND (i.status = ANY (ARRAY['pending'::text, 'issued'::text])))))) active ON ((active.payment_order_no = po.order_no)))
  WHERE (po.status = 'paid'::text);

CREATE OR REPLACE VIEW public.invoice_quota WITH (security_invoker='true') AS
 SELECT COALESCE(paid.user_id, used.user_id) AS user_id,
    COALESCE(paid.total, (0)::numeric) AS paid_total,
    COALESCE(used.total, (0)::numeric) AS invoiced_total,
    GREATEST((COALESCE(paid.total, (0)::numeric) - COALESCE(used.total, (0)::numeric)), (0)::numeric) AS available_amount
   FROM (( SELECT po.user_id,
            sum(po.amount) AS total
           FROM public.payment_orders po
          WHERE (po.status = 'paid'::text)
          GROUP BY po.user_id) paid
     FULL JOIN ( SELECT l.user_id,
            sum(l.amount) AS total
           FROM (public.invoice_links l
             JOIN public.invoices i ON (((i.id = l.invoice_id) AND (i.status = ANY (ARRAY['pending'::text, 'issued'::text])))))
          GROUP BY l.user_id) used ON ((used.user_id = paid.user_id)));

COMMENT ON TABLE public.pricing_templates IS '定价模板：成本来源固定 products.cost(¥)，加价方式 percent/fixed，实时汇率折算目标币种';

COMMENT ON COLUMN public.products.i18n IS 'AI 翻译多语言内容 { lang: { name, description, variants[] } }';

COMMENT ON COLUMN public.service_pricing.billing_mode IS 'flat=按次固定价；token=按真实 Token 用量（阶梯）；per_image=按生成张数';

COMMENT ON COLUMN public.service_pricing.price_tiers IS '阶梯价 JSON 数组，按单次请求输入 Token 数取档：[{up_to_tokens, input, output}]';

COMMENT ON COLUMN public.service_pricing.markup IS '售价倍率：向租户收取的金额 = 阿里云官方成本单价 × markup（markup=1 表示按成本价，无利润）';

COMMENT ON COLUMN public.service_pricing.credits_per_use IS '每次调用固定扣除的AI积分(固定积分/次计费模式);为空则回退按token折算';

COMMENT ON TABLE public.split_rules IS '拆单规则：按 平台/区域/目标仓库 + 优先级 匹配的订单拆单配置';

COMMENT ON COLUMN public.split_rules.name IS '规则名称';

COMMENT ON COLUMN public.split_rules.platform IS '命中的电商平台，空表示不限';

COMMENT ON COLUMN public.split_rules.region IS '命中的收货区域，空表示不限';

COMMENT ON COLUMN public.split_rules.warehouse IS '订单拆分到的目标仓库';

COMMENT ON COLUMN public.split_rules.priority IS '匹配优先级，数值小者优先命中';

COMMENT ON COLUMN public.split_rules.status IS '启用 / 停用';

COMMENT ON COLUMN public.subscription_plans.max_shops IS '该套餐可授权的店铺数上限，-1 表示不限';

COMMENT ON COLUMN public.subscription_plans.max_products IS '该套餐可创建的商品数上限，-1 表示不限';

COMMENT ON COLUMN public.tenant_quotas.credits IS 'AI积分余额(1元=20积分);AI功能消耗仅从此字段扣除,不扣真实现金';

CREATE OR REPLACE VIEW public.v_admin_invoices AS
 SELECT i.id,
    i.user_id,
    i.invoice_no,
    i.invoice_type,
    i.title_type,
    i.title,
    i.tax_no,
    i.amount,
    i.content,
    i.email,
    i.remark,
    i.status,
    i.reject_reason,
    i.order_nos,
    i.file_url,
    i.issued_at,
    i.created_at,
    i.updated_at,
    i.void_reason,
    u.email AS applicant_email
   FROM (public.invoices i
     JOIN auth.users u ON ((u.id = i.user_id)))
  WHERE public.has_role(auth.uid(), 'admin'::text);

DO $q$ BEGIN
ALTER TABLE ONLY public.after_sales
    ADD CONSTRAINT after_sales_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_conversations
    ADD CONSTRAINT agent_conversations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_pending_actions
    ADD CONSTRAINT agent_pending_actions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_pending_actions
    ADD CONSTRAINT agent_pending_actions_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.agent_tool_logs
    ADD CONSTRAINT agent_tool_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_cash_usage
    ADD CONSTRAINT ai_cash_usage_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_free_quotas
    ADD CONSTRAINT ai_free_quotas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_free_quotas
    ADD CONSTRAINT ai_free_quotas_user_id_key UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_history
    ADD CONSTRAINT ai_history_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.ai_usage_logs
    ADD CONSTRAINT ai_usage_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures
    ADD CONSTRAINT automation_failures_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.benefit_grants
    ADD CONSTRAINT benefit_grants_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_category_qualifications
    ADD CONSTRAINT cn_category_qualifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_listing_generations
    ADD CONSTRAINT cn_listing_generations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_platform_rules
    ADD CONSTRAINT cn_platform_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_platform_rules
    ADD CONSTRAINT cn_platform_rules_platform_key_key UNIQUE (platform_key);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cn_sensitive_words
    ADD CONSTRAINT cn_sensitive_words_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_rules
    ADD CONSTRAINT collect_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings
    ADD CONSTRAINT collect_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings
    ADD CONSTRAINT collect_settings_user_id_key UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.competitor_tracks
    ADD CONSTRAINT competitor_tracks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cost_records
    ADD CONSTRAINT cost_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.country_tax_rates
    ADD CONSTRAINT country_tax_rates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.credit_packages
    ADD CONSTRAINT credit_packages_package_code_key UNIQUE (package_code);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.credit_packages
    ADD CONSTRAINT credit_packages_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_codes
    ADD CONSTRAINT email_codes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_send_logs
    ADD CONSTRAINT email_send_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_scene_lang_key UNIQUE (scene, lang);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.exceptions
    ADD CONSTRAINT exceptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fba_fee_tiers
    ADD CONSTRAINT fba_fee_tiers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts
    ADD CONSTRAINT fee_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts
    ADD CONSTRAINT fee_accounts_user_id_code_key UNIQUE (user_id, code);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_categories
    ADD CONSTRAINT fee_categories_code_key UNIQUE (code);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_categories
    ADD CONSTRAINT fee_categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_settings
    ADD CONSTRAINT fee_settings_pkey PRIMARY KEY (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fees
    ADD CONSTRAINT fees_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.forwarder_catalog
    ADD CONSTRAINT forwarder_catalog_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.forwarder_catalog
    ADD CONSTRAINT forwarder_catalog_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fulfillment_plans
    ADD CONSTRAINT fulfillment_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT fx_rates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inbound_orders
    ADD CONSTRAINT inbound_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.income_records
    ADD CONSTRAINT income_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links
    ADD CONSTRAINT invoice_links_payment_order_no_key UNIQUE (payment_order_no);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links
    ADD CONSTRAINT invoice_links_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_periods
    ADD CONSTRAINT license_periods_pkey PRIMARY KEY (period_code);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_platforms
    ADD CONSTRAINT license_platforms_pkey PRIMARY KEY (platform_code);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.license_shop_tiers
    ADD CONSTRAINT license_shop_tiers_pkey PRIMARY KEY (shop_count);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations
    ADD CONSTRAINT listing_generations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_logs
    ADD CONSTRAINT listing_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_mappings
    ADD CONSTRAINT listing_mappings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_tasks
    ADD CONSTRAINT listing_tasks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_templates
    ADD CONSTRAINT listing_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.logistics_channels
    ADD CONSTRAINT logistics_channels_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.oauth_apps
    ADD CONSTRAINT oauth_apps_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.operation_logs
    ADD CONSTRAINT operation_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_rules
    ADD CONSTRAINT order_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_settings
    ADD CONSTRAINT order_settings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs
    ADD CONSTRAINT order_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.outbound_orders
    ADD CONSTRAINT outbound_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payables
    ADD CONSTRAINT payables_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payment_orders
    ADD CONSTRAINT payment_orders_order_no_key UNIQUE (order_no);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payment_orders
    ADD CONSTRAINT payment_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_uniq UNIQUE (module, resource, action);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config
    ADD CONSTRAINT platform_auth_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_auth_config
    ADD CONSTRAINT platform_auth_config_platform_key_key UNIQUE (platform_key);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_configs
    ADD CONSTRAINT platform_configs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records
    ADD CONSTRAINT platform_fee_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map
    ADD CONSTRAINT platform_field_map_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_field_map
    ADD CONSTRAINT platform_field_map_unique UNIQUE (platform, target_column, api_endpoint);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.pricing_templates
    ADD CONSTRAINT pricing_templates_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_username_key UNIQUE (username);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profit_records
    ADD CONSTRAINT profit_records_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_plans
    ADD CONSTRAINT purchase_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_suggestions
    ADD CONSTRAINT purchase_suggestions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.quota_recharges
    ADD CONSTRAINT quota_recharges_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.receivables
    ADD CONSTRAINT receivables_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.return_orders
    ADD CONSTRAINT return_orders_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_uniq UNIQUE (role_id, permission_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_key_key UNIQUE (key);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.service_pricing
    ADD CONSTRAINT service_pricing_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_logs
    ADD CONSTRAINT settlement_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state
    ADD CONSTRAINT settlement_sync_state_pkey PRIMARY KEY (shop_auth_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_quotes
    ADD CONSTRAINT shipping_quotes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_tasks
    ADD CONSTRAINT shipping_tasks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths
    ADD CONSTRAINT shop_auths_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_groups
    ADD CONSTRAINT shop_groups_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_licenses
    ADD CONSTRAINT shop_licenses_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_listing_rules
    ADD CONSTRAINT shop_listing_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_listing_rules
    ADD CONSTRAINT shop_listing_rules_shop_id_key UNIQUE (shop_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs
    ADD CONSTRAINT shop_status_check_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state
    ADD CONSTRAINT shop_sync_state_pkey PRIMARY KEY (shop_auth_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sms_codes
    ADD CONSTRAINT sms_codes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.source_auths
    ADD CONSTRAINT source_auths_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.split_rules
    ADD CONSTRAINT split_rules_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_logs
    ADD CONSTRAINT stock_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_strategies
    ADD CONSTRAINT stock_strategies_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_logs
    ADD CONSTRAINT stock_sync_logs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue
    ADD CONSTRAINT stock_sync_queue_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_takes
    ADD CONSTRAINT stock_takes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log
    ADD CONSTRAINT sub_account_audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions
    ADD CONSTRAINT sub_account_permissions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions
    ADD CONSTRAINT sub_account_permissions_uniq UNIQUE (sub_account_id, permission_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts
    ADD CONSTRAINT sub_accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscription_plans
    ADD CONSTRAINT subscription_plans_plan_key_key UNIQUE (plan_key);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.tenant_quotas
    ADD CONSTRAINT tenant_quotas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.tenant_quotas
    ADD CONSTRAINT tenant_quotas_user_id_key UNIQUE (user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.traffic_stats
    ADD CONSTRAINT traffic_stats_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.translate_packs
    ADD CONSTRAINT translate_packs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills
    ADD CONSTRAINT waybills_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

CREATE INDEX IF NOT EXISTS ai_cash_usage_user_idx ON public.ai_cash_usage USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS email_codes_lookup_idx ON public.email_codes USING btree (email, scene, created_at DESC);

CREATE INDEX IF NOT EXISTS email_send_logs_scene_recipient_idx ON public.email_send_logs USING btree (scene, recipient, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_conversations_user ON public.agent_conversations USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_pending_user ON public.agent_pending_actions USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_agent_tool_logs_user ON public.agent_tool_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_user ON public.ai_usage_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON public.api_keys USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_api_logs_user ON public.api_logs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_automation_failures_user ON public.automation_failures USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_automation_rules_user ON public.automation_rules USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_automation_runs_user ON public.automation_runs USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_benefit_grants_user ON public.benefit_grants USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_brands_user ON public.brands USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_categories_user ON public.categories USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cn_category_qual_platform_path ON public.cn_category_qualifications USING btree (platform_key, category_path);

CREATE INDEX IF NOT EXISTS idx_cn_listing_gen_user_created ON public.cn_listing_generations USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cn_listing_gen_user_product ON public.cn_listing_generations USING btree (user_id, product_id);

CREATE INDEX IF NOT EXISTS idx_cn_sensitive_words_scope ON public.cn_sensitive_words USING gin (platform_scope);

CREATE INDEX IF NOT EXISTS idx_cn_sensitive_words_word ON public.cn_sensitive_words USING btree (word);

CREATE INDEX IF NOT EXISTS idx_collect_items_created_at ON public.collect_items USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_collect_items_platform ON public.collect_items USING btree (platform);

CREATE INDEX IF NOT EXISTS idx_collect_rules_user ON public.collect_rules USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_exceptions_user_status ON public.exceptions USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_exceptions_user_type ON public.exceptions USING btree (user_id, type);

CREATE INDEX IF NOT EXISTS idx_fee_accounts_user ON public.fee_accounts USING btree (user_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_freight_forwarders_user ON public.freight_forwarders USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_invoice ON public.invoice_links USING btree (invoice_id);

CREATE INDEX IF NOT EXISTS idx_invoice_links_user ON public.invoice_links USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_listing_generations_user_created ON public.listing_generations USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_listing_generations_user_product ON public.listing_generations USING btree (user_id, product_id);

CREATE INDEX IF NOT EXISTS idx_listing_templates_user ON public.listing_templates USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_listings_product ON public.listings USING btree (product_id);

CREATE INDEX IF NOT EXISTS idx_listings_shop ON public.listings USING btree (shop_auth_id);

CREATE INDEX IF NOT EXISTS idx_listings_user ON public.listings USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_oauth_apps_user ON public.oauth_apps USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_orders_user_created ON public.orders USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pac_verify_mode ON public.platform_auth_config USING btree (verify_mode);

CREATE INDEX IF NOT EXISTS idx_pfm_coverage ON public.platform_field_map USING btree (coverage);

CREATE INDEX IF NOT EXISTS idx_pfm_platform ON public.platform_field_map USING btree (platform);

CREATE INDEX IF NOT EXISTS idx_pfm_target ON public.platform_field_map USING btree (target_column);

CREATE INDEX IF NOT EXISTS idx_pfr_abnormal ON public.platform_fee_records USING btree (is_abnormal) WHERE is_abnormal;

CREATE INDEX IF NOT EXISTS idx_pfr_account ON public.platform_fee_records USING btree (fee_account_id);

CREATE INDEX IF NOT EXISTS idx_pfr_group ON public.platform_fee_records USING btree (allocation_group_id);

CREATE INDEX IF NOT EXISTS idx_pfr_order ON public.platform_fee_records USING btree (order_id);

CREATE INDEX IF NOT EXISTS idx_pfr_shop ON public.platform_fee_records USING btree (shop_auth_id);

CREATE INDEX IF NOT EXISTS idx_pfr_user_time ON public.platform_fee_records USING btree (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_configs_auth_state ON public.platform_configs USING btree (auth_state);

CREATE INDEX IF NOT EXISTS idx_platform_configs_sort ON public.platform_configs USING btree (sort_order);

CREATE INDEX IF NOT EXISTS idx_pricing_templates_user ON public.pricing_templates USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_product_variants_product ON public.product_variants USING btree (product_id);

CREATE INDEX IF NOT EXISTS idx_product_variants_user ON public.product_variants USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_products_shop_id ON public.products USING btree (shop_id);

CREATE INDEX IF NOT EXISTS idx_products_user ON public.products USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON public.purchase_items USING btree (order_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_user ON public.purchase_items USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_status ON public.purchase_orders USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_user ON public.purchase_orders USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_return_orders_user ON public.return_orders USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_shipments_order_id ON public.shipments USING btree (order_id) WHERE (order_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_shipments_tracking_active ON public.shipments USING btree (tracking_status) WHERE (tracking_status <> ALL (ARRAY['delivered'::text, 'exception'::text, 'expired'::text]));

CREATE INDEX IF NOT EXISTS idx_shop_auths_auth_group ON public.shop_auths USING btree (auth_group_id) WHERE (auth_group_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_shop_auths_auth_type ON public.shop_auths USING btree (auth_type);

CREATE INDEX IF NOT EXISTS idx_shop_auths_created_at ON public.shop_auths USING btree (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_auths_group_ids ON public.shop_auths USING gin (group_ids);

CREATE INDEX IF NOT EXISTS idx_shop_auths_platform_sort ON public.shop_auths USING btree (user_id, platform, sort_order);

CREATE INDEX IF NOT EXISTS idx_shop_auths_user ON public.shop_auths USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_shop_groups_user_sort ON public.shop_groups USING btree (user_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_shop_licenses_user ON public.shop_licenses USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_shop_status_check_logs_shop ON public.shop_status_check_logs USING btree (shop_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_shop_status_check_logs_user ON public.shop_status_check_logs USING btree (user_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS idx_shops_user ON public.shops USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_sku_mappings_listing ON public.sku_mappings USING btree (listing_id);

CREATE INDEX IF NOT EXISTS idx_sku_mappings_local_sku ON public.sku_mappings USING btree (local_sku);

CREATE INDEX IF NOT EXISTS idx_sms_codes_ip ON public.sms_codes USING btree (client_ip, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_codes_phone ON public.sms_codes USING btree (phone, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ssl_user_time ON public.settlement_sync_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_sync_logs_user ON public.stock_sync_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_sync_queue_mapping ON public.stock_sync_queue USING btree (sku_mappings_id);

CREATE INDEX IF NOT EXISTS idx_stock_sync_queue_status ON public.stock_sync_queue USING btree (status, created_at);

CREATE INDEX IF NOT EXISTS idx_stock_sync_queue_user ON public.stock_sync_queue USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_sync_logs_shop_created ON public.order_sync_logs USING btree (shop_auth_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_user_created ON public.order_sync_logs USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_state_user ON public.shop_sync_state USING btree (user_id);

CREATE INDEX IF NOT EXISTS idx_translate_packs_user ON public.translate_packs USING btree (user_id, status);

CREATE INDEX IF NOT EXISTS idx_webhooks_user ON public.webhooks USING btree (user_id);

CREATE INDEX IF NOT EXISTS invoices_status_idx ON public.invoices USING btree (status, created_at DESC);

CREATE INDEX IF NOT EXISTS invoices_user_idx ON public.invoices USING btree (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS profiles_owner_idx ON public.profiles USING btree (owner_id);

CREATE INDEX IF NOT EXISTS profiles_sub_account_idx ON public.profiles USING btree (owner_id) WHERE is_sub_account;

CREATE INDEX IF NOT EXISTS profiles_tenant_idx ON public.profiles USING btree (tenant_id);

CREATE INDEX IF NOT EXISTS role_permissions_role_idx ON public.role_permissions USING btree (role_id);

CREATE UNIQUE INDEX IF NOT EXISTS service_pricing_service_key_uidx ON public.service_pricing USING btree (service_key);

CREATE INDEX IF NOT EXISTS sub_account_audit_actor_idx ON public.sub_account_audit_log USING btree (actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sub_account_audit_tenant_idx ON public.sub_account_audit_log USING btree (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS sub_account_permissions_sub_idx ON public.sub_account_permissions USING btree (sub_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS sub_accounts_auth_user_uniq ON public.sub_accounts USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS sub_accounts_invite_token_uniq ON public.sub_accounts USING btree (invite_token) WHERE (invite_token IS NOT NULL);

CREATE INDEX IF NOT EXISTS sub_accounts_role_idx ON public.sub_accounts USING btree (role_id);

CREATE UNIQUE INDEX IF NOT EXISTS sub_accounts_tenant_email_uniq ON public.sub_accounts USING btree (user_id, lower(email)) WHERE (status <> '已离职'::text);

CREATE INDEX IF NOT EXISTS sub_accounts_user_idx ON public.sub_accounts USING btree (user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_orders_external_order_id ON public.orders USING btree (external_order_id) WHERE ((external_order_id IS NOT NULL) AND (external_order_id <> ''::text));

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pfr_synced ON public.platform_fee_records USING btree (platform, platform_order_no, fee_account_id) WHERE ((sku = ''::text) AND (allocation_group_id IS NULL));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pricing_templates_default ON public.pricing_templates USING btree (user_id) WHERE is_default;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_auths_user_platform_shop ON public.shop_auths USING btree (user_id, platform, COALESCE(platform_shop_id, shop_domain, shop_name)) WHERE (unbound_at IS NULL);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shop_groups_name ON public.shop_groups USING btree (user_id, name);

DROP TRIGGER IF EXISTS notify_bill_due_trigger ON public.bills;
CREATE TRIGGER notify_bill_due_trigger AFTER INSERT ON public.bills FOR EACH ROW EXECUTE FUNCTION public.notify_bill_due();

DROP TRIGGER IF EXISTS notify_inventory_low_trigger ON public.inventory;
CREATE TRIGGER notify_inventory_low_trigger AFTER INSERT OR UPDATE OF available, safety_stock ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.notify_inventory_low();

DROP TRIGGER IF EXISTS notify_order_created_trigger ON public.orders;
CREATE TRIGGER notify_order_created_trigger AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.notify_order_created();

DROP TRIGGER IF EXISTS notify_order_status_change_trigger ON public.orders;
CREATE TRIGGER notify_order_status_change_trigger AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.notify_order_status_change();

DROP TRIGGER IF EXISTS sync_aftersale_order_trigger ON public.after_sales;
CREATE TRIGGER sync_aftersale_order_trigger AFTER INSERT OR UPDATE OF status ON public.after_sales FOR EACH ROW EXECUTE FUNCTION public.sync_aftersale_order_status();

DROP TRIGGER IF EXISTS trg_automation_order ON public.orders;
CREATE TRIGGER trg_automation_order AFTER INSERT ON public.orders FOR EACH ROW EXECUTE FUNCTION public.fn_automation_on_order();

DROP TRIGGER IF EXISTS trg_automation_stock ON public.products;
CREATE TRIGGER trg_automation_stock AFTER INSERT OR UPDATE OF stock ON public.products FOR EACH ROW EXECUTE FUNCTION public.fn_automation_on_stock();

DROP TRIGGER IF EXISTS trg_automation_waybill ON public.waybills;
CREATE TRIGGER trg_automation_waybill AFTER UPDATE OF status ON public.waybills FOR EACH ROW EXECUTE FUNCTION public.fn_automation_on_waybill();

DROP TRIGGER IF EXISTS trg_deduct_inventory_on_ship ON public.orders;
CREATE TRIGGER trg_deduct_inventory_on_ship AFTER UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION public.deduct_inventory_on_ship();

DROP TRIGGER IF EXISTS trg_guard_invoice_status ON public.invoices;
CREATE TRIGGER trg_guard_invoice_status BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_guard_invoice_status();

DROP TRIGGER IF EXISTS trg_invoice_guard ON public.invoices;
CREATE TRIGGER trg_invoice_guard BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_guard_columns();

DROP TRIGGER IF EXISTS trg_invoice_insert_guard ON public.invoices;
CREATE TRIGGER trg_invoice_insert_guard BEFORE INSERT ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_insert_guard();

DROP TRIGGER IF EXISTS trg_invoice_links_cleanup ON public.invoices;
CREATE TRIGGER trg_invoice_links_cleanup AFTER UPDATE OF status ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.fn_invoice_links_cleanup();

DROP TRIGGER IF EXISTS trg_listings_updated_at ON public.listings;
CREATE TRIGGER trg_listings_updated_at BEFORE UPDATE ON public.listings FOR EACH ROW EXECUTE FUNCTION public.listings_touch_updated_at();

DROP TRIGGER IF EXISTS trg_notify_waybill_shipped ON public.waybills;
CREATE TRIGGER trg_notify_waybill_shipped AFTER INSERT ON public.waybills FOR EACH ROW EXECUTE FUNCTION public.fn_notify_waybill_shipped();

DROP TRIGGER IF EXISTS trg_pricing_template_default ON public.pricing_templates;
CREATE TRIGGER trg_pricing_template_default BEFORE INSERT OR UPDATE OF is_default ON public.pricing_templates FOR EACH ROW EXECUTE FUNCTION public.fn_pricing_template_default_guard();

DROP TRIGGER IF EXISTS trg_pricing_templates_updated ON public.pricing_templates;
CREATE TRIGGER trg_pricing_templates_updated BEFORE UPDATE ON public.pricing_templates FOR EACH ROW EXECUTE FUNCTION public.fn_pricing_templates_touch();

DROP TRIGGER IF EXISTS trg_profiles_rbac_guard ON public.profiles;
CREATE TRIGGER trg_profiles_rbac_guard BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_rbac_guard();

DROP TRIGGER IF EXISTS trg_stock_sync_on_available ON public.inventory;
CREATE TRIGGER trg_stock_sync_on_available AFTER UPDATE OF available ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.stock_sync_enqueue_on_available_change();

DROP TRIGGER IF EXISTS trg_touch_invoices ON public.invoices;
CREATE TRIGGER trg_touch_invoices BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.touch_invoices();

DO $q$ BEGIN
ALTER TABLE ONLY public.after_sales
    ADD CONSTRAINT after_sales_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_key_id_fkey FOREIGN KEY (key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.api_logs
    ADD CONSTRAINT api_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures
    ADD CONSTRAINT automation_failures_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_failures
    ADD CONSTRAINT automation_failures_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.automation_rules(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.automation_runs
    ADD CONSTRAINT automation_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.bills
    ADD CONSTRAINT bills_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.brands
    ADD CONSTRAINT brands_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.categories(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.categories
    ADD CONSTRAINT categories_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_claimed_shop_id_fkey FOREIGN KEY (claimed_shop_id) REFERENCES public.shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_items
    ADD CONSTRAINT collect_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_rules
    ADD CONSTRAINT collect_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.collect_settings
    ADD CONSTRAINT collect_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.competitor_tracks
    ADD CONSTRAINT competitor_tracks_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.cost_records
    ADD CONSTRAINT cost_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.country_tax_rates
    ADD CONSTRAINT country_tax_rates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.exceptions
    ADD CONSTRAINT exceptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fba_fee_tiers
    ADD CONSTRAINT fba_fee_tiers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts
    ADD CONSTRAINT fee_accounts_category_id_fkey FOREIGN KEY (category_id) REFERENCES public.fee_categories(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_accounts
    ADD CONSTRAINT fee_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fee_settings
    ADD CONSTRAINT fee_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fees
    ADD CONSTRAINT fees_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.freight_forwarders
    ADD CONSTRAINT freight_forwarders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fulfillment_plans
    ADD CONSTRAINT fulfillment_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.fx_rates
    ADD CONSTRAINT fx_rates_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inbound_orders
    ADD CONSTRAINT inbound_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.income_records
    ADD CONSTRAINT income_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.inventory
    ADD CONSTRAINT inventory_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links
    ADD CONSTRAINT invoice_links_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.invoice_links
    ADD CONSTRAINT invoice_links_payment_order_no_fkey FOREIGN KEY (payment_order_no) REFERENCES public.payment_orders(order_no) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations
    ADD CONSTRAINT listing_generations_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_generations
    ADD CONSTRAINT listing_generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_logs
    ADD CONSTRAINT listing_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listing_mappings
    ADD CONSTRAINT listing_mappings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.listings
    ADD CONSTRAINT listings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.locations
    ADD CONSTRAINT locations_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES public.warehouses(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.logistics_channels
    ADD CONSTRAINT logistics_channels_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.materials
    ADD CONSTRAINT materials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.oauth_apps
    ADD CONSTRAINT oauth_apps_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_rules
    ADD CONSTRAINT order_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_settings
    ADD CONSTRAINT order_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs
    ADD CONSTRAINT order_sync_logs_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.order_sync_logs
    ADD CONSTRAINT order_sync_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.outbound_orders
    ADD CONSTRAINT outbound_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.parcels
    ADD CONSTRAINT parcels_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.payables
    ADD CONSTRAINT payables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records
    ADD CONSTRAINT platform_fee_records_fee_account_id_fkey FOREIGN KEY (fee_account_id) REFERENCES public.fee_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records
    ADD CONSTRAINT platform_fee_records_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records
    ADD CONSTRAINT platform_fee_records_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.platform_fee_records
    ADD CONSTRAINT platform_fee_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.pricing_templates
    ADD CONSTRAINT pricing_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.purchase_orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_items
    ADD CONSTRAINT purchase_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_plans
    ADD CONSTRAINT purchase_plans_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_supplier_id_fkey FOREIGN KEY (supplier_id) REFERENCES public.suppliers(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_returns
    ADD CONSTRAINT purchase_returns_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.purchase_suggestions
    ADD CONSTRAINT purchase_suggestions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.receivables
    ADD CONSTRAINT receivables_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.reconciliations
    ADD CONSTRAINT reconciliations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state
    ADD CONSTRAINT settlement_sync_state_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.settlement_sync_state
    ADD CONSTRAINT settlement_sync_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipments
    ADD CONSTRAINT shipments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shipping_tasks
    ADD CONSTRAINT shipping_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_auths
    ADD CONSTRAINT shop_auths_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_groups
    ADD CONSTRAINT shop_groups_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs
    ADD CONSTRAINT shop_status_check_logs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES public.shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_status_check_logs
    ADD CONSTRAINT shop_status_check_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state
    ADD CONSTRAINT shop_sync_state_shop_auth_id_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shop_sync_state
    ADD CONSTRAINT shop_sync_state_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sku_mappings
    ADD CONSTRAINT sku_mappings_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.listings(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.source_auths
    ADD CONSTRAINT source_auths_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.split_rules
    ADD CONSTRAINT split_rules_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_adjustments
    ADD CONSTRAINT stock_adjustments_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_alerts
    ADD CONSTRAINT stock_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_logs
    ADD CONSTRAINT stock_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_strategies
    ADD CONSTRAINT stock_strategies_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue
    ADD CONSTRAINT stock_sync_queue_shop_auth_fkey FOREIGN KEY (shop_auth_id) REFERENCES public.shop_auths(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_sync_queue
    ADD CONSTRAINT stock_sync_queue_sku_mappings_id_fkey FOREIGN KEY (sku_mappings_id) REFERENCES public.sku_mappings(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.stock_takes
    ADD CONSTRAINT stock_takes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log
    ADD CONSTRAINT sub_account_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log
    ADD CONSTRAINT sub_account_audit_log_sub_account_id_fkey FOREIGN KEY (sub_account_id) REFERENCES public.sub_accounts(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_audit_log
    ADD CONSTRAINT sub_account_audit_log_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions
    ADD CONSTRAINT sub_account_permissions_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions
    ADD CONSTRAINT sub_account_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_account_permissions
    ADD CONSTRAINT sub_account_permissions_sub_account_id_fkey FOREIGN KEY (sub_account_id) REFERENCES public.sub_accounts(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts
    ADD CONSTRAINT sub_accounts_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts
    ADD CONSTRAINT sub_accounts_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.sub_accounts
    ADD CONSTRAINT sub_accounts_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.subscription_plans(id);
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.suppliers
    ADD CONSTRAINT suppliers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.traffic_stats
    ADD CONSTRAINT traffic_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.warehouses
    ADD CONSTRAINT warehouses_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills
    ADD CONSTRAINT waybills_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES public.shipments(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.waybills
    ADD CONSTRAINT waybills_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DO $q$ BEGIN
ALTER TABLE ONLY public.webhooks
    ADD CONSTRAINT webhooks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN invalid_table_definition THEN NULL;
  WHEN duplicate_column THEN NULL;
  WHEN undefined_column THEN NULL;
  WHEN feature_not_supported THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN duplicate_table THEN NULL;
  WHEN duplicate_function THEN NULL;
  WHEN undefined_table THEN NULL;
  WHEN undefined_function THEN NULL;
  WHEN undefined_object THEN NULL;
  WHEN wrong_object_type THEN NULL;
  WHEN dependent_objects_still_exist THEN NULL; END $q$;

DROP POLICY IF EXISTS "admins_all_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY admins_all_cn_listing_generations ON public.cn_listing_generations USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_all_credit_packages" ON public.credit_packages;
CREATE POLICY admins_all_credit_packages ON public.credit_packages TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_all_free_quota" ON public.ai_free_quotas;
CREATE POLICY admins_all_free_quota ON public.ai_free_quotas TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_all_invoices" ON public.invoices;
CREATE POLICY admins_all_invoices ON public.invoices TO authenticated USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_delete_announcements" ON public.announcements;
CREATE POLICY admins_delete_announcements ON public.announcements FOR DELETE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_delete_platform_configs" ON public.platform_configs;
CREATE POLICY admins_delete_platform_configs ON public.platform_configs FOR DELETE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_delete_service_pricing" ON public.service_pricing;
CREATE POLICY admins_delete_service_pricing ON public.service_pricing FOR DELETE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_delete_shop_auths" ON public.shop_auths;
CREATE POLICY admins_delete_shop_auths ON public.shop_auths FOR DELETE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_insert_announcements" ON public.announcements;
CREATE POLICY admins_insert_announcements ON public.announcements FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_insert_operation_logs" ON public.operation_logs;
CREATE POLICY admins_insert_operation_logs ON public.operation_logs FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_insert_platform_configs" ON public.platform_configs;
CREATE POLICY admins_insert_platform_configs ON public.platform_configs FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_insert_service_pricing" ON public.service_pricing;
CREATE POLICY admins_insert_service_pricing ON public.service_pricing FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_insert_shop_auths" ON public.shop_auths;
CREATE POLICY admins_insert_shop_auths ON public.shop_auths FOR INSERT WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_manage_email_templates" ON public.email_templates;
CREATE POLICY admins_manage_email_templates ON public.email_templates USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_after_sales" ON public.after_sales;
CREATE POLICY admins_select_after_sales ON public.after_sales FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_ai_usage_logs" ON public.ai_usage_logs;
CREATE POLICY admins_select_ai_usage_logs ON public.ai_usage_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_benefit_grants" ON public.benefit_grants;
CREATE POLICY admins_select_benefit_grants ON public.benefit_grants FOR SELECT USING (true);

DROP POLICY IF EXISTS "admins_select_bills" ON public.bills;
CREATE POLICY admins_select_bills ON public.bills FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY admins_select_cn_listing_generations ON public.cn_listing_generations FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_collect_items" ON public.collect_items;
CREATE POLICY admins_select_collect_items ON public.collect_items FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_email_send_logs" ON public.email_send_logs;
CREATE POLICY admins_select_email_send_logs ON public.email_send_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_fees" ON public.fees;
CREATE POLICY admins_select_fees ON public.fees FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_fulfillment_plans" ON public.fulfillment_plans;
CREATE POLICY admins_select_fulfillment_plans ON public.fulfillment_plans FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_inbound_orders" ON public.inbound_orders;
CREATE POLICY admins_select_inbound_orders ON public.inbound_orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_inventory" ON public.inventory;
CREATE POLICY admins_select_inventory ON public.inventory FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_listing_generations" ON public.listing_generations;
CREATE POLICY admins_select_listing_generations ON public.listing_generations FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_logistics_channels" ON public.logistics_channels;
CREATE POLICY admins_select_logistics_channels ON public.logistics_channels FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_materials" ON public.materials;
CREATE POLICY admins_select_materials ON public.materials FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_operation_logs" ON public.operation_logs;
CREATE POLICY admins_select_operation_logs ON public.operation_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_order_rules" ON public.order_rules;
CREATE POLICY admins_select_order_rules ON public.order_rules FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_orders" ON public.orders;
CREATE POLICY admins_select_orders ON public.orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_outbound_orders" ON public.outbound_orders;
CREATE POLICY admins_select_outbound_orders ON public.outbound_orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_payment_orders" ON public.payment_orders;
CREATE POLICY admins_select_payment_orders ON public.payment_orders FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_platform_configs" ON public.platform_configs;
CREATE POLICY admins_select_platform_configs ON public.platform_configs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_products" ON public.products;
CREATE POLICY admins_select_products ON public.products FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_profiles" ON public.profiles;
CREATE POLICY admins_select_profiles ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_purchase_plans" ON public.purchase_plans;
CREATE POLICY admins_select_purchase_plans ON public.purchase_plans FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_purchase_suggestions" ON public.purchase_suggestions;
CREATE POLICY admins_select_purchase_suggestions ON public.purchase_suggestions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_quota_recharges" ON public.quota_recharges;
CREATE POLICY admins_select_quota_recharges ON public.quota_recharges FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_reconciliations" ON public.reconciliations;
CREATE POLICY admins_select_reconciliations ON public.reconciliations FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_service_pricing" ON public.service_pricing;
CREATE POLICY admins_select_service_pricing ON public.service_pricing FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_shipments" ON public.shipments;
CREATE POLICY admins_select_shipments ON public.shipments FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_shop_auths" ON public.shop_auths;
CREATE POLICY admins_select_shop_auths ON public.shop_auths FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_shop_licenses" ON public.shop_licenses;
CREATE POLICY admins_select_shop_licenses ON public.shop_licenses FOR SELECT USING (true);

DROP POLICY IF EXISTS "admins_select_shop_listing_rules" ON public.shop_listing_rules;
CREATE POLICY admins_select_shop_listing_rules ON public.shop_listing_rules FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_shops" ON public.shops;
CREATE POLICY admins_select_shops ON public.shops FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_source_auths" ON public.source_auths;
CREATE POLICY admins_select_source_auths ON public.source_auths FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_subscriptions" ON public.subscriptions;
CREATE POLICY admins_select_subscriptions ON public.subscriptions FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_suppliers" ON public.suppliers;
CREATE POLICY admins_select_suppliers ON public.suppliers FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_sync_logs" ON public.order_sync_logs;
CREATE POLICY admins_select_sync_logs ON public.order_sync_logs FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_sync_state" ON public.shop_sync_state;
CREATE POLICY admins_select_sync_state ON public.shop_sync_state FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_tenant_quotas" ON public.tenant_quotas;
CREATE POLICY admins_select_tenant_quotas ON public.tenant_quotas FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_traffic_stats" ON public.traffic_stats;
CREATE POLICY admins_select_traffic_stats ON public.traffic_stats FOR SELECT USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_select_translate_packs" ON public.translate_packs;
CREATE POLICY admins_select_translate_packs ON public.translate_packs FOR SELECT USING (true);

DROP POLICY IF EXISTS "admins_update_announcements" ON public.announcements;
CREATE POLICY admins_update_announcements ON public.announcements FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_update_platform_configs" ON public.platform_configs;
CREATE POLICY admins_update_platform_configs ON public.platform_configs FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_update_profiles" ON public.profiles;
CREATE POLICY admins_update_profiles ON public.profiles FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_update_service_pricing" ON public.service_pricing;
CREATE POLICY admins_update_service_pricing ON public.service_pricing FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_update_shop_auths" ON public.shop_auths;
CREATE POLICY admins_update_shop_auths ON public.shop_auths FOR UPDATE USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_write_cn_category_qualifications" ON public.cn_category_qualifications;
CREATE POLICY admins_write_cn_category_qualifications ON public.cn_category_qualifications USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_write_cn_platform_rules" ON public.cn_platform_rules;
CREATE POLICY admins_write_cn_platform_rules ON public.cn_platform_rules USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "admins_write_cn_sensitive_words" ON public.cn_sensitive_words;
CREATE POLICY admins_write_cn_sensitive_words ON public.cn_sensitive_words USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

ALTER TABLE public.after_sales ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_conversations_own" ON public.agent_conversations;
CREATE POLICY agent_conversations_own ON public.agent_conversations USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.agent_pending_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_pending_actions_own" ON public.agent_pending_actions;
CREATE POLICY agent_pending_actions_own ON public.agent_pending_actions USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.agent_tool_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tool_logs_own" ON public.agent_tool_logs;
CREATE POLICY agent_tool_logs_own ON public.agent_tool_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.ai_cash_usage ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_free_quotas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_history ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_subscription_plans" ON public.subscription_plans;
CREATE POLICY anon_select_subscription_plans ON public.subscription_plans FOR SELECT USING (true);

DROP POLICY IF EXISTS "anyone_read_platform_auth_config" ON public.platform_auth_config;
CREATE POLICY anyone_read_platform_auth_config ON public.platform_auth_config FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_keys owner" ON public.api_keys;
CREATE POLICY "api_keys owner" ON public.api_keys USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.api_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "api_logs owner" ON public.api_logs;
CREATE POLICY "api_logs owner" ON public.api_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.automation_failures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_failures owner" ON public.automation_failures;
CREATE POLICY "automation_failures owner" ON public.automation_failures USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.automation_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_rules owner" ON public.automation_rules;
CREATE POLICY "automation_rules owner" ON public.automation_rules USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.automation_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_runs owner" ON public.automation_runs;
CREATE POLICY "automation_runs owner" ON public.automation_runs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.benefit_grants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.bills ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.brands ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brands owner" ON public.brands;
CREATE POLICY "brands owner" ON public.brands USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "catalog_read" ON public.forwarder_catalog;
CREATE POLICY catalog_read ON public.forwarder_catalog FOR SELECT USING (true);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "categories owner" ON public.categories;
CREATE POLICY "categories owner" ON public.categories USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.cn_category_qualifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cn_listing_generations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cn_platform_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cn_sensitive_words ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.collect_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.collect_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "collect_rules owner" ON public.collect_rules;
CREATE POLICY "collect_rules owner" ON public.collect_rules USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.collect_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.competitor_tracks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.cost_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cost_records_owner" ON public.cost_records;
CREATE POLICY cost_records_owner ON public.cost_records USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.country_tax_rates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.credit_packages ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_send_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exceptions owner" ON public.exceptions;
CREATE POLICY "exceptions owner" ON public.exceptions USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.fba_fee_tiers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fee_accounts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fee_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fee_categories_read_all" ON public.fee_categories;
CREATE POLICY fee_categories_read_all ON public.fee_categories FOR SELECT USING (true);

ALTER TABLE public.fee_settings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.fees ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.forwarder_catalog ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.freight_forwarders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "freight_forwarders_own" ON public.freight_forwarders;
CREATE POLICY freight_forwarders_own ON public.freight_forwarders USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.fulfillment_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fulfillment_plans_delete" ON public.fulfillment_plans;
CREATE POLICY fulfillment_plans_delete ON public.fulfillment_plans FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "fulfillment_plans_insert" ON public.fulfillment_plans;
CREATE POLICY fulfillment_plans_insert ON public.fulfillment_plans FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "fulfillment_plans_select" ON public.fulfillment_plans;
CREATE POLICY fulfillment_plans_select ON public.fulfillment_plans FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "fulfillment_plans_update" ON public.fulfillment_plans;
CREATE POLICY fulfillment_plans_update ON public.fulfillment_plans FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.fx_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fx_rates_owner" ON public.fx_rates;
CREATE POLICY fx_rates_owner ON public.fx_rates USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.inbound_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.income_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "income_records_owner" ON public.income_records;
CREATE POLICY income_records_owner ON public.income_records USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invoice_links ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.license_periods ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.license_platforms ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.license_shop_tiers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_generations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_logs_owner" ON public.listing_logs;
CREATE POLICY listing_logs_owner ON public.listing_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.listing_mappings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "listing_mappings_owner" ON public.listing_mappings;
CREATE POLICY listing_mappings_owner ON public.listing_mappings USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.listing_tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listing_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "locations_owner" ON public.locations;
CREATE POLICY locations_owner ON public.locations USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.logistics_channels ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.materials ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.oauth_apps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "oauth_apps owner" ON public.oauth_apps;
CREATE POLICY "oauth_apps owner" ON public.oauth_apps USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.operation_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.order_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_settings_owner" ON public.order_settings;
CREATE POLICY order_settings_owner ON public.order_settings USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.order_sync_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.outbound_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "parcels_owner" ON public.parcels;
CREATE POLICY parcels_owner ON public.parcels USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.payables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "payables_owner" ON public.payables;
CREATE POLICY payables_owner ON public.payables USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.payment_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "permissions_admin_write" ON public.permissions;
CREATE POLICY permissions_admin_write ON public.permissions USING (public.has_role(auth.uid(), 'admin'::text)) WITH CHECK (public.has_role(auth.uid(), 'admin'::text));

DROP POLICY IF EXISTS "permissions_select_all" ON public.permissions;
CREATE POLICY permissions_select_all ON public.permissions FOR SELECT USING (true);

ALTER TABLE public.platform_auth_config ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_configs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_fee_records ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.platform_field_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "platform_field_map_select_anon" ON public.platform_field_map;
CREATE POLICY platform_field_map_select_anon ON public.platform_field_map FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "platform_field_map_select_authenticated" ON public.platform_field_map;
CREATE POLICY platform_field_map_select_authenticated ON public.platform_field_map FOR SELECT TO authenticated USING (true);

ALTER TABLE public.pricing_templates ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.profit_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read license_periods" ON public.license_periods;
CREATE POLICY "public read license_periods" ON public.license_periods FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "public read license_platforms" ON public.license_platforms;
CREATE POLICY "public read license_platforms" ON public.license_platforms FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "public read license_shop_tiers" ON public.license_shop_tiers;
CREATE POLICY "public read license_shop_tiers" ON public.license_shop_tiers FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "public_read_cn_category_qualifications" ON public.cn_category_qualifications;
CREATE POLICY public_read_cn_category_qualifications ON public.cn_category_qualifications FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_cn_platform_rules" ON public.cn_platform_rules;
CREATE POLICY public_read_cn_platform_rules ON public.cn_platform_rules FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_cn_sensitive_words" ON public.cn_sensitive_words;
CREATE POLICY public_read_cn_sensitive_words ON public.cn_sensitive_words FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_platform_configs" ON public.platform_configs;
CREATE POLICY public_read_platform_configs ON public.platform_configs FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_select_credit_packages" ON public.credit_packages;
CREATE POLICY public_select_credit_packages ON public.credit_packages FOR SELECT TO authenticated, anon USING (true);

DROP POLICY IF EXISTS "public_select_service_pricing" ON public.service_pricing;
CREATE POLICY public_select_service_pricing ON public.service_pricing FOR SELECT TO authenticated, anon USING (true);

ALTER TABLE public.purchase_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_items_owner_delete" ON public.purchase_items;
CREATE POLICY purchase_items_owner_delete ON public.purchase_items FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_items_owner_insert" ON public.purchase_items;
CREATE POLICY purchase_items_owner_insert ON public.purchase_items FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_items_owner_select" ON public.purchase_items;
CREATE POLICY purchase_items_owner_select ON public.purchase_items FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_items_owner_update" ON public.purchase_items;
CREATE POLICY purchase_items_owner_update ON public.purchase_items FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_orders_owner_delete" ON public.purchase_orders;
CREATE POLICY purchase_orders_owner_delete ON public.purchase_orders FOR DELETE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_orders_owner_insert" ON public.purchase_orders;
CREATE POLICY purchase_orders_owner_insert ON public.purchase_orders FOR INSERT TO authenticated WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_orders_owner_select" ON public.purchase_orders;
CREATE POLICY purchase_orders_owner_select ON public.purchase_orders FOR SELECT TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid)));

DROP POLICY IF EXISTS "purchase_orders_owner_update" ON public.purchase_orders;
CREATE POLICY purchase_orders_owner_update ON public.purchase_orders FOR UPDATE TO authenticated USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));

ALTER TABLE public.purchase_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_plans_delete" ON public.purchase_plans;
CREATE POLICY purchase_plans_delete ON public.purchase_plans FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "purchase_plans_insert" ON public.purchase_plans;
CREATE POLICY purchase_plans_insert ON public.purchase_plans FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "purchase_plans_select" ON public.purchase_plans;
CREATE POLICY purchase_plans_select ON public.purchase_plans FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "purchase_plans_update" ON public.purchase_plans;
CREATE POLICY purchase_plans_update ON public.purchase_plans FOR UPDATE TO authenticated USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.purchase_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "purchase_returns_owner" ON public.purchase_returns;
CREATE POLICY purchase_returns_owner ON public.purchase_returns USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.purchase_suggestions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.quota_recharges ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.receivables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "receivables_owner" ON public.receivables;
CREATE POLICY receivables_owner ON public.receivables USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.reconciliations ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.return_orders ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "role_permissions_select" ON public.role_permissions;
CREATE POLICY role_permissions_select ON public.role_permissions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND ((r.tenant_id IS NULL) OR (r.tenant_id = public.tenant_root(auth.uid())) OR public.has_role(auth.uid(), 'admin'::text))))));

DROP POLICY IF EXISTS "role_permissions_write" ON public.role_permissions;
CREATE POLICY role_permissions_write ON public.role_permissions USING ((public.has_role(auth.uid(), 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND (NOT r.is_builtin) AND (r.tenant_id = public.tenant_root(auth.uid()))))))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.roles r
  WHERE ((r.id = role_permissions.role_id) AND (NOT r.is_builtin) AND (r.tenant_id = public.tenant_root(auth.uid())))))));

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_admin_write" ON public.roles;
CREATE POLICY roles_admin_write ON public.roles USING ((public.has_role(auth.uid(), 'admin'::text) OR ((NOT is_builtin) AND (tenant_id = public.tenant_root(auth.uid()))))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::text) OR ((NOT is_builtin) AND (tenant_id = public.tenant_root(auth.uid())))));

DROP POLICY IF EXISTS "roles_select_own" ON public.roles;
CREATE POLICY roles_select_own ON public.roles FOR SELECT USING (((tenant_id IS NULL) OR (tenant_id = public.tenant_root(auth.uid())) OR public.has_role(auth.uid(), 'admin'::text)));

ALTER TABLE public.service_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_all_sms_codes" ON public.sms_codes;
CREATE POLICY service_role_all_sms_codes ON public.sms_codes TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.settlement_sync_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.settlement_sync_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipments ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipping_quotes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shipping_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipping_tasks_owner" ON public.shipping_tasks;
CREATE POLICY shipping_tasks_owner ON public.shipping_tasks USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.shop_auths ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shop_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_groups_own" ON public.shop_groups;
CREATE POLICY shop_groups_own ON public.shop_groups USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.shop_licenses ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shop_listing_rules ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shop_status_check_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shop_status_check_logs_own" ON public.shop_status_check_logs;
CREATE POLICY shop_status_check_logs_own ON public.shop_status_check_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.shop_sync_state ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.shops ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sku_mappings ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.sms_codes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.source_auths ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.split_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "split_rules_owner" ON public.split_rules;
CREATE POLICY split_rules_owner ON public.split_rules USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_adjustments_owner" ON public.stock_adjustments;
CREATE POLICY stock_adjustments_owner ON public.stock_adjustments USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.stock_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_alerts_owner" ON public.stock_alerts;
CREATE POLICY stock_alerts_owner ON public.stock_alerts USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.stock_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_logs_owner" ON public.stock_logs;
CREATE POLICY stock_logs_owner ON public.stock_logs USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.stock_strategies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_strategies_owner" ON public.stock_strategies;
CREATE POLICY stock_strategies_owner ON public.stock_strategies USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.stock_sync_logs ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_sync_queue ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.stock_takes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_takes_owner" ON public.stock_takes;
CREATE POLICY stock_takes_owner ON public.stock_takes USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.sub_account_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_account_audit_select" ON public.sub_account_audit_log;
CREATE POLICY sub_account_audit_select ON public.sub_account_audit_log FOR SELECT USING (((tenant_id = public.tenant_root(auth.uid())) OR public.has_role(auth.uid(), 'admin'::text)));

ALTER TABLE public.sub_account_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_account_permissions_select" ON public.sub_account_permissions;
CREATE POLICY sub_account_permissions_select ON public.sub_account_permissions FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.sub_accounts sa
  WHERE ((sa.id = sub_account_permissions.sub_account_id) AND ((sa.user_id = public.tenant_root(auth.uid())) OR (sa.auth_user_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::text))))));

DROP POLICY IF EXISTS "sub_account_permissions_write" ON public.sub_account_permissions;
CREATE POLICY sub_account_permissions_write ON public.sub_account_permissions USING ((public.has_role(auth.uid(), 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.sub_accounts sa
  WHERE ((sa.id = sub_account_permissions.sub_account_id) AND (sa.user_id = public.tenant_root(auth.uid()))))))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.sub_accounts sa
  WHERE ((sa.id = sub_account_permissions.sub_account_id) AND (sa.user_id = public.tenant_root(auth.uid())))))));

ALTER TABLE public.sub_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sub_accounts_select_self" ON public.sub_accounts;
CREATE POLICY sub_accounts_select_self ON public.sub_accounts FOR SELECT USING ((auth_user_id = auth.uid()));

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.tenant_quotas ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.traffic_stats ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.translate_packs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_all_collect_settings" ON public.collect_settings;
CREATE POLICY users_all_collect_settings ON public.collect_settings USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_after_sales" ON public.after_sales;
CREATE POLICY users_delete_after_sales ON public.after_sales FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_benefit_grants" ON public.benefit_grants;
CREATE POLICY users_delete_benefit_grants ON public.benefit_grants FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_bills" ON public.bills;
CREATE POLICY users_delete_bills ON public.bills FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY users_delete_cn_listing_generations ON public.cn_listing_generations FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_collect_items" ON public.collect_items;
CREATE POLICY users_delete_collect_items ON public.collect_items FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_competitor_tracks" ON public.competitor_tracks;
CREATE POLICY users_delete_competitor_tracks ON public.competitor_tracks FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_country_tax_rates" ON public.country_tax_rates;
CREATE POLICY users_delete_country_tax_rates ON public.country_tax_rates FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_fba_fee_tiers" ON public.fba_fee_tiers;
CREATE POLICY users_delete_fba_fee_tiers ON public.fba_fee_tiers FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_fee_accounts" ON public.fee_accounts;
CREATE POLICY users_delete_fee_accounts ON public.fee_accounts FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_fee_records" ON public.platform_fee_records;
CREATE POLICY users_delete_fee_records ON public.platform_fee_records FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_fees" ON public.fees;
CREATE POLICY users_delete_fees ON public.fees FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_inbound_orders" ON public.inbound_orders;
CREATE POLICY users_delete_inbound_orders ON public.inbound_orders FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_inventory" ON public.inventory;
CREATE POLICY users_delete_inventory ON public.inventory FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_listing_generations" ON public.listing_generations;
CREATE POLICY users_delete_listing_generations ON public.listing_generations FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_logistics_channels" ON public.logistics_channels;
CREATE POLICY users_delete_logistics_channels ON public.logistics_channels FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_materials" ON public.materials;
CREATE POLICY users_delete_materials ON public.materials FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_order_rules" ON public.order_rules;
CREATE POLICY users_delete_order_rules ON public.order_rules FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_orders" ON public.orders;
CREATE POLICY users_delete_orders ON public.orders FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_outbound_orders" ON public.outbound_orders;
CREATE POLICY users_delete_outbound_orders ON public.outbound_orders FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_ai_history" ON public.ai_history;
CREATE POLICY users_delete_own_ai_history ON public.ai_history FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_listing_tasks" ON public.listing_tasks;
CREATE POLICY users_delete_own_listing_tasks ON public.listing_tasks FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_listing_templates" ON public.listing_templates;
CREATE POLICY users_delete_own_listing_templates ON public.listing_templates FOR DELETE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_listings" ON public.listings;
CREATE POLICY users_delete_own_listings ON public.listings FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_notifications" ON public.notifications;
CREATE POLICY users_delete_own_notifications ON public.notifications FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_profit_records" ON public.profit_records;
CREATE POLICY users_delete_own_profit_records ON public.profit_records FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_shipping_quotes" ON public.shipping_quotes;
CREATE POLICY users_delete_own_shipping_quotes ON public.shipping_quotes FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_own_sku_mappings" ON public.sku_mappings;
CREATE POLICY users_delete_own_sku_mappings ON public.sku_mappings FOR DELETE USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = sku_mappings.listing_id) AND (l.user_id = auth.uid())))));

DROP POLICY IF EXISTS "users_delete_own_sub_accounts" ON public.sub_accounts;
CREATE POLICY users_delete_own_sub_accounts ON public.sub_accounts FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_pricing_templates" ON public.pricing_templates;
CREATE POLICY users_delete_pricing_templates ON public.pricing_templates FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_product_variants" ON public.product_variants;
CREATE POLICY users_delete_product_variants ON public.product_variants FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_products" ON public.products;
CREATE POLICY users_delete_products ON public.products FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_purchase_suggestions" ON public.purchase_suggestions;
CREATE POLICY users_delete_purchase_suggestions ON public.purchase_suggestions FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_reconciliations" ON public.reconciliations;
CREATE POLICY users_delete_reconciliations ON public.reconciliations FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_return_orders" ON public.return_orders;
CREATE POLICY users_delete_return_orders ON public.return_orders FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_shipments" ON public.shipments;
CREATE POLICY users_delete_shipments ON public.shipments FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_shop_auths" ON public.shop_auths;
CREATE POLICY users_delete_shop_auths ON public.shop_auths FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_shop_licenses" ON public.shop_licenses;
CREATE POLICY users_delete_shop_licenses ON public.shop_licenses FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_shop_listing_rules" ON public.shop_listing_rules;
CREATE POLICY users_delete_shop_listing_rules ON public.shop_listing_rules FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_shops" ON public.shops;
CREATE POLICY users_delete_shops ON public.shops FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_source_auths" ON public.source_auths;
CREATE POLICY users_delete_source_auths ON public.source_auths FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_suppliers" ON public.suppliers;
CREATE POLICY users_delete_suppliers ON public.suppliers FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_traffic_stats" ON public.traffic_stats;
CREATE POLICY users_delete_traffic_stats ON public.traffic_stats FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_delete_translate_packs" ON public.translate_packs;
CREATE POLICY users_delete_translate_packs ON public.translate_packs FOR DELETE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_after_sales" ON public.after_sales;
CREATE POLICY users_insert_after_sales ON public.after_sales FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_benefit_grants" ON public.benefit_grants;
CREATE POLICY users_insert_benefit_grants ON public.benefit_grants FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_bills" ON public.bills;
CREATE POLICY users_insert_bills ON public.bills FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY users_insert_cn_listing_generations ON public.cn_listing_generations FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_collect_items" ON public.collect_items;
CREATE POLICY users_insert_collect_items ON public.collect_items FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_competitor_tracks" ON public.competitor_tracks;
CREATE POLICY users_insert_competitor_tracks ON public.competitor_tracks FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_country_tax_rates" ON public.country_tax_rates;
CREATE POLICY users_insert_country_tax_rates ON public.country_tax_rates FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_fba_fee_tiers" ON public.fba_fee_tiers;
CREATE POLICY users_insert_fba_fee_tiers ON public.fba_fee_tiers FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_fee_accounts" ON public.fee_accounts;
CREATE POLICY users_insert_fee_accounts ON public.fee_accounts FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_fee_records" ON public.platform_fee_records;
CREATE POLICY users_insert_fee_records ON public.platform_fee_records FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_fee_settings" ON public.fee_settings;
CREATE POLICY users_insert_fee_settings ON public.fee_settings FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_fees" ON public.fees;
CREATE POLICY users_insert_fees ON public.fees FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_inbound_orders" ON public.inbound_orders;
CREATE POLICY users_insert_inbound_orders ON public.inbound_orders FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_inventory" ON public.inventory;
CREATE POLICY users_insert_inventory ON public.inventory FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_logistics_channels" ON public.logistics_channels;
CREATE POLICY users_insert_logistics_channels ON public.logistics_channels FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_materials" ON public.materials;
CREATE POLICY users_insert_materials ON public.materials FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_order_rules" ON public.order_rules;
CREATE POLICY users_insert_order_rules ON public.order_rules FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_orders" ON public.orders;
CREATE POLICY users_insert_orders ON public.orders FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_outbound_orders" ON public.outbound_orders;
CREATE POLICY users_insert_outbound_orders ON public.outbound_orders FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_ai_history" ON public.ai_history;
CREATE POLICY users_insert_own_ai_history ON public.ai_history FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_invoices" ON public.invoices;
CREATE POLICY users_insert_own_invoices ON public.invoices FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_listing_tasks" ON public.listing_tasks;
CREATE POLICY users_insert_own_listing_tasks ON public.listing_tasks FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_listing_templates" ON public.listing_templates;
CREATE POLICY users_insert_own_listing_templates ON public.listing_templates FOR INSERT TO authenticated WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_listings" ON public.listings;
CREATE POLICY users_insert_own_listings ON public.listings FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_notifications" ON public.notifications;
CREATE POLICY users_insert_own_notifications ON public.notifications FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_payment" ON public.payment_orders;
CREATE POLICY users_insert_own_payment ON public.payment_orders FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_profile" ON public.profiles;
CREATE POLICY users_insert_own_profile ON public.profiles FOR INSERT WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS "users_insert_own_profit_records" ON public.profit_records;
CREATE POLICY users_insert_own_profit_records ON public.profit_records FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_quota" ON public.tenant_quotas;
CREATE POLICY users_insert_own_quota ON public.tenant_quotas FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_recharge" ON public.quota_recharges;
CREATE POLICY users_insert_own_recharge ON public.quota_recharges FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_shipping_quotes" ON public.shipping_quotes;
CREATE POLICY users_insert_own_shipping_quotes ON public.shipping_quotes FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_sku_mappings" ON public.sku_mappings;
CREATE POLICY users_insert_own_sku_mappings ON public.sku_mappings FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = sku_mappings.listing_id) AND (l.user_id = auth.uid())))));

DROP POLICY IF EXISTS "users_insert_own_sub_accounts" ON public.sub_accounts;
CREATE POLICY users_insert_own_sub_accounts ON public.sub_accounts FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_subscriptions" ON public.subscriptions;
CREATE POLICY users_insert_own_subscriptions ON public.subscriptions FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_own_usage" ON public.ai_usage_logs;
CREATE POLICY users_insert_own_usage ON public.ai_usage_logs FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_pricing_templates" ON public.pricing_templates;
CREATE POLICY users_insert_pricing_templates ON public.pricing_templates FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_product_variants" ON public.product_variants;
CREATE POLICY users_insert_product_variants ON public.product_variants FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_products" ON public.products;
CREATE POLICY users_insert_products ON public.products FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_purchase_suggestions" ON public.purchase_suggestions;
CREATE POLICY users_insert_purchase_suggestions ON public.purchase_suggestions FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_reconciliations" ON public.reconciliations;
CREATE POLICY users_insert_reconciliations ON public.reconciliations FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_return_orders" ON public.return_orders;
CREATE POLICY users_insert_return_orders ON public.return_orders FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_shipments" ON public.shipments;
CREATE POLICY users_insert_shipments ON public.shipments FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_shop_auths" ON public.shop_auths;
CREATE POLICY users_insert_shop_auths ON public.shop_auths FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_shop_licenses" ON public.shop_licenses;
CREATE POLICY users_insert_shop_licenses ON public.shop_licenses FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_shop_listing_rules" ON public.shop_listing_rules;
CREATE POLICY users_insert_shop_listing_rules ON public.shop_listing_rules FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "users_insert_shops" ON public.shops;
CREATE POLICY users_insert_shops ON public.shops FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_source_auths" ON public.source_auths;
CREATE POLICY users_insert_source_auths ON public.source_auths FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_suppliers" ON public.suppliers;
CREATE POLICY users_insert_suppliers ON public.suppliers FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_traffic_stats" ON public.traffic_stats;
CREATE POLICY users_insert_traffic_stats ON public.traffic_stats FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_insert_translate_packs" ON public.translate_packs;
CREATE POLICY users_insert_translate_packs ON public.translate_packs FOR INSERT WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_after_sales" ON public.after_sales;
CREATE POLICY users_select_after_sales ON public.after_sales FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_announcements" ON public.announcements;
CREATE POLICY users_select_announcements ON public.announcements FOR SELECT USING (true);

DROP POLICY IF EXISTS "users_select_benefit_grants" ON public.benefit_grants;
CREATE POLICY users_select_benefit_grants ON public.benefit_grants FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_bills" ON public.bills;
CREATE POLICY users_select_bills ON public.bills FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY users_select_cn_listing_generations ON public.cn_listing_generations FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_collect_items" ON public.collect_items;
CREATE POLICY users_select_collect_items ON public.collect_items FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_competitor_tracks" ON public.competitor_tracks;
CREATE POLICY users_select_competitor_tracks ON public.competitor_tracks FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_country_tax_rates" ON public.country_tax_rates;
CREATE POLICY users_select_country_tax_rates ON public.country_tax_rates FOR SELECT USING (((user_id IS NULL) OR (user_id = auth.uid())));

DROP POLICY IF EXISTS "users_select_fba_fee_tiers" ON public.fba_fee_tiers;
CREATE POLICY users_select_fba_fee_tiers ON public.fba_fee_tiers FOR SELECT USING (((user_id IS NULL) OR (user_id = auth.uid())));

DROP POLICY IF EXISTS "users_select_fee_accounts" ON public.fee_accounts;
CREATE POLICY users_select_fee_accounts ON public.fee_accounts FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_fee_records" ON public.platform_fee_records;
CREATE POLICY users_select_fee_records ON public.platform_fee_records FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_fee_settings" ON public.fee_settings;
CREATE POLICY users_select_fee_settings ON public.fee_settings FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_fees" ON public.fees;
CREATE POLICY users_select_fees ON public.fees FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_inbound_orders" ON public.inbound_orders;
CREATE POLICY users_select_inbound_orders ON public.inbound_orders FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_inventory" ON public.inventory;
CREATE POLICY users_select_inventory ON public.inventory FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_listing_generations" ON public.listing_generations;
CREATE POLICY users_select_listing_generations ON public.listing_generations FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_logistics_channels" ON public.logistics_channels;
CREATE POLICY users_select_logistics_channels ON public.logistics_channels FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_materials" ON public.materials;
CREATE POLICY users_select_materials ON public.materials FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_order_rules" ON public.order_rules;
CREATE POLICY users_select_order_rules ON public.order_rules FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_orders" ON public.orders;
CREATE POLICY users_select_orders ON public.orders FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_outbound_orders" ON public.outbound_orders;
CREATE POLICY users_select_outbound_orders ON public.outbound_orders FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_ai_history" ON public.ai_history;
CREATE POLICY users_select_own_ai_history ON public.ai_history FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_cash_usage" ON public.ai_cash_usage;
CREATE POLICY users_select_own_cash_usage ON public.ai_cash_usage FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_free_quota" ON public.ai_free_quotas;
CREATE POLICY users_select_own_free_quota ON public.ai_free_quotas FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_invoice_links" ON public.invoice_links;
CREATE POLICY users_select_own_invoice_links ON public.invoice_links FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_invoices" ON public.invoices;
CREATE POLICY users_select_own_invoices ON public.invoices FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_listing_tasks" ON public.listing_tasks;
CREATE POLICY users_select_own_listing_tasks ON public.listing_tasks FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_listing_templates" ON public.listing_templates;
CREATE POLICY users_select_own_listing_templates ON public.listing_templates FOR SELECT TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_listings" ON public.listings;
CREATE POLICY users_select_own_listings ON public.listings FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_notifications" ON public.notifications;
CREATE POLICY users_select_own_notifications ON public.notifications FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_payment" ON public.payment_orders;
CREATE POLICY users_select_own_payment ON public.payment_orders FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_profile" ON public.profiles;
CREATE POLICY users_select_own_profile ON public.profiles FOR SELECT USING ((auth.uid() = id));

DROP POLICY IF EXISTS "users_select_own_profit_records" ON public.profit_records;
CREATE POLICY users_select_own_profit_records ON public.profit_records FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_quota" ON public.tenant_quotas;
CREATE POLICY users_select_own_quota ON public.tenant_quotas FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_recharge" ON public.quota_recharges;
CREATE POLICY users_select_own_recharge ON public.quota_recharges FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_shipping_quotes" ON public.shipping_quotes;
CREATE POLICY users_select_own_shipping_quotes ON public.shipping_quotes FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_sku_mappings" ON public.sku_mappings;
CREATE POLICY users_select_own_sku_mappings ON public.sku_mappings FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.listings l
  WHERE ((l.id = sku_mappings.listing_id) AND (l.user_id = auth.uid())))));

DROP POLICY IF EXISTS "users_select_own_stock_sync_logs" ON public.stock_sync_logs;
CREATE POLICY users_select_own_stock_sync_logs ON public.stock_sync_logs FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_stock_sync_queue" ON public.stock_sync_queue;
CREATE POLICY users_select_own_stock_sync_queue ON public.stock_sync_queue FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_sub_accounts" ON public.sub_accounts;
CREATE POLICY users_select_own_sub_accounts ON public.sub_accounts FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_subscriptions" ON public.subscriptions;
CREATE POLICY users_select_own_subscriptions ON public.subscriptions FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_sync_logs" ON public.order_sync_logs;
CREATE POLICY users_select_own_sync_logs ON public.order_sync_logs FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_sync_state" ON public.shop_sync_state;
CREATE POLICY users_select_own_sync_state ON public.shop_sync_state FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_own_usage" ON public.ai_usage_logs;
CREATE POLICY users_select_own_usage ON public.ai_usage_logs FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_pricing_templates" ON public.pricing_templates;
CREATE POLICY users_select_pricing_templates ON public.pricing_templates FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_product_variants" ON public.product_variants;
CREATE POLICY users_select_product_variants ON public.product_variants FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_products" ON public.products;
CREATE POLICY users_select_products ON public.products FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_purchase_suggestions" ON public.purchase_suggestions;
CREATE POLICY users_select_purchase_suggestions ON public.purchase_suggestions FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_reconciliations" ON public.reconciliations;
CREATE POLICY users_select_reconciliations ON public.reconciliations FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_return_orders" ON public.return_orders;
CREATE POLICY users_select_return_orders ON public.return_orders FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_settlement_logs" ON public.settlement_sync_logs;
CREATE POLICY users_select_settlement_logs ON public.settlement_sync_logs FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_settlement_state" ON public.settlement_sync_state;
CREATE POLICY users_select_settlement_state ON public.settlement_sync_state FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_shipments" ON public.shipments;
CREATE POLICY users_select_shipments ON public.shipments FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_shop_auths" ON public.shop_auths;
CREATE POLICY users_select_shop_auths ON public.shop_auths FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_shop_licenses" ON public.shop_licenses;
CREATE POLICY users_select_shop_licenses ON public.shop_licenses FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_shop_listing_rules" ON public.shop_listing_rules;
CREATE POLICY users_select_shop_listing_rules ON public.shop_listing_rules FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_shops" ON public.shops;
CREATE POLICY users_select_shops ON public.shops FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_source_auths" ON public.source_auths;
CREATE POLICY users_select_source_auths ON public.source_auths FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_suppliers" ON public.suppliers;
CREATE POLICY users_select_suppliers ON public.suppliers FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_traffic_stats" ON public.traffic_stats;
CREATE POLICY users_select_traffic_stats ON public.traffic_stats FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_select_translate_packs" ON public.translate_packs;
CREATE POLICY users_select_translate_packs ON public.translate_packs FOR SELECT USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_after_sales" ON public.after_sales;
CREATE POLICY users_update_after_sales ON public.after_sales FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_benefit_grants" ON public.benefit_grants;
CREATE POLICY users_update_benefit_grants ON public.benefit_grants FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_bills" ON public.bills;
CREATE POLICY users_update_bills ON public.bills FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_cn_listing_generations" ON public.cn_listing_generations;
CREATE POLICY users_update_cn_listing_generations ON public.cn_listing_generations FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_collect_items" ON public.collect_items;
CREATE POLICY users_update_collect_items ON public.collect_items FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_competitor_tracks" ON public.competitor_tracks;
CREATE POLICY users_update_competitor_tracks ON public.competitor_tracks FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_country_tax_rates" ON public.country_tax_rates;
CREATE POLICY users_update_country_tax_rates ON public.country_tax_rates FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_fba_fee_tiers" ON public.fba_fee_tiers;
CREATE POLICY users_update_fba_fee_tiers ON public.fba_fee_tiers FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_fee_accounts" ON public.fee_accounts;
CREATE POLICY users_update_fee_accounts ON public.fee_accounts FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_fee_records" ON public.platform_fee_records;
CREATE POLICY users_update_fee_records ON public.platform_fee_records FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_fee_settings" ON public.fee_settings;
CREATE POLICY users_update_fee_settings ON public.fee_settings FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_fees" ON public.fees;
CREATE POLICY users_update_fees ON public.fees FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_inbound_orders" ON public.inbound_orders;
CREATE POLICY users_update_inbound_orders ON public.inbound_orders FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_inventory" ON public.inventory;
CREATE POLICY users_update_inventory ON public.inventory FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_logistics_channels" ON public.logistics_channels;
CREATE POLICY users_update_logistics_channels ON public.logistics_channels FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_materials" ON public.materials;
CREATE POLICY users_update_materials ON public.materials FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_order_rules" ON public.order_rules;
CREATE POLICY users_update_order_rules ON public.order_rules FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_orders" ON public.orders;
CREATE POLICY users_update_orders ON public.orders FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_outbound_orders" ON public.outbound_orders;
CREATE POLICY users_update_outbound_orders ON public.outbound_orders FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_ai_history" ON public.ai_history;
CREATE POLICY users_update_own_ai_history ON public.ai_history FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_invoices" ON public.invoices;
CREATE POLICY users_update_own_invoices ON public.invoices FOR UPDATE TO authenticated USING (((user_id = auth.uid()) AND (status = 'pending'::text))) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_listing_tasks" ON public.listing_tasks;
CREATE POLICY users_update_own_listing_tasks ON public.listing_tasks FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_listing_templates" ON public.listing_templates;
CREATE POLICY users_update_own_listing_templates ON public.listing_templates FOR UPDATE TO authenticated USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_listings" ON public.listings;
CREATE POLICY users_update_own_listings ON public.listings FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_notifications" ON public.notifications;
CREATE POLICY users_update_own_notifications ON public.notifications FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_profile" ON public.profiles;
CREATE POLICY users_update_own_profile ON public.profiles FOR UPDATE USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));

DROP POLICY IF EXISTS "users_update_own_profit_records" ON public.profit_records;
CREATE POLICY users_update_own_profit_records ON public.profit_records FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_quota" ON public.tenant_quotas;
CREATE POLICY users_update_own_quota ON public.tenant_quotas FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_shipping_quotes" ON public.shipping_quotes;
CREATE POLICY users_update_own_shipping_quotes ON public.shipping_quotes FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_own_sub_accounts" ON public.sub_accounts;
CREATE POLICY users_update_own_sub_accounts ON public.sub_accounts FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_pricing_templates" ON public.pricing_templates;
CREATE POLICY users_update_pricing_templates ON public.pricing_templates FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_product_variants" ON public.product_variants;
CREATE POLICY users_update_product_variants ON public.product_variants FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_products" ON public.products;
CREATE POLICY users_update_products ON public.products FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_purchase_suggestions" ON public.purchase_suggestions;
CREATE POLICY users_update_purchase_suggestions ON public.purchase_suggestions FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_reconciliations" ON public.reconciliations;
CREATE POLICY users_update_reconciliations ON public.reconciliations FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_return_orders" ON public.return_orders;
CREATE POLICY users_update_return_orders ON public.return_orders FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_shipments" ON public.shipments;
CREATE POLICY users_update_shipments ON public.shipments FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_shop_auths" ON public.shop_auths;
CREATE POLICY users_update_shop_auths ON public.shop_auths FOR UPDATE USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_shop_licenses" ON public.shop_licenses;
CREATE POLICY users_update_shop_licenses ON public.shop_licenses FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_shop_listing_rules" ON public.shop_listing_rules;
CREATE POLICY users_update_shop_listing_rules ON public.shop_listing_rules FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_shops" ON public.shops;
CREATE POLICY users_update_shops ON public.shops FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_source_auths" ON public.source_auths;
CREATE POLICY users_update_source_auths ON public.source_auths FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_suppliers" ON public.suppliers;
CREATE POLICY users_update_suppliers ON public.suppliers FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_traffic_stats" ON public.traffic_stats;
CREATE POLICY users_update_traffic_stats ON public.traffic_stats FOR UPDATE USING ((user_id = auth.uid()));

DROP POLICY IF EXISTS "users_update_translate_packs" ON public.translate_packs;
CREATE POLICY users_update_translate_packs ON public.translate_packs FOR UPDATE USING ((user_id = auth.uid()));

ALTER TABLE public.warehouses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "warehouses_owner" ON public.warehouses;
CREATE POLICY warehouses_owner ON public.warehouses USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.waybills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "waybills_owner" ON public.waybills;
CREATE POLICY waybills_owner ON public.waybills USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

ALTER TABLE public.webhooks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "webhooks owner" ON public.webhooks;
CREATE POLICY "webhooks owner" ON public.webhooks USING ((user_id = auth.uid())) WITH CHECK ((user_id = auth.uid()));

-- =====================================================================
-- 段5 · 基线后增量迁移（与 migrations/20261116_oe01_order_events.sql 同源，幂等）
-- 记录为什么在这里：2026-11-16 基线抓取后，线上又新增 order_events 表（订单时间线修复）。
-- 基线单独跑、或「基线 + 独立迁移文件」两种路径都必须收敛到同一结构，故整段并回基线。
-- =====================================================================
-- 20261116_oe01_order_events.sql
-- 订单事件时间线：修复「订单详情页时间线永远为空」
--
-- 现场证据（2026-11-16 运行时排查）：
--   src/routes/_layout.orders_.$id.tsx:97 查询 order_events，但该表在库里不存在；
--   代码写的是 `setTimeline((tl ?? []) ...)`，错误被吞 → 页面不报错，时间线恒空。
--   订单本身已能正常入库（sync-orders 已接通 WooCommerce / Ozon）。
--
-- 本迁移只做两件事：
--   1) 建表 order_events + RLS（与 orders 同权限口径：本人可见、admin 全可见）
--   2) 挂 AFTER INSERT / AFTER UPDATE 触发器，订单创建与状态变化自动写事件
--      —— 事件由数据库触发器写，任何写入路径（EF 同步、手工建单、页面编辑、发货）都会留下轨迹
--
-- 幂等：全部 IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS，可重复执行。
-- 事件文案：message 存中文明细（金额/店铺/状态流转），前端 orderEvent.<type> 有 i18n 时优先用 i18n，
--           否则回落到 message（现网暂无 orderEvent.* 词条，回落生效）。
-- =====================================================================

SET search_path = public;

-- ─── 1. 表 ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.order_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    text NOT NULL,
  user_id     uuid,
  event_type  text NOT NULL,
  message     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 外键：订单删除时事件一并清理（IF NOT EXISTS 通过 constraint 名重复执行安全）
DO $q$ BEGIN
  ALTER TABLE public.order_events
    ADD CONSTRAINT order_events_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
  WHEN undefined_table THEN RAISE NOTICE '[跳过外键] orders 表不存在';
END $q$;

DO $q$ BEGIN
  ALTER TABLE public.order_events
    ADD CONSTRAINT order_events_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $q$;

CREATE INDEX IF NOT EXISTS order_events_order_created_idx
  ON public.order_events (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS order_events_user_created_idx
  ON public.order_events (user_id, created_at DESC);

COMMENT ON TABLE public.order_events IS '订单事件时间线（触发器自动写入：入库、状态流转）';

-- ─── 2. RLS（口径与 orders 一致） ────────────────────────────────────
ALTER TABLE public.order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS users_select_order_events ON public.order_events;
CREATE POLICY users_select_order_events ON public.order_events
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS admins_select_order_events ON public.order_events;
CREATE POLICY admins_select_order_events ON public.order_events
  FOR SELECT USING (has_role(auth.uid(), 'admin'::text));

-- ─── 3. 事件写入函数 + 触发器 ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.log_order_event()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.order_events (order_id, user_id, event_type, message)
    VALUES (
      NEW.id,
      NEW.user_id,
      'created',
      format('订单入库：%s ｜ %s ｜ %s %s',
        COALESCE(NULLIF(NEW.channel, ''), '未知渠道'),
        COALESCE(NULLIF(NEW.shop_name, ''), '无店铺'),
        COALESCE(NEW.amount::text, '0'),
        COALESCE(NEW.currency, '')
      )
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.order_events (order_id, user_id, event_type, message)
    VALUES (
      NEW.id,
      COALESCE(NEW.user_id, OLD.user_id),
      'status',
      format('状态变化：%s → %s', OLD.status, NEW.status)
    );
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS trg_order_event_created ON public.orders;
CREATE TRIGGER trg_order_event_created
  AFTER INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_event();

DROP TRIGGER IF EXISTS trg_order_event_status ON public.orders;
CREATE TRIGGER trg_order_event_status
  AFTER UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.log_order_event();

-- ─── 4. 历史订单回填（一次性，可重复执行：已有 created 事件的单不重复补） ──
INSERT INTO public.order_events (order_id, user_id, event_type, message, created_at)
SELECT
  o.id,
  o.user_id,
  'created',
  format('订单入库（历史回填）：%s ｜ %s ｜ %s %s',
    COALESCE(NULLIF(o.channel, ''), '未知渠道'),
    COALESCE(NULLIF(o.shop_name, ''), '无店铺'),
    COALESCE(o.amount::text, '0'),
    COALESCE(o.currency, '')
  ),
  o.created_at
FROM public.orders o
WHERE NOT EXISTS (
  SELECT 1 FROM public.order_events e WHERE e.order_id = o.id AND e.event_type = 'created'
);
