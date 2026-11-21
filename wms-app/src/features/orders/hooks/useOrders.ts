/**
 * orders Hooks —— React Query 封装
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../api/orders.api';
import type { WmsOrder } from '../../../types';

const QK = 'orders';

/** 列表 */
export function useOrdersList(table?: string) {
  return useQuery({
    queryKey: [QK, 'list', table],
    queryFn: () => api.selectAll(table),
  });
}

/** 按 ID 查单条 */
export function useOrdersById(id: number | null) {
  return useQuery({
    queryKey: [QK, 'id', id],
    enabled: !!id,
    queryFn: () => api.selectById(id!),
  });
}

/** 条件查询 */
export function useOrdersWhere(conditions: Record<string, any>, table?: string) {
  const key = JSON.stringify(conditions);
  return useQuery({
    queryKey: [QK, 'where', key, table],
    queryFn: () => api.selectWhere(conditions, table),
  });
}

/** 插入 */
export function useOrdersInsert(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (row: any) => api.insertOne(row, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}

/** 更新 */
export function useOrdersUpdate(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: any }) =>
      api.updateById(id, patch, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}

/** 删除 */
export function useOrdersDelete(table?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteById(id, table),
    onSuccess: () => qc.invalidateQueries({ queryKey: [QK] }),
  });
}
