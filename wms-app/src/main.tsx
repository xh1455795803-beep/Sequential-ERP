import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute, redirect } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase, getAuthContext, PortalRole } from './lib/supabase';
import { RootLayout } from './layouts/RootLayout';
import './styles.css';

const queryClient = new QueryClient();

// ============ AUTH GUARD ============
async function requireAuth(allowedPortal: PortalRole) {
  const ctx = await getAuthContext();
  if (!ctx.user) throw redirect({ to: `/${allowedPortal}/login` });
  if (ctx.portalRole !== allowedPortal) {
    // 登录了但角色不匹配 — 重定向到对应 portal 的 dashboard
    const target = ctx.portalRole || 'merchant';
    throw redirect({ to: `/${target}/dashboard` });
  }
}

// ============ IMPORTS ============
import { UnifiedLoginPage } from './pages/UnifiedLoginPage';
// Merchant
import { MerchantLoginPage } from './pages/merchant/MerchantLoginPage';
import { MerchantRegisterPage } from './pages/merchant/MerchantRegisterPage';
import { MerchantDashboardPage } from './pages/merchant/MerchantDashboardPage';
import { MerchantInventoryPage } from './pages/merchant/MerchantInventoryPage';
import { MerchantInboundPage } from './pages/merchant/MerchantInboundPage';
import { MerchantInboundCreatePage } from './pages/merchant/MerchantInboundCreatePage';
import { MerchantOutboundPage } from './pages/merchant/MerchantOutboundPage';
import { MerchantOutboundCreatePage } from './pages/merchant/MerchantOutboundCreatePage';
import { MerchantLogisticsPage } from './pages/merchant/MerchantLogisticsPage';
import { MerchantWalletPage } from './pages/merchant/MerchantWalletPage';
import { MerchantShopsPage } from './pages/merchant/MerchantShopsPage';
import { MerchantProfitPage } from './pages/merchant/MerchantProfitPage';
import { MerchantPackagePage } from './pages/merchant/MerchantPackagePage';

// WMS
import { WmsLoginPage } from './pages/wms/WmsLoginPage';
import { WmsDashboardPage } from './pages/wms/WmsDashboardPage';
import { WmsMerchantInboxPage } from './pages/wms/WmsMerchantInboxPage';
import { WmsOrdersPage } from './pages/wms/WmsOrdersPage';
import { WmsOrderDetailPage } from './pages/wms/WmsOrderDetailPage';
import { WmsBillingPage } from './pages/wms/WmsBillingPage';
import { WmsReportsPage } from './pages/wms/WmsReportsPage';
import { WmsWarehousesPage } from './pages/wms/WmsWarehousesPage';
import { WmsInventoryPage } from './pages/wms/WmsInventoryPage';
import { WmsInventoryAgePage } from './pages/wms/WmsInventoryAgePage';
import { WmsStockTakePage } from './pages/wms/WmsStockTakePage';
import { WmsEmployeesPage } from './pages/wms/WmsEmployeesPage';
import { WmsPerformancePage } from './pages/wms/WmsPerformancePage';
import { WmsPackagePage } from './pages/wms/WmsPackagePage';
import { WmsFlowConfigPage } from './pages/wms/WmsFlowConfigPage';
import { WmsIssuePage } from './pages/wms/WmsIssuePage';
import { WmsCustomerPage } from './pages/wms/WmsCustomerPage';

// Admin
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminMerchantsPage } from './pages/admin/AdminMerchantsPage';
import { AdminWarehousesPage } from './pages/admin/AdminWarehousesPage';
import { AdminBillingRulesPage } from './pages/admin/AdminBillingRulesPage';
import { AdminSettlementsPage } from './pages/admin/AdminSettlementsPage';

// ============ ROUTES ============
const rootRoute = createRootRoute({ component: RootLayout });

const r = (spec: any, portal?: PortalRole) => 
  portal ? createRoute({ ...spec, beforeLoad: () => requireAuth(portal) }) : createRoute(spec);

const routeTree = rootRoute.addChildren([
  // Unified /login
  r({ getParentRoute: () => rootRoute, path: 'login', component: UnifiedLoginPage }),

  // Merchant /merchant/*
  r({ getParentRoute: () => rootRoute, path: 'merchant/login', component: MerchantLoginPage }),
  r({ getParentRoute: () => rootRoute, path: 'merchant/register', component: MerchantRegisterPage }),
  r({ getParentRoute: () => rootRoute, path: 'merchant/dashboard', component: MerchantDashboardPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/inventory', component: MerchantInventoryPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/inbound', component: MerchantInboundPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/inbound/new', component: MerchantInboundCreatePage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/orders', component: MerchantOutboundPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/orders/new', component: MerchantOutboundCreatePage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/logistics', component: MerchantLogisticsPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/wallet', component: MerchantWalletPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/shops', component: MerchantShopsPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/profit', component: MerchantProfitPage }, 'merchant'),
  r({ getParentRoute: () => rootRoute, path: 'merchant/packages', component: MerchantPackagePage }, 'merchant'),

  // WMS /wms/*
  r({ getParentRoute: () => rootRoute, path: 'wms/login', component: WmsLoginPage }),
  r({ getParentRoute: () => rootRoute, path: 'wms/dashboard', component: WmsDashboardPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/merchant-inbox', component: WmsMerchantInboxPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/orders', component: WmsOrdersPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/orders/$id', component: WmsOrderDetailPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/billing', component: WmsBillingPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/reports', component: WmsReportsPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/warehouses', component: WmsWarehousesPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/inventory', component: WmsInventoryPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/inventory/age', component: WmsInventoryAgePage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/stock-take', component: WmsStockTakePage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/employees', component: WmsEmployeesPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/performance', component: WmsPerformancePage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/packages', component: WmsPackagePage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/flow-config', component: WmsFlowConfigPage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/issues', component: WmsIssuePage }, 'warehouse'),
  r({ getParentRoute: () => rootRoute, path: 'wms/customers', component: WmsCustomerPage }, 'warehouse'),

  // Admin /admin/*
  r({ getParentRoute: () => rootRoute, path: 'admin/login', component: AdminLoginPage }),
  r({ getParentRoute: () => rootRoute, path: 'admin/dashboard', component: AdminDashboardPage }, 'admin'),
  r({ getParentRoute: () => rootRoute, path: 'admin/merchants', component: AdminMerchantsPage }, 'admin'),
  r({ getParentRoute: () => rootRoute, path: 'admin/warehouses', component: AdminWarehousesPage }, 'admin'),
  r({ getParentRoute: () => rootRoute, path: 'admin/billing-rules', component: AdminBillingRulesPage }, 'admin'),
  r({ getParentRoute: () => rootRoute, path: 'admin/settlements', component: AdminSettlementsPage }, 'admin'),
]);

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

// ============ RENDER ============
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
