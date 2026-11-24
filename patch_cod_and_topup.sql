-- COD 结算表（代收 → 仓库确认 → 平台审核 → 打款）
CREATE TABLE IF NOT EXISTS tlv_cod_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES tlv_warehouses(id) ON DELETE SET NULL,
  outbound_ids uuid[] NOT NULL DEFAULT '{}',
  order_count integer DEFAULT 0,
  cod_total numeric(12,2) NOT NULL DEFAULT 0,
  fee_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  fee_pct numeric(5,2) DEFAULT 3.00,
  status text NOT NULL DEFAULT 'pending_warehouse'
    CHECK (status IN ('pending_warehouse','pending_admin','pending_pay','paid','cancelled','failed')),
  warehouse_approved_at timestamptz,
  admin_approved_at timestamptz,
  paid_at timestamptz,
  note text,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cod_settle_merchant ON tlv_cod_settlements(merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_cod_settle_status ON tlv_cod_settlements(status);
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_cod_settlements_all ON tlv_cod_settlements FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 钱包充值订单表（第三方支付通道中间态）
CREATE TABLE IF NOT EXISTS tlv_wallet_topup_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES tlv_merchants(id) ON DELETE CASCADE,
  amount numeric(12,2) NOT NULL,
  currency text DEFAULT 'CNY',
  provider text NOT NULL CHECK (provider IN ('stripe','wechatpay','alipay','offline')),
  provider_ref text,
  client_secret text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','expired','refunded')),
  paid_at timestamptz,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topup_merchant ON tlv_wallet_topup_orders(merchant_id, status);
DO $$ BEGIN EXECUTE 'CREATE POLICY tlv_wallet_topup_orders_all ON tlv_wallet_topup_orders FOR ALL USING (true) WITH CHECK (true)'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 辅助：从 wallet 流水反算 merchant.balance（钱包表 append-only，可能与 merchants.balance 不同步）
CREATE OR REPLACE FUNCTION tlv_recompute_merchant_balance(p_merchant_id uuid)
RETURNS numeric(12,2) LANGUAGE sql AS $$
  UPDATE tlv_merchants
  SET balance = COALESCE((SELECT SUM(amount) FROM tlv_merchant_wallets WHERE merchant_id = p_merchant_id), 0),
      updated_at = now()
  WHERE id = p_merchant_id
  RETURNING balance;
$$;
GRANT EXECUTE ON FUNCTION tlv_recompute_merchant_balance(uuid) TO authenticated, anon;

SELECT 'COD settlement tables & balance recompute RPC deployed' AS done;
