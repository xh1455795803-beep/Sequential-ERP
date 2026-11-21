/**
 * warehouses API Layer —— Supabase 封装
 * 表: wms_warehouses, wms_zone, wms_bin
 * 类型: WmsWarehouse, WmsZone, WmsBin
 */
import { supabase } from '../../../lib/supabase';
import type { WmsWarehouse, WmsZone, WmsBin } from '../../../types';

const TABLE = 'wms_warehouses';

// ========== 基础 CRUD ==========

/** 全量查询 */
export async function selectAll<T = any>(
  table: string = TABLE,
  orderBy: string = 'created_at',
  asc: boolean = false,
): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order(orderBy, { ascending: asc });
  if (error) throw error;
  return (data || []) as T[];
}

/** 按 ID 单查 */
export async function selectById<T = any>(
  id: number,
  table: string = TABLE,
): Promise<T | null> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as T | null;
}

/** 条件查询 */
export async function selectWhere<T = any>(
  conditions: Record<string, any>,
  table: string = TABLE,
): Promise<T[]> {
  let q: any = supabase.from(table).select('*');
  for (const [k, v] of Object.entries(conditions)) {
    if (v !== undefined && v !== null) q = q.eq(k, v);
  }
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as T[];
}

/** 插入 */
export async function insertOne<T = any>(
  row: Partial<T>,
  table: string = TABLE,
): Promise<T> {
  const { data, error } = await supabase
    .from(table)
    .insert(row)
    .select()
    .single();
  if (error) throw error;
  return data as T;
}

/** 更新 */
export async function updateById<T = any>(
  id: number,
  patch: Partial<T>,
  table: string = TABLE,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update(patch)
    .eq('id', id);
  if (error) throw error;
}

/** 软删除（status=0 或 deleted_at） */
export async function deleteById(
  id: number,
  table: string = TABLE,
  softDelete: boolean = true,
): Promise<void> {
  if (softDelete) {
    const { error } = await supabase
      .from(table)
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) throw error;
  }
}
