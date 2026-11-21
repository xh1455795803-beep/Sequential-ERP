/**
 * WMS API 客户端 —— 统一 Supabase 查询封装
 */
import { supabase } from './supabase';

export async function apiSelect<T>(table: string, select = '*', eq?: Record<string, any>, order?: string): Promise<T[]> {
  let q = supabase.from(table).select(select);
  if (eq) {
    for (const [k, v] of Object.entries(eq)) q = q.eq(k, v);
  }
  if (order) q = q.order(order, { ascending: false });
  const { data, error } = await q;
  if (error) throw error;
  return (data as T[]) ?? [];
}

export async function apiInsert<T>(table: string, row: Partial<T>): Promise<T> {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw error;
  return data as T;
}

export async function apiUpdate<T>(table: string, id: number, patch: Partial<T>): Promise<T> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select().single();
  if (error) throw error;
  return data as T;
}

export async function apiDelete(table: string, id: number): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id);
  if (error) throw error;
}
