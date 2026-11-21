/**
 * inventory Hooks —— React Query 封装
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/inventory.api';
import type { WmsInventory } from '../../../types';

const QK = 'inventory';

/** 列表 */
export function useInventoryList(table?: string) {
  return useQuery({
    queryKey: [QK, 'list', table],
    queryFn: () => api.selectAll(table),
  });
}

/** 按 ID 查单条 */
export function useInventoryById(id: number | null) {
  return useQuery({
    queryKey: [QK, 'id', id],
    enabled: !!id,
    queryFn: () => api.selectById(id!),
  });
}

/** 条件查询 */
export function useInventoryWhere(conditions: Record<string, any>, table?: string) {
  const key = JSON.stringify(conditions);
  return useQuery({
    queryKey: [QK, 'where', key, table],
    queryFn: () => api.selectWhere(conditions, table),
  });
}

/** 插入 */
export function useInventoryInsert(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: any) => api.insertOne(row, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}

/** 更新 */
export function useInventoryUpdate(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) =>
      api.updateById(id, patch, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}

/** 删除 */
export function useInventoryDelete(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteById(id, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}
