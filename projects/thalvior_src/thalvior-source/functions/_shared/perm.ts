// perm.ts — RBAC 权限闸门（S1 试点：order 模块）
// =====================================================================
// 唯一权威判定入口：数据库 public.has_perm(text)（spec §7.4）
//   查权限点 → 判断角色 → 允许/拒绝
//   · 用「调用者自己的 JWT」建客户端调用 has_perm，使 auth.uid() 正确落到调用者身上
//   · has_perm 为 SECURITY DEFINER，读取权限表不受 RLS 影响
//   · 判定失败（DB 不可达等）一律 fail-closed 返回 403，绝不放行
//   · 平台超管（profiles.role='admin'）与店主按 spec §4.2/§4.4 放行，行为与改造前一致
// =====================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export interface PermGate {
  allowed: boolean;
  perm_key: string;
  error?: string;
}

export async function checkPerm(req: Request, pKey: string): Promise<PermGate> {
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.toLowerCase().startsWith('bearer ')) {
    return { allowed: false, perm_key: pKey, error: 'missing_authorization' };
  }
  const url = Deno.env.get('SUPABASE_URL') ?? 'http://kong:8000';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? '';
  try {
    const c = createClient(url, anon, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await c.rpc('has_perm', { p_key: pKey });
    if (error) {
      // fail-closed：判定链路异常时不得放行
      return { allowed: false, perm_key: pKey, error: `perm_check_failed: ${error.message}` };
    }
    return { allowed: data === true, perm_key: pKey };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { allowed: false, perm_key: pKey, error: `perm_check_exception: ${msg}` };
  }
}
