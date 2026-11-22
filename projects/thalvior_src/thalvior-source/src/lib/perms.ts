// 前端权限点缓存 —— 全站一次会话只拉一次 my_permissions()
//
// 为什么要有这个文件：库里 72 个 G6 权限点（logistics.*）此前只有
// Edge Function 侧的 checkPerm 在用，前端各页面**完全不控权**，
// 按钮对任何登录用户都可点，真拦在 RLS/RPC 层报错。这里补上体验层。
//
// 真值来源是数据库函数，不在前端复刻任何判定逻辑：
//   my_permissions()  → SETOF text（当前用户 allow 且未被 deny 的全部 key）
//   has_perm(key)     → boolean（单点判定，服务端调用时用）
// 两者都已核对：owner 角色在 fw06 之前只覆盖 25/72，缺的 47 个全是
// fw01–fw04 新播却没授权的 key，所以前端一接权限就会全灰——先看 §0F。
//
// 失败口径（重要，别改）：**拉取失败时放行按钮**（fail-open）。
// 理由：真正的拦截在 RLS / SECURITY DEFINER / EF checkPerm，前端显隐只是
// 少点一次无效按钮。若这里改成 fail-closed，一次网络抖动会让用户看到
// 一整排灰按钮、并误以为权限被回收了，排查成本反而更高。
// 数据库返回的真实权限为空集时是 fail-closed（那是真没权限，不是故障）。
import { useSyncExternalStore } from "react";

import { supabase } from "@/supabase/client";

interface Snapshot {
  ready: boolean;
  failed: boolean;
  keys: Set<string>;
}

let snap: Snapshot = { ready: false, failed: false, keys: new Set<string>() };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setSnap(next: Snapshot) {
  snap = next;
  for (const l of listeners) l();
}

async function fetchOnce(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("my_permissions");
  loading = null;
  if (error || !Array.isArray(data)) {
    setSnap({ ready: true, failed: true, keys: new Set<string>() });
    return;
  }
  setSnap({ ready: true, failed: false, keys: new Set(data as string[]) });
}

/** 触发拉取（幂等，重复调用只发一次请求）；页面渲染时会自动调 */
export function ensurePerms(): void {
  if (snap.ready || loading) return;
  loading = fetchOnce();
}

/** 同步判定，给非组件代码（事件回调里）用 */
export function can(key: string): boolean {
  ensurePerms();
  if (!snap.ready || snap.failed) return true; // 未就绪 / 拉取失败 → 放行
  return snap.keys.has(key);
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  ensurePerms();
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot(): Snapshot {
  return snap;
}

/**
 * 页面用法：const { can } = usePerms();
 *         {can("logistics.statement.audit") ? <Button/> : null}
 * 只用于显隐/禁用，不要拿它当安全边界。
 */
export function usePerms(): {
  ready: boolean;
  failed: boolean;
  can: (key: string) => boolean;
  keys: string[];
} {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return {
    ready: s.ready,
    failed: s.failed,
    can: (key: string) => (!s.ready || s.failed ? true : s.keys.has(key)),
    keys: Array.from(s.keys),
  };
}

/** 切换账号/登出后必须重来一次，否则会沿用上一个身份的权限集 */
supabase.auth.onAuthStateChange(() => {
  loading = null;
  setSnap({ ready: false, failed: false, keys: new Set<string>() });
});
