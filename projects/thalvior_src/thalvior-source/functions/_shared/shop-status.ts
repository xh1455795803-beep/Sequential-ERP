// ─── 授权状态白名单（EF 侧唯一事实源） ───────────────────────────────
// shop_auths.status 的 CHECK 白名单（migrations/20261025_sa01_extend_shop_auths.sql）：
//   已授权 / 待验证 / 即将到期 / 已过期 / 已停用 / 未授权 / 正常
//
// 语义分工：
//   已授权    = 凭据已通过平台官方接口真实验证
//   即将到期  = 凭据仍有效，但距 token_expires_at ≤30 天 → 店铺【仍然可用】
//   待验证 / 已过期 / 已停用 / 未授权 = 不可用（拒绝刊登 / 发货 / 结算）
//
// ⚠️ 改造前共 13 处判定写死 `=== '已授权'` / `.eq('status','已授权')`：
//    状态机一旦开始写「即将到期」，即将到期的店会被误踢出结算 / 刊登 / 发货链路（功能回归）。
//    故统一收敛到本模块 —— 状态白名单只在这里改一处。
export const ACTIVE_AUTH_STATUSES = ['已授权', '即将到期'] as const;

export type ActiveAuthStatus = (typeof ACTIVE_AUTH_STATUSES)[number];

/** 授权是否仍然可用（已授权 / 即将到期） */
export function isActiveAuthStatus(status: unknown): boolean {
  return typeof status === 'string' && (ACTIVE_AUTH_STATUSES as readonly string[]).includes(status);
}

/** 明确不可用的状态（用于提示文案，不参与放行判断） */
export const INACTIVE_AUTH_STATUSES = ['待验证', '已过期', '已停用', '未授权'] as const;

/** 放行用数组（PostgREST .in() 需要 string[]，故这里展开一次） */
export const ACTIVE_AUTH_STATUS_LIST: string[] = [...ACTIVE_AUTH_STATUSES];
