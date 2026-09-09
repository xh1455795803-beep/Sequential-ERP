// 权限 / 工具 hooks
import { useMemo, useCallback } from 'react';
import { useAuthStore } from '../store/auth';

const EMPTY: string[] = [];

export function usePermission() {
  const perms = useAuthStore((s) => s.user?.permissions || EMPTY);
  const roles = useAuthStore((s) => s.user?.roles || EMPTY);
  const isSuper = perms.includes('*:*') || roles.includes('admin');

  const has = useCallback(
    (code: string) => isSuper || perms.includes(code),
    [isSuper, perms],
  );
  const hasAny = useCallback(
    (codes: string[]) => isSuper || codes.some((c) => perms.includes(c)),
    [isSuper, perms],
  );
  const hasAll = useCallback(
    (codes: string[]) => isSuper || codes.every((c) => perms.includes(c)),
    [isSuper, perms],
  );
  const notHas = useCallback((code: string) => !has(code), [has]);

  return useMemo(
    () => ({ permissions: perms, roles, isSuper, has, hasAny, hasAll, notHas }),
    [perms, roles, isSuper, has, hasAny, hasAll, notHas],
  );
}
