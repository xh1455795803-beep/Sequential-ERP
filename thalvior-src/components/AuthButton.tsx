// 按钮级权限控制: 用法和普通 Button 一样, 多了一个 perm 属性
// <AuthButton type="primary" perm="product:create" onClick={...}>新增</AuthButton>
// 当用户没有 perm 时, 默认不渲染; 传 hideWhenNoPerm=false 则禁用显示
import { usePermission } from '../hooks/usePermission';
import { Button, type ButtonProps } from 'antd';

interface AuthButtonProps extends ButtonProps {
  perm: string | string[];
  /** 缺少权限时, true=不渲染(默认), false=禁用显示 */
  hideWhenNoPerm?: boolean;
}

export default function AuthButton({
  perm,
  hideWhenNoPerm = true,
  children,
  disabled,
  ...rest
}: AuthButtonProps) {
  const { has, hasAny } = usePermission();
  const codes = Array.isArray(perm) ? perm : [perm];
  const ok = codes.length === 1 ? has(codes[0]) : hasAny(codes);
  if (!ok) {
    if (hideWhenNoPerm) return null;
    return (
      <Button {...rest} disabled>
        {children}
      </Button>
    );
  }
  return (
    <Button {...rest} disabled={disabled}>
      {children}
    </Button>
  );
}
