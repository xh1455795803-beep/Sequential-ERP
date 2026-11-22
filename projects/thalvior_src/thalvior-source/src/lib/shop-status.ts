// ─── 授权状态白名单（前端侧；与 EF 的 functions/_shared/shop-status.ts 同源同值） ──────────
// shop_auths.status 的 CHECK 白名单（migrations/20261025_sa01_extend_shop_auths.sql）：
//   已授权 / 待验证 / 即将到期 / 已过期 / 已停用 / 未授权 / 正常
//
// 「即将到期」= 凭据仍有效，但距 token_expires_at ≤30 天 → 店铺【仍然可用】。
// 状态机上线后，这批店会被改写成「即将到期」；若前端仍写死 `=== "已授权"`，
// 它们会从刊登 / 发货 / 结算的目标店铺里凭空消失（功能性回归）。
export const ACTIVE_AUTH_STATUSES = ["已授权", "即将到期"] as const;

/** 授权是否仍然可用（已授权 或 即将到期） */
export function isActiveAuthStatus(status: unknown): boolean {
  return typeof status === "string" && (ACTIVE_AUTH_STATUSES as readonly string[]).includes(status);
}
