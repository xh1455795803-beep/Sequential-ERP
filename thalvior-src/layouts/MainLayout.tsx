import { useEffect, useMemo, useState } from 'react';
import { Layout, Menu, theme, Avatar, Dropdown, Badge, Input, Tag, Space, Select, Tooltip } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
  QuestionCircleOutlined,
  FullscreenOutlined,
  SearchOutlined,
  UserOutlined,
  LogoutOutlined,
  SettingOutlined,
  GlobalOutlined,
  DollarOutlined,
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { menuConfig, type MenuNode } from '../menu/menuConfig';
import { filterMenuByPerm, toAntdMenuItems } from '../menu/filterMenu';
import { useAuthStore, useUiStore, useI18nStore } from '../store/auth';
import { usePermission } from '../hooks/usePermission';
import { notificationApi, i18nApi } from '../api';
import { SUPPORTED_LOCALES } from '../hooks/useCurrency';
import AiSupportWidget from '../components/AiSupportWidget';
import { useTranslation } from '../i18n/useTranslation';

const { Header, Sider, Content } = Layout;

// 妙手风格主色 (青蓝)
const MS_GRADIENT = 'linear-gradient(90deg, #0ca389 0%, #18c3a6 55%, #2bd4b4 100%)';

/** 把节点 path 以绝对路径形式返回 (兼容相对/绝对) */
function absPath(path: string, parent: string): string {
  const isAbs = path.startsWith('/');
  return isAbs ? path : `${parent.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

/** 取分组下第一个叶子绝对路径, 用于一级导航点击跳转 */
function firstLeafPath(node: MenuNode, parent = ''): string {
  const self = absPath(node.path, parent);
  if (!node.children?.length) return self;
  for (const c of node.children) {
    const leaf = firstLeafPath(c, self);
    if (leaf) return leaf;
  }
  return self;
}

/** 递归找出当前路由在当前分组内的所有祖先 path (用于左侧自动展开三级) */
function findAncestors(nodes: MenuNode[], target: string, parent = '', acc: string[] = []): string[] {
  for (const n of nodes) {
    const self = absPath(n.path, parent);
    const next = [...acc, self];
    if (self === target) return acc;
    if (n.children?.length) {
      const r = findAncestors(n.children, target, self, next);
      if (r.length || r === next) return r;
    }
  }
  return [];
}

export default function MainLayout() {
  const { collapsed, toggleCollapsed } = useUiStore();
  const { user, logout } = useAuthStore();
  const { displayCurrency, locale, setDisplayCurrency, setLocale } = useI18nStore();
  const { has } = usePermission();
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();
  const {
    token: { colorBgContainer, colorBgLayout },
  } = theme.useToken();

  // 币种列表
  const { data: currencies } = useQuery({
    queryKey: ['i18n-currencies'],
    queryFn: () => i18nApi.currencies(),
    enabled: !!user,
  });

  // 登录拦截
  useEffect(() => {
    if (!user) navigate('/login', { replace: true });
  }, [user, navigate]);

  // 顶栏未读消息数
  const { data: unreadData } = useQuery({
    queryKey: ['notification-unread-bell'],
    queryFn: () => notificationApi.unread(),
    refetchInterval: 30000,
    enabled: !!user,
  });
  const unreadCount = unreadData?.count || 0;

  // 根据用户权限过滤菜单
  const filteredMenu = useMemo(() => filterMenuByPerm(menuConfig, has), [user, has, locale]);

  // 一级分组 (横向)
  const topItems = useMemo(
    () =>
      filteredMenu.map((n) => ({
        key: n.key,
        label: n.label,
        icon: n.icon ? (() => { const Icon = n.icon!; return <Icon />; })() : undefined,
      })),
    [filteredMenu, locale],
  );

  // 当前所在的一级分组
  const activeTop = useMemo(() => {
    let best: MenuNode | undefined;
    for (const n of filteredMenu) {
      if (location.pathname === n.path || location.pathname.startsWith(`${n.path}/`)) {
        if (!best || n.path.length > best.path.length) best = n;
      }
    }
    return best;
  }, [filteredMenu, location.pathname]);

  // 左侧二级/三级菜单 (只显示当前分组的)
  const sideItems = useMemo(
    () => (activeTop?.children?.length ? toAntdMenuItems(activeTop.children, activeTop.path, t) : []),
    [activeTop, t, locale],
  );

  // 左侧受控展开: 自动展开当前路由的分组内祖先
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!activeTop?.children?.length) return;
    const ancestors = findAncestors(activeTop.children, location.pathname, activeTop.path);
    if (ancestors.length) {
      setOpenKeys((prev) => Array.from(new Set([...prev, ...ancestors])));
    }
  }, [location.pathname, activeTop]);

  // 一级导航点击: 跳到该分组第一个叶子
  const handleTopNav = ({ key }: { key: string }) => {
    const node = filteredMenu.find((n) => n.key === key || n.path === key);
    if (node) navigate(firstLeafPath(node, ''));
  };

  // 当前路由被权限裁掉时兜底
  useEffect(() => {
    if (!user) return;
    if (['/login', '/register', '/'].includes(location.pathname)) return;
    const inMenu = filteredMenu.some((m) => location.pathname.startsWith(m.path));
    if (!inMenu) navigate('/workbench/overview', { replace: true });
  }, [filteredMenu, location.pathname, user, navigate]);

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: `${user?.name || t('common.anonymous')} · ${user?.tenantName || ''}` , disabled: true },
      { key: 'roles', icon: <Tag color="blue">{t('menu.rolePermissions')}</Tag>, label: (user?.roles || []).join(' / ') || t('common.noRole'), disabled: true },
      { type: 'divider' as const },
      { key: 'setting', icon: <SettingOutlined />, label: t('common.accountSettings') },
      { type: 'divider' as const },
      { key: 'logout', icon: <LogoutOutlined />, label: t('common.logout'), danger: true },
    ],
    onClick: ({ key }: { key: string }) => {
      if (key === 'logout') {
        logout();
        navigate('/login', { replace: true });
      }
    },
  };

  if (!user) return null;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ===== 妙手风格顶部导航 ===== */}
      <Header
        style={{
          padding: 0,
          height: 'auto',
          lineHeight: 'normal',
          background: MS_GRADIENT,
          position: 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        {/* 第一行: logo + 中央搜索 + 右侧工具 */}
        <div
          style={{
            height: 48,
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px 0 8px',
            gap: 10,
            color: '#fff',
          }}
        >
          <span onClick={toggleCollapsed} style={{ fontSize: 18, cursor: 'pointer', color: '#fff', marginRight: 2 }}>
            {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, whiteSpace: 'nowrap' }}>
            <span style={{ fontWeight: 800, fontSize: 20, letterSpacing: 1, color: '#fff' }}>
              thalvior
            </span>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#fff',
                background: 'rgba(255,255,255,0.28)',
                padding: '1px 6px',
                borderRadius: 4,
              }}
            >
              ERP
            </span>
          </div>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'center', padding: '0 10px' }}>
            <Input
              placeholder={t('common.searchMenuOrderSku')}
              prefix={<SearchOutlined style={{ color: 'rgba(0,0,0,0.45)' }} />}
              style={{ width: 320, borderRadius: 6, background: '#fff', border: 0 }}
              allowClear
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 16, color: '#fff' }}>
            <Tag color="rgba(255,255,255,0.28)" style={{ color: '#fff', border: 0 }}>v0.1.0</Tag>
            <Tooltip title={t('common.switchCurrency')}>
              <Select
                size="small"
                value={displayCurrency}
                onChange={setDisplayCurrency}
                style={{ width: 90 }}
                suffixIcon={<DollarOutlined style={{ color: '#fff' }} />}
                options={(currencies || []).map((c) => ({ value: c.code, label: `${c.symbol} ${c.code}` }))}
              />
            </Tooltip>
            <Tooltip title={t('common.switchLanguage')}>
              <Select
                size="small"
                value={locale}
                onChange={setLocale}
                style={{ width: 110 }}
                suffixIcon={<GlobalOutlined style={{ color: '#fff' }} />}
                options={SUPPORTED_LOCALES.map((l) => ({ value: l.code, label: l.label }))}
              />
            </Tooltip>
            <FullscreenOutlined title={t('common.fullscreen')} style={{ cursor: 'pointer' }} />
            <QuestionCircleOutlined title={t('common.help')} style={{ cursor: 'pointer' }} />
            <Badge count={unreadCount} size="small" offset={[-4, 4]}>
              <BellOutlined
                style={{ fontSize: 18, cursor: 'pointer' }}
                onClick={() => navigate('/message/all')}
                title={t('common.messageCenter')}
              />
            </Badge>
            <Dropdown menu={userMenu} placement="bottomRight">
              <Space style={{ cursor: 'pointer' }}>
                <Avatar size={28} style={{ background: 'rgba(255,255,255,0.35)', color: '#fff', fontWeight: 700 }}>
                  {user.name?.[0] || 'U'}
                </Avatar>
                <span style={{ fontSize: 14, color: '#fff' }}>{user.name}</span>
              </Space>
            </Dropdown>
          </div>
        </div>
        {/* 第二行: 一级分组横向导航 */}
        <div
          style={{
            height: 40,
            background: 'rgba(0,0,0,0.05)',
            display: 'flex',
            alignItems: 'stretch',
            padding: '0 8px 0 4px',
            overflowX: 'auto',
          }}
        >
          <Menu
            theme="dark"
            mode="horizontal"
            items={topItems as any}
            selectedKeys={[activeTop?.key || '']}
            onClick={handleTopNav}
            style={{
              flex: 1,
              background: 'transparent',
              borderBottom: 0,
              minWidth: 'max-content',
              color: 'rgba(255,255,255,0.92)',
            }}
          />
        </div>
      </Header>

      {/* ===== 主体: 左侧二级菜单 + 内容区 ===== */}
      <Layout style={{ background: colorBgLayout }}>
        {activeTop?.children?.length ? (
          <Sider
            trigger={null}
            collapsible
            collapsed={collapsed}
            collapsedWidth={0}
            width={220}
            style={{
              background: colorBgContainer,
              boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
              overflow: 'auto',
              height: 'calc(100vh - 88px)',
              position: 'sticky',
              top: 88,
            }}
          >
            {/* 当前分组标题 */}
            <div
              style={{
                padding: '14px 16px 6px',
                fontSize: 13,
                color: 'rgba(0,0,0,0.55)',
                fontWeight: 600,
                letterSpacing: 0.5,
              }}
            >
              {activeTop.label}
            </div>
            <Menu
              mode="inline"
              items={sideItems as any}
              openKeys={collapsed ? [] : openKeys}
              onOpenChange={(keys) => setOpenKeys(keys as string[])}
              selectedKeys={[location.pathname]}
              onClick={({ key }) => navigate(key)}
              style={{ borderRight: 0, paddingBottom: 16 }}
            />
          </Sider>
        ) : null}
        <Content
          style={{
            margin: 16,
            padding: 20,
            minHeight: 'calc(100vh - 120px)',
            background: colorBgContainer,
            borderRadius: 8,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
      <AiSupportWidget />
    </Layout>
  );
}