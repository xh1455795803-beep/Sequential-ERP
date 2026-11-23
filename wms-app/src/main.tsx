import React from 'react';
import { RouterProvider, createRouter, createRootRoute, createRoute, redirect } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { RootLayout } from './layouts/RootLayout';
import './styles.css';

// ========== Query Client ==========
const queryClient = new QueryClient();

// ========== Auth Helpers ==========
async function requireAuth(allowedPortal: 'merchant' | 'wms' | 'admin') {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw redirect({ to: `/${allowedPortal}/login` });
}

// ========== Imports: Merchant ==========
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

// ========== Imports: WMS (Warehouse) ==========
import { WmsLoginPage } from './pages/wms/WmsLoginPage';
import { WmsDashboardPage } from './pages/wms/WmsDashboardPage';
import { WmsInventoryPage } from './pages/wms/WmsInventoryPage';
import { WmsWarehousesPage } from './pages/wms/WmsWarehousesPage';
import { WmsMerchantInboxPage } from './pages/wms/WmsMerchantInboxPage';
import { WmsOrdersPage } from './pages/wms/WmsOrdersPage';
import { WmsOrderDetailPage } from './pages/wms/WmsOrderDetailPage';
import { WmsBillingPage } from './pages/wms/WmsBillingPage';
import { WmsReportsPage } from './pages/wms/WmsReportsPage';

// ========== Imports: Admin (Platform) ==========
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminMerchantsPage } from './pages/admin/AdminMerchantsPage';
import { AdminWarehousesPage } from './pages/admin/AdminWarehousesPage';
import { AdminBillingRulesPage } from './pages/admin/AdminBillingRulesPage';
import { AdminSettlementsPage } from './pages/admin/AdminSettlementsPage';

// ===================================================================
// ROOT ROUTE — Path-aware layout dispatcher
// ===================================================================
const rootRoute = createRootRoute({ component: RootLayout });

function authRoute<T extends { getParentRoute: () => any; path: string }>(
  spec: T, portal: 'merchant' | 'wms' | 'admin') {
  return createRoute({ ...spec, beforeLoad: () => requireAuth(portal) });
}

// ===================================================================
// MERCHANT PORTAL (/merchant/*)
// ===================================================================
const merchLogin = createRoute({ getParentRoute: () => rootRoute, path: 'merchant/login', component: MerchantLoginPage });
const merchRegister = createRoute({ getParentRoute: () => rootRoute, path: 'merchant/register', component: MerchantRegisterPage });
const merchDash = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/dashboard', component: MerchantDashboardPage }, 'merchant');
const merchInv = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/inventory', component: MerchantInventoryPage }, 'merchant');
const merchIb = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/inbound', component: MerchantInboundPage }, 'merchant');
const merchIbNew = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/inbound/new', component: MerchantInboundCreatePage }, 'merchant');
const merchOb = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/orders', component: MerchantOutboundPage }, 'merchant');
const merchObNew = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/orders/new', component: MerchantOutboundCreatePage }, 'merchant');
const merchLogi = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/logistics', component: MerchantLogisticsPage }, 'merchant');
const merchWallet = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/wallet', component: MerchantWalletPage }, 'merchant');
const merchShops = authRoute({ getParentRoute: () => rootRoute, path: 'merchant/shops', component: MerchantShopsPage }, 'merchant');

// ===================================================================
// WMS PORTAL (/wms/*)
// ===================================================================
const wmsLogin = createRoute({ getParentRoute: () => rootRoute, path: 'wms/login', component: WmsLoginPage });
const wmsDash = authRoute({ getParentRoute: () => rootRoute, path: 'wms/dashboard', component: WmsDashboardPage }, 'wms');
const wmsInv = authRoute({ getParentRoute: () => rootRoute, path: 'wms/inventory', component: WmsInventoryPage }, 'wms');
const wmsWh = authRoute({ getParentRoute: () => rootRoute, path: 'wms/warehouses', component: WmsWarehousesPage }, 'wms');
const wmsInbox = authRoute({ getParentRoute: () => rootRoute, path: 'wms/merchant-inbox', component: WmsMerchantInboxPage }, 'wms');
const wmsOrders = authRoute({ getParentRoute: () => rootRoute, path: 'wms/orders', component: WmsOrdersPage }, 'wms');
const wmsOrderDetail = authRoute({ getParentRoute: () => rootRoute, path: 'wms/orders/$id', component: WmsOrderDetailPage }, 'wms');
const wmsBilling = authRoute({ getParentRoute: () => rootRoute, path: 'wms/billing', component: WmsBillingPage }, 'wms');
const wmsReports = authRoute({ getParentRoute: () => rootRoute, path: 'wms/reports', component: WmsReportsPage }, 'wms');

// ===================================================================
// ADMIN PORTAL (/admin/*)
// ===================================================================
const adminLogin = createRoute({ getParentRoute: () => rootRoute, path: 'admin/login', component: AdminLoginPage });
const adminDash = authRoute({ getParentRoute: () => rootRoute, path: 'admin/dashboard', component: AdminDashboardPage }, 'admin');
const adminMerch = authRoute({ getParentRoute: () => rootRoute, path: 'admin/merchants', component: AdminMerchantsPage }, 'admin');
const adminWh = authRoute({ getParentRoute: () => rootRoute, path: 'admin/warehouses', component: AdminWarehousesPage }, 'admin');
const adminBilling = authRoute({ getParentRoute: () => rootRoute, path: 'admin/billing-rules', component: AdminBillingRulesPage }, 'admin');
const adminSettle = authRoute({ getParentRoute: () => rootRoute, path: 'admin/settlements', component: AdminSettlementsPage }, 'admin');

// ===================================================================
// ROUTE TREE
// ===================================================================
const routeTree = rootRoute.addChildren([
  // Merchant
  merchLogin, merchRegister, merchDash, merchInv, merchIb, merchIbNew,
  merchOb, merchObNew, merchLogi, merchWallet, merchShops,
  // WMS
  wmsLogin, wmsDash, wmsInv, wmsWh, wmsInbox, wmsOrders, wmsOrderDetail, wmsBilling, wmsReports,
  // Admin
  adminLogin, adminDash, adminMerch, adminWh, adminBilling, adminSettle,
]);

const router = createRouter({ routeTree });

// ===================================================================
// RENDER
// ===================================================================
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}
