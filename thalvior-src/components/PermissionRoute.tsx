// 路由级权限守卫: 用 <PermissionRoute perm="product:list">...</PermissionRoute> 包裹业务页面
// - 未登录 -> 跳 /login
// - 已登录但无权限 -> 渲染 403 占位, 不跳转(避免误操作跳出)
import { useEffect } from 'react';
import { Result, Button, Space, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { usePermission } from '../hooks/usePermission';
import { useTranslation } from '../i18n';

const { Text } = Typography;

interface PermissionRouteProps {
  perm: string | string[];
  /** 缺少权限时是否回退到工作台, 默认 false(就显示 403) */
  redirectOnDeny?: boolean;
  children: React.ReactNode;
}

export default function PermissionRoute({
  perm,
  redirectOnDeny = false,
  children,
}: PermissionRouteProps) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const { has, hasAny } = usePermission();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  if (!user) return null;

  const codes = Array.isArray(perm) ? perm : [perm];
  const ok = codes.length === 1 ? has(codes[0]) : hasAny(codes);

  if (!ok) {
    if (redirectOnDeny) {
      // 静默重定向, 不让用户察觉拦截
      navigate('/workbench/overview', { replace: true });
      return null;
    }
    return (
      <Result
        status="403"
        title="403"
        subTitle={
          <Space direction="vertical" size={4}>
            <Text>{t('common.noPermission')}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {t('common.requiredPermission')}: {codes.join(' / ')}
            </Text>
          </Space>
        }
        extra={
          <Button type="primary" onClick={() => navigate('/workbench/overview', { replace: true })}>
            {t('common.backToWorkbench')}
          </Button>
        }
      />
    );
  }
  return <>{children}</>;
}
