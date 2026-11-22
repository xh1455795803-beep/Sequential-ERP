// 认证状态管理：封装 Supabase Auth 的 session 监听与用户信息
//
// 关键容错：Supabase 在 refresh 失败（网络抖动、跨境链路丢包）时会广播 SIGNED_OUT，
// 若直接采信会把正在操作的用户瞬间踢回登录页。这里对「无 session」类事件做二次复核，
// 只有真正读不到 session 才判定为未登录。
import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";
import { keepSessionAlive } from "@/lib/session";
import type { User } from "@supabase/supabase-js";

/** 复核登录态：refresh 抖动后的重试窗口内通常已恢复 */
async function recheckSession(): Promise<User | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user;
    await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
  }
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("active");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;

    supabase.auth.getSession().then(({ data }) => {
      if (disposed) return;
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (session?.user) {
        setUser(session.user);
        setLoading(false);
        return;
      }
      // INITIAL_SESSION 是客户端刚启动时的恢复事件：此时若 access token 已过期，
      // GoTrue 还在后台刷新中，事件携带的 session 可能是空的。直接采信会导致
      // 页面刚恢复就被误判为「未登录」踢回登录页（勾选 7 天免登录也躲不掉）。
      // 因此初始化事件也走二次复核，以 getSession 恢复完成的最终结果为准。
      recheckSession().then((u) => {
        if (disposed) return;
        setUser(u);
        setLoading(false);
      });
    });

    // 心跳续期：每 10 分钟保证 access token 新鲜，避免长开页面集中过期
    const heartbeat = setInterval(() => {
      void keepSessionAlive();
    }, 10 * 60 * 1000);

    return () => {
      disposed = true;
      clearInterval(heartbeat);
      listener.subscription.unsubscribe();
    };
  }, []);

  // 用户变化时读取角色与状态
  useEffect(() => {
    if (!user) {
      setRole(null);
      setStatus("active");
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select("role, status")
          .eq("id", user.id)
          .maybeSingle();
        setRole(data?.role ?? "tenant");
        setStatus(data?.status ?? "active");
      } catch {
        setRole("tenant");
        setStatus("active");
      }
    })();
  }, [user]);

  return { user, role, status, loading };
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
