// 菜单过滤: 根据用户权限递归裁剪菜单
// - 叶子节点无权限 -> 整条裁掉
// - 父节点裁空子节点 -> 父节点也裁掉
// - 不带 permission 字段的视为公开
import type { MenuNode } from './menuConfig';
import type { MenuProps } from 'antd';
import type { ComponentType } from 'react';
import { menuLabelKeys } from '../i18n/menuLabels';

export type HasPerm = (code: string) => boolean;

/** 递归过滤菜单, 去掉没有权限的项 */
export function filterMenuByPerm(
  nodes: MenuNode[],
  has: HasPerm,
): MenuNode[] {
  const out: MenuNode[] = [];
  for (const n of nodes) {
    // 当前节点要求权限, 且不通过 -> 直接跳过
    if (n.permission && !has(n.permission)) continue;
    if (n.children?.length) {
      const children = filterMenuByPerm(n.children, has);
      if (children.length === 0) {
        // 子节点全部被裁掉, 父节点也隐藏
        if (n.permission && !has(n.permission)) continue;
        // 父节点本身没有权限限制, 但子节点空了 -> 也隐藏避免空菜单
        continue;
      }
      out.push({ ...n, children });
    } else {
      out.push(n);
    }
  }
  return out;
}

/** 把 MenuNode 转成 antd Menu items
 * 子节点 path 支持相对 (如 "list") 或绝对 (如 "/auth/oneclick"):
 * - 绝对路径直接使用
 * - 相对路径拼到父路径之后
 */
export function toAntdMenuItems(
  nodes: MenuNode[],
  parentPath = '',
  t?: (key: string) => string,
): Required<MenuProps>['items'] {
  return nodes.map((n) => {
    const isAbs = n.path.startsWith('/');
    const fullPath = isAbs
      ? n.path
      : (parentPath ? `${parentPath}/${n.path.replace(/^\//, '')}` : n.path);
    const iconEl = n.icon ? (() => {
      const Icon = n.icon as ComponentType;
      return <Icon />;
    })() : undefined;
    // 支持国际化：若 label 在映射表中有翻译 key，则翻译
    const label = (t && menuLabelKeys[n.label]) ? t(menuLabelKeys[n.label]!) : n.label;
    if (n.children?.length) {
      return {
        key: fullPath,
        icon: iconEl,
        label,
        children: toAntdMenuItems(n.children, fullPath, t),
      } as any;
    }
    return {
      key: fullPath,
      icon: iconEl,
      label,
    } as any;
  });
}

/** 拍平所有菜单的叶子路径 */
export function flattenMenuPaths(nodes: MenuNode[], parent = ''): string[] {
  const acc: string[] = [];
  for (const n of nodes) {
    const isAbs = n.path.startsWith('/');
    const p = isAbs ? n.path : (parent ? `${parent}/${n.path.replace(/^\//, '')}` : n.path);
    if (n.children?.length) {
      acc.push(...flattenMenuPaths(n.children, p));
    } else {
      acc.push(p);
    }
  }
  return acc;
}
