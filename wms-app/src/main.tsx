import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute, redirect, Outlet, useRouterState } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase, getAuthContext, PortalRole } from './lib/supabase';
import { WmsLayout } from './layouts/WmsLayout';
import { WmsLandingPage } from './pages/wms/WmsLandingPage';
import './styles.css';

const queryClient = new QueryClient();

// ============ AUTH GUARD ============
async function requireAuth() {
  const ctx = await getAuthContext();
  if (!ctx.user) throw redirect({ to: '/login' });
}

// ============ IMPORTS ============
import { WmsLoginPage } from './pages/wms/WmsLoginPage';
import { WmsRegisterPage } from './pages/wms/WmsRegisterPage';
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

// ============ ROOT ============
function Root() {
  // React Router 内部 pathname（basepath=/wms 已自动剥离）
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const inAuth = pathname === '/' || pathname.endsWith('/login') || pathname.endsWith('/register');
  return inAuth ? <Outlet /> : <WmsLayout />;
}

const rootRoute = createRootRoute({ component: Root });

const r = (spec: any) => createRoute(spec);
const p = (spec: any) => createRoute({ ...spec, beforeLoad: requireAuth });

const routeTree = rootRoute.addChildren([
  r({ getParentRoute: () => rootRoute, path: '/', component: WmsLandingPage }),
  r({ getParentRoute: () => rootRoute, path: 'login', component: WmsLoginPage }),
  r({ getParentRoute: () => rootRoute, path: 'register', component: WmsRegisterPage }),

  p({ getParentRoute: () => rootRoute, path: 'dashboard', component: WmsDashboardPage }),
  p({ getParentRoute: () => rootRoute, path: 'merchant-inbox', component: WmsMerchantInboxPage }),
  p({ getParentRoute: () => rootRoute, path: 'orders', component: WmsOrdersPage }),
  p({ getParentRoute: () => rootRoute, path: 'orders/$id', component: WmsOrderDetailPage }),
  p({ getParentRoute: () => rootRoute, path: 'billing', component: WmsBillingPage }),
  p({ getParentRoute: () => rootRoute, path: 'reports', component: WmsReportsPage }),
  p({ getParentRoute: () => rootRoute, path: 'warehouses', component: WmsWarehousesPage }),
  p({ getParentRoute: () => rootRoute, path: 'inventory', component: WmsInventoryPage }),
  p({ getParentRoute: () => rootRoute, path: 'inventory/age', component: WmsInventoryAgePage }),
  p({ getParentRoute: () => rootRoute, path: 'stock-take', component: WmsStockTakePage }),
  p({ getParentRoute: () => rootRoute, path: 'employees', component: WmsEmployeesPage }),
  p({ getParentRoute: () => rootRoute, path: 'performance', component: WmsPerformancePage }),
  p({ getParentRoute: () => rootRoute, path: 'packages', component: WmsPackagePage }),
  p({ getParentRoute: () => rootRoute, path: 'flow-config', component: WmsFlowConfigPage }),
  p({ getParentRoute: () => rootRoute, path: 'issues', component: WmsIssuePage }),
  p({ getParentRoute: () => rootRoute, path: 'customers', component: WmsCustomerPage }),
]);

const router = createRouter({ routeTree, basepath: '/wms' });

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
