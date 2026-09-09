import { createBrowserRouter, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Spin } from 'antd';
import MainLayout from '../layouts/MainLayout';
import { allPaths, menuConfig, type MenuNode } from '../menu/menuConfig';
import PermissionRoute from '../components/PermissionRoute';

const Login = lazy(() => import('../pages/Login'));
const Register = lazy(() => import('../pages/Register'));
const Dashboard = lazy(() => import('../pages/Dashboard'));
const OrderList = lazy(() => import('../pages/OrderList'));
const Placeholder = lazy(() => import('../pages/Placeholder'));
const ProductList = lazy(() => import('../pages/ProductList'));
const ProductEdit = lazy(() => import('../pages/ProductEdit'));
const OnlineProductList = lazy(() => import('../pages/OnlineProductList'));
const ShopList = lazy(() => import('../pages/ShopList'));
const InventoryList = lazy(() => import('../pages/InventoryList'));
const SyncCenter = lazy(() => import('../pages/SyncCenter'));
const ShopBind = lazy(() => import('../pages/ShopBind'));
const OneClickAuth = lazy(() => import('../pages/OneClickAuth'));
const OrderHandle = lazy(() => import('../pages/OrderHandle'));
const ManualOrder = lazy(() => import('../pages/ManualOrder'));
const PurchaseList = lazy(() => import('../pages/PurchaseList'));
const LogisticsList = lazy(() => import('../pages/LogisticsList'));
const FinanceList = lazy(() => import('../pages/FinanceList'));
const DataCenter = lazy(() => import('../pages/DataCenter'));
const SystemSettings = lazy(() => import('../pages/SystemSettings'));
const AftersaleList = lazy(() => import('../pages/AftersaleList'));
const BackupCenter = lazy(() => import('../pages/BackupCenter'));
const SchedulerCenter = lazy(() => import('../pages/SchedulerCenter'));
const WebhookCenter = lazy(() => import('../pages/WebhookCenter'));
const RuleManagement = lazy(() => import('../pages/RuleManagement'));
const MessageCenter = lazy(() => import('../pages/MessageCenter'));
const BillingPage = lazy(() => import('../pages/BillingPage'));
const AdsReport = lazy(() => import('../pages/AdsReport'));
const InviteCenter = lazy(() => import('../pages/InviteCenter'));
const PdaScanPage = lazy(() => import('../pages/PdaScanPage'));
const TenantIsolationPage = lazy(() => import('../pages/TenantIsolationPage'));
const BiDashboardPage = lazy(() => import('../pages/BiDashboardPage'));
const CouponsPage = lazy(() => import('../pages/CouponsPage'));
const CurrencyRatePage = lazy(() => import('../pages/CurrencyRatePage'));
const WorkflowCenter = lazy(() => import('../pages/WorkflowCenter'));
const RealtimeDashboard = lazy(() => import('../pages/RealtimeDashboard'));
const GenericListPage = lazy(() => import('../pages/Generic/ListPage'));
const LandingPage = lazy(() => import('../pages/Landing'));
const BookkeepingPage = lazy(() => import('../pages/BookkeepingPage'));

