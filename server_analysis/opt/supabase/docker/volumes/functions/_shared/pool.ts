// 双积分池工具（2026-09-28 订阅与AI积分体系一期）
// 池A：AI 工作台积分（每日赠送 20，当日清零）——文生图/抠图/翻译/图生标题/编辑页内嵌 AI
// 池B：AI Agent 积分（每日赠送 100，当日清零）——Agent 对话/选品/数据
// 充值积分进工作台充值池，会员期内永久有效；扣分顺序：先赠送后充值
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const DAILY_WORKBENCH_FREE = 20;
export const DAILY_AGENT_FREE = 100;

export type Pool = 'workbench' | 'agent';

function poolCols(pool: Pool) {
  return {
    freeDate: pool === 'workbench' ? 'workbench_free_date' : 'agent_free_date',
    freeToday: pool === 'workbench' ? 'workbench_free_today' : 'agent_free_today',
    purchased: pool === 'workbench' ? 'workbench_credits' : 'agent_credits',
    daily: pool === 'workbench' ? DAILY_WORKBENCH_FREE : DAILY_AGENT_FREE,
  };
}

export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function admin() {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

// 确保当日赠送已发放；返回 { freeToday, purchased }
export async function ensureFreeGrant(userId: string, pool: Pool) {
  const db = admin();
  const cols = poolCols(pool);
  const today = todayStr();
  const { data: q } = await db
    .from('tenant_quotas')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!q) {
    await db.from('tenant_quotas').insert({
      user_id: userId,
      [cols.freeDate]: today,
      [cols.freeToday]: cols.daily,
      updated_at: new Date().toISOString(),
    });
    return { freeToday: cols.daily, purchased: 0 };
  }
  if (q[cols.freeDate] !== today) {
    await db
      .from('tenant_quotas')
      .update({ [cols.freeDate]: today, [cols.freeToday]: cols.daily, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    return { freeToday: cols.daily, purchased: Number(q[cols.purchased] ?? 0) };
  }
  return { freeToday: Number(q[cols.freeToday] ?? 0), purchased: Number(q[cols.purchased] ?? 0) };
}

// 池可用余额 = 今日赠送 + 充值积分
export async function getPoolBalance(userId: string, pool: Pool): Promise<number> {
  const g = await ensureFreeGrant(userId, pool);
  return g.freeToday + g.purchased;
}

// 扣分：先赠送后充值；余额不足返回 { ok:false, balance }
export async function deductFromPool(
  userId: string,
  pool: Pool,
  credits: number,
  onExhausted?: () => void,
): Promise<{ ok: true; freeUsed: number; paidUsed: number } | { ok: false; balance: number }> {
  const db = admin();
  const cols = poolCols(pool);
  const g = await ensureFreeGrant(userId, pool);
  const balance = g.freeToday + g.purchased;
  if (credits > balance) {
    return { ok: false, balance };
  }
  const freeUsed = Math.min(credits, g.freeToday);
  const paidUsed = credits - freeUsed;
  await db
    .from('tenant_quotas')
    .update({
      [cols.freeToday]: g.freeToday - freeUsed,
      [cols.purchased]: g.purchased - paidUsed,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);
  if (onExhausted && balance - credits <= 0) onExhausted();
  return { ok: true, freeUsed, paidUsed };
}

// 充值到账：进工作台充值池（永久有效）+ 活动权益发放（>=1000 积分解锁 title_free 60 天）
export async function addPurchasedCredits(userId: string, credits: number, sourcePackage?: string) {
  const db = admin();
  const today = todayStr();
  const { data: q } = await db
    .from('tenant_quotas')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (!q) {
    await db.from('tenant_quotas').insert({
      user_id: userId,
      workbench_credits: credits,
      workbench_free_date: today,
      workbench_free_today: 0,
      agent_free_date: today,
      agent_free_today: 0,
      updated_at: new Date().toISOString(),
    });
  } else {
    await db
      .from('tenant_quotas')
      .update({
        workbench_credits: Number(q.workbench_credits ?? 0) + credits,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
  }
  if (credits >= 1000) {
    const expires = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
    const { data: exists } = await db
      .from('benefit_grants')
      .select('id')
      .eq('user_id', userId)
      .eq('benefit_key', 'title_free')
      .eq('status', 'active')
      .gte('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!exists) {
      await db.from('benefit_grants').insert({
        user_id: userId,
        benefit_key: 'title_free',
        source_package: sourcePackage ?? null,
        expires_at: expires,
      });
    }
  }
}

// 活动权益是否生效
export async function hasBenefit(userId: string, benefitKey: string): Promise<boolean> {
  const db = admin();
  const { data } = await db
    .from('benefit_grants')
    .select('id')
    .eq('user_id', userId)
    .eq('benefit_key', benefitKey)
    .eq('status', 'active')
    .gte('expires_at', new Date().toISOString())
    .maybeSingle();
  return !!data;
}
