// 登录态存储载体的适配器（v2：token 固定单一载体，杜绝跨标签页互踢）
//
// v1 的做法是「切换载体 + 搬迁 token」：勾选 → localStorage，未勾选 → sessionStorage，
// 切换时把 token 从一个载体搬到另一个。这在多标签页下是灾难：
//   标签页 A 已登录（token 在 localStorage）
//   标签页 B 登录且勾选状态不同 → token 被搬到另一载体 → A 的 getSession() 读空 → A 被踢
//   用户回 A 重新登录 → 又搬回去 → B 被踢 …… 这正是「来回重新登录」的根因。
//
// v2 方案：token 永远只写 localStorage（唯一载体、永不搬迁）。
//   - 勾选「7 天免登录」：无任何附加约束，靠 refresh token 长续期 → 关浏览器再开仍登录
//   - 未勾选：额外写入「会话票据」，仅当前标签页（sessionStorage）持票才承认登录态
//       · 同标签页刷新 → sessionStorage 票据仍在 → 不掉登录
//       · 新开标签页 / 重开浏览器 → 无票据 → 需要重新登录
//     另加 12 小时绝对上限兜底，防止浏览器会话恢复策略把票据保留过久。
import type { SupportedStorage } from "@supabase/supabase-js";

const PREF_KEY = "meoo.auth.remember";
const EXPIRE_KEY = "meoo.auth.sessionExpireAt";
const TICKET_KEY = "meoo.auth.tabTicket";
const TOKEN_PATTERN = "auth-token";

/** 非记住模式的绝对上限：12 小时 */
const SESSION_ONLY_MAX_MS = 12 * 60 * 60 * 1000;

function safeGet(store: Storage, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(store: Storage, key: string, value: string): boolean {
  try {
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
function safeRemove(store: Storage, key: string): void {
  try {
    store.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** 当前是否「记住登录」（默认 true，与登录页勾选框默认值一致） */
let remember: boolean = safeGet(localStorage, PREF_KEY) !== "0";

/**
 * 自愈：清掉过期/孤儿的会话限制。
 * 老版本遗留的票据可能已经过期或与其标签页失联，若不清理，用户会一直被判定
 * 「未登录」且勾选框还显示未勾选，只能反复重登。这里在启动时一次性归位。
 */
(function healStaleSessionLimit(): void {
  const expireAt = Number(safeGet(localStorage, EXPIRE_KEY) || 0);
  if (!expireAt) return;
  // 只在票据超过 12 小时绝对上限时清理。这里不能做「票据一致性」判断——
  // 新标签页本来就没有票据，若在此刻自愈，反而会把「未勾选需重登」的语义抹掉。
  if (Date.now() <= expireAt) return;
  safeRemove(localStorage, EXPIRE_KEY);
  safeRemove(localStorage, TICKET_KEY);
  safeRemove(sessionStorage, TICKET_KEY);
  // 票据已失效说明用户终究要重新登录，恢复默认「记住」偏好，避免勾选框停在未勾选
  if (safeGet(localStorage, PREF_KEY) === "0") safeSet(localStorage, PREF_KEY, "1");
  remember = true;
})();

/**
 * 判断登录态是否应当被视作失效（仅在「未勾选免登录」时可能为真）
 */
function sessionOnlyExpired(): boolean {
  if (remember) return false;

  const expireAt = Number(safeGet(localStorage, EXPIRE_KEY) || 0);
  if (!expireAt) return false; // 从未以「未勾选」方式登录过 → 不额外限制
  if (Date.now() > expireAt) return true;

  const lsTicket = safeGet(localStorage, TICKET_KEY);
  const ssTicket = safeGet(sessionStorage, TICKET_KEY);
  // 票据缺失或不一致 → 说明是另一个标签页 / 重开的浏览器 → 不承认登录态
  if (!lsTicket || !ssTicket || lsTicket !== ssTicket) return true;

  return false;
}

/**
 * 设置「是否记住登录」。v2 不再搬迁 token，只维护票据与偏好，
 * 因此任何标签页都可以安全地调用它，不会影响其他标签页的登录态。
 */
function hasStoredToken(): boolean {
  try {
    return Object.keys(localStorage).some((k) => k.includes(TOKEN_PATTERN));
  } catch {
    return false;
  }
}

/**
 * 登录动作开始前调用：快照「登录前是否已存在会话」。
 * 用于区分「我自己刚写进去的 token」与「其他标签页早已存在的 token」——
 * 只有后者才是不能降级的理由。
 */
let hadTokenBeforeLogin: boolean | null = null;
export function beginLoginAttempt(): void {
  hadTokenBeforeLogin = hasStoredToken();
}

export function setRememberPreference(next: boolean): void {
  if (next) {
    // 记住模式：清掉一切会话限制（也会连带解除其他标签页的会话限制）
    remember = true;
    safeSet(localStorage, PREF_KEY, "1");
    safeRemove(localStorage, EXPIRE_KEY);
    safeRemove(localStorage, TICKET_KEY);
    safeRemove(sessionStorage, TICKET_KEY);
    return;
  }

  // 会话模式：若此刻已存在一个「记住」的活跃登录态（通常来自另一个已登录的标签页），
  // 则拒绝降级 —— 一旦降级，那个标签页下次读取存储时会被判定失效而被踢下线，
  // 这正是 v1 的「来回重新登录」。宁可宽松，也不能把已在线的会话踢掉。
  const currentlyRemembered = !safeGet(localStorage, TICKET_KEY);
  const preExisting = hadTokenBeforeLogin ?? hasStoredToken();
  if (preExisting && currentlyRemembered) {
    remember = true;
    safeSet(localStorage, PREF_KEY, "1");
    return;
  }

  // 会话模式：签发仅本标签页持有的票据
  remember = false;
  safeSet(localStorage, PREF_KEY, "0");
  const ticket = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  safeSet(localStorage, TICKET_KEY, ticket);
  safeSet(sessionStorage, TICKET_KEY, ticket);
  safeSet(localStorage, EXPIRE_KEY, String(Date.now() + SESSION_ONLY_MAX_MS));
}

export function getRememberPreference(): boolean {
  return remember;
}

/**
 * 会话模式下，把当前标签页的票据续期（用于「用户仍在操作则不要过期」的场景）。
 * 记住模式下无副作用。
 */
export function touchSessionTicket(): void {
  if (remember) return;
  const lsTicket = safeGet(localStorage, TICKET_KEY);
  if (lsTicket) safeSet(sessionStorage, TICKET_KEY, lsTicket);
}

/** 传给 createClient 的 storage 适配器：token 恒在 localStorage */
export const authStorage: SupportedStorage = {
  getItem: (key: string) => {
    if (key.includes(TOKEN_PATTERN) && sessionOnlyExpired()) return null;
    return safeGet(localStorage, key);
  },
  setItem: (key: string, value: string) => {
    safeSet(localStorage, key, value);
  },
  removeItem: (key: string) => {
    safeRemove(localStorage, key);
  },
};