// 已实现的页面
const realPages: Record<string, () => any> = {
  '/workbench/overview': () => <Dashboard />,
  '/order/list': () => <OrderList />,
  '/order/manual': () => <ManualOrder />,
  '/order/handle/pending': () => <OrderHandle />,
  '/order/handle/pay': () => <OrderHandle />,
  '/order/handle/toship': () => <OrderHandle />,
  '/order/handle/ship': () => <OrderHandle />,
  '/order/handle/shipped': () => <OrderHandle />,
  '/order/handle/done': () => <OrderHandle />,
  '/order/handle/cancel': () => <OrderHandle />,
  '/order/handle/abnormal': () => <OrderHandle />,
  '/finance/profit': () => <FinanceList />,
  '/finance/platform': () => <FinanceList />,
  '/finance/fee': () => <FinanceList />,
  '/finance/cost': () => <FinanceList />,
  '/product/sku/list': () => <ProductList />,
  '/product/online/selling': () => <OnlineProductList />,
  '/product/online/off': () => <OnlineProductList />,
  '/product/online/illegal': () => <OnlineProductList />,
  '/product/online/sync': () => <OnlineProductList />,
  '/auth/shop': () => <ShopList />,
  '/warehouse/inventory': () => <InventoryList />,
  '/auth/sync': () => <SyncCenter />,
  '/auth/bind': () => <ShopBind />,
  '/auth/manual': () => <ShopBind />,
  '/auth/oneclick': () => <OneClickAuth />,
  '/purchase/supplier': () => <PurchaseList />,
  '/purchase/order': () => <PurchaseList />,
  '/logistics/channel': () => <LogisticsList />,
  '/logistics/waybill': () => <LogisticsList />,
  '/logistics/track': () => <LogisticsList />,
  '/data/overview': () => <DataCenter />,
  '/data/product': () => <DataCenter />,
  '/data/shop': () => <DataCenter />,
  '/data/sale': () => <DataCenter />,
  '/data/profit': () => <DataCenter />,
  '/system/sub': () => <SystemSettings />,
  '/system/role': () => <SystemSettings />,
  '/system/global': () => <SystemSettings />,
  '/system/notify': () => <SystemSettings />,
  '/system/op-log': () => <SystemSettings />,
  '/order/aftersale/refund': () => <AftersaleList />,
  '/order/aftersale/return': () => <AftersaleList />,
  '/order/aftersale/exchange': () => <AftersaleList />,
  '/order/aftersale/all': () => <AftersaleList />,
  '/system/backup': () => <BackupCenter />,
  '/system/scheduler': () => <SchedulerCenter />,
  '/system/webhook': () => <WebhookCenter />,
  // P1 规则引擎
  '/order/split': () => <RuleManagement />,
  '/order/review': () => <RuleManagement />,
  // P1 消息中心
  '/message/all': () => <MessageCenter />,
  '/message/unread': () => <MessageCenter />,
  // P2 计费
  '/system/billing/plan': () => <BillingPage />,
  '/system/billing/consume': () => <BillingPage />,
  '/system/billing/renew': () => <BillingPage />,
  // P1 广告数据
  '/ads/data': () => <AdsReport />,
  '/ads/report': () => <AdsReport />,
  '/ads/record': () => <AdsReport />,
  // P2 邀请分销
  '/system/invite': () => <InviteCenter />,
  // Phase 1: PDA 扫码
  '/warehouse/pda': () => <PdaScanPage />,
  // Phase 1: 租户隔离
  '/system/isolation': () => <TenantIsolationPage />,
  // Phase 5: BI 数据看板
  '/data/bi': () => <BiDashboardPage />,
  // Phase 6: 营销中心
  '/marketing/coupons': () => <CouponsPage />,
  // Phase 7: 多语言 / 多币种
  '/finance/rate': () => <CurrencyRatePage />,
  // Phase 8: 工作流引擎
  '/system/workflow': () => <WorkflowCenter />,
  // Phase 9: 实时大屏
  '/data/realtime': () => <RealtimeDashboard />,
  // Phase 12: 财务记账
  '/finance/bookkeeping/overview': () => <BookkeepingPage tab="overview" />,
  '/finance/bookkeeping/coa': () => <BookkeepingPage tab="coa" />,
  '/finance/bookkeeping/voucher': () => <BookkeepingPage tab="voucher" />,
  '/finance/bookkeeping/reconcile': () => <BookkeepingPage tab="reconcile" />,
  '/finance/bookkeeping/trial': () => <BookkeepingPage tab="trial" />,
  '/finance/bookkeeping/income': () => <BookkeepingPage tab="income" />,
};

const Loader = () => (
  <div style={{ display: 'flex', justifyContent: 'center', padding: 80 }}>
    <Spin size="large" />
  </div>
);

const wrap = (el: React.ReactNode) => <Suspense fallback={<Loader />}>{el}</Suspense>;

// 递归从 menuConfig 中找出每个路径对应的 permission
// 子节点 path 规则同 flattenPaths: 绝对路径直接使用, 相对路径拼到父路径之后
function buildPathPermMap(nodes: MenuNode[], parent = '', acc: Record<string, string> = {}): Record<string, string> {
  for (const n of nodes) {
    const isAbs = n.path.startsWith('/');
    const p = isAbs ? n.path : (parent ? `${parent}/${n.path.replace(/^\//, '')}` : n.path);
    if (n.permission) acc[p] = n.permission;
    if (n.children) buildPathPermMap(n.children, p, acc);
  }
  return acc;
}
const pathPermMap = buildPathPermMap(menuConfig);

function guard(perm: string, el: React.ReactNode) {
  return <PermissionRoute perm={perm}>{el}</PermissionRoute>;
}

function buildRoutes() {
  const children: any[] = [];

  for (const path of allPaths) {
    const C = realPages[path];
    let inner: React.ReactNode;
    if (C) inner = <C />;
    else if (path === '/login') inner = <Login />;
    else inner = <GenericListPage path={path} />;
    const perm = pathPermMap[path];
    children.push({
      path: path.slice(1),
      element: perm ? wrap(guard(perm, inner)) : wrap(inner),
    });
  }

  // 商品编辑/新增独立大页动态路由 (不在菜单中, 走局部权限)
  children.push({
    path: 'product/sku/edit/:id',
    element: wrap(guard('product:update', <ProductEdit />)),
  });
  children.push({
    path: 'product/sku/create',
    element: wrap(guard('product:create', <ProductEdit />)),
  });

  const topRedirects = [
    { from: '/workbench', to: '/workbench/overview' },
    { from: '/workbench', to: '/workbench/overview' },
    { from: '/auth', to: '/auth/shop' },
    { from: '/product', to: '/product/sku/list' },
    { from: '/order', to: '/order/list' },
    { from: '/message', to: '/message/all' },
    { from: '/custody', to: '/custody/prepare' },
    { from: '/purchase', to: '/purchase/supplier' },
    { from: '/warehouse', to: '/warehouse/inventory' },
    { from: '/logistics', to: '/logistics/channel' },
    { from: '/ads', to: '/ads/data' },
    { from: '/finance', to: '/finance/profit' },
    { from: '/data', to: '/data/overview' },
    { from: '/system', to: '/system/sub' },
  ];
  const subRedirects = [
    { from: '/product/sku', to: '/product/sku/list' },
    { from: '/product/online', to: '/product/online/selling' },
    { from: '/product/ai', to: '/product/ai/pick' },
    { from: '/auth/bind', to: '/auth/oneclick' },
    { from: '/order/handle', to: '/order/handle/pending' },
    { from: '/order/aftersale', to: '/order/aftersale/refund' },
    { from: '/warehouse/setting', to: '/warehouse/setting/self' },
    { from: '/warehouse/record', to: '/warehouse/record/in' },
    { from: '/logistics/customs', to: '/logistics/customs/tpl' },
    { from: '/system/billing', to: '/system/billing/plan' },
  ];

  return [
    { path: '/', element: wrap(<LandingPage />) },
    { path: '/landing', element: wrap(<LandingPage />) },
    { path: '/login', element: wrap(<Login />) },
    { path: '/register', element: wrap(<Register />) },
    {
      path: '/',
      element: <MainLayout />,
      children: [
        ...topRedirects.map((r) => ({ path: r.from.slice(1), element: <Navigate to={r.to} replace /> })),
        ...subRedirects.map((r) => ({ path: r.from.slice(1), element: <Navigate to={r.to} replace /> })),
        ...children,
        {
          path: '*',
          element: wrap(<Placeholder />),
        },
      ],
    },
  ];
}

export const router = createBrowserRouter(buildRoutes());
