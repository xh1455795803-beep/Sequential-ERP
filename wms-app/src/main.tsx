import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { AppLayout } from './components/AppLayout';
import { MobileLayout } from './components/MobileLayout';
import './styles.css';

// Query client
const queryClient = new QueryClient();

// Auth guard
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}

// ============================================
// ROUTES — Admin (AppLayout)
// ============================================
const rootRoute = createRootRoute();
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: AppLayout,
});

// Login (no auth guard)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  component: () => import('./pages/LoginPage').then(m => m.LoginPage),
});

// Auth wrapper — all admin routes require auth
function guard<T extends { getParentRoute: () => any; path: string; }>(spec: T) {
  return { ...spec, beforeLoad: requireAuth };
}

const dashboardRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'dashboard' }),
  component: () => import('./pages/DashboardPage').then(m => m.DashboardPage),
});

const warehousesRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'warehouses' }),
  component: () => import('./pages/WarehousesPage').then(m => m.WarehousesPage),
});

const locationsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'locations' }),
  component: () => import('./pages/LocationsPage').then(m => m.LocationsPage),
});

// Inventory group
const inventoryRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'inventory' }),
  component: () => import('./pages/InventoryPage').then(m => m.InventoryPage),
});

const skusRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'skus' }),
  component: () => import('./pages/SKUsPage').then(m => m.SKUsPage),
});

const inventoryMoveRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'inventory/move' }),
  component: () => import('./pages/InventoryMovePage').then(m => m.InventoryMovePage),
});

const inventoryAdjustRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'inventory/adjust' }),
  component: () => import('./pages/InventoryAdjustPage').then(m => m.InventoryAdjustPage),
});

// ASN group
const asnsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'asns' }),
  component: () => import('./pages/AsnsPage').then(m => m.AsnsPage),
});

const asnDetailRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'asns/$id' }),
  component: () => import('./pages/AsnsPage').then(m => m.AsnDetailPage),
});

// Shipments group
const shipmentsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'shipments' }),
  component: () => import('./pages/ShipmentsPage').then(m => m.ShipmentsPage),
});

const shipmentDetailRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'shipments/$id' }),
  component: () => import('./pages/ShipmentsPage').then(m => m.ShipmentDetailPage),
});

const shipmentCancelRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'shipment-cancellations' }),
  component: () => import('./pages/ShipmentCancellationPage').then(m => m.ShipmentCancellationPage),
});

// Waves
const wavesRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'waves' }),
  component: () => import('./pages/WavesPage').then(m => m.WavesPage),
});

const waveStrategiesRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'wave-strategies' }),
  component: () => import('./pages/WaveStrategiesPage').then(m => m.WaveStrategiesPage),
});

const waveTasksRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'wave-tasks' }),
  component: () => import('./pages/WaveTasksPage').then(m => m.WaveTasksPage),
});

// Stocktaking
const stocktakingRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'stocktaking' }),
  component: () => import('./pages/StocktakingPage').then(m => m.StocktakingPage),
});

// Returns
const returnsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'returns' }),
  component: () => import('./pages/ReturnsPage').then(m => m.ReturnsPage),
});

// FBA Returns + Relabels
const fbaReturnsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'fba-returns' }),
  component: () => import('./pages/FbaReturnsPage').then(m => m.FbaReturnsPage),
});

// Transfers
const transfersRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'transfers' }),
  component: () => import('./pages/TransfersPage').then(m => m.TransfersPage),
});

// Billing + Carriers
const billingRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'billing' }),
  component: () => import('./pages/BillingPage').then(m => m.BillingPage),
});

const carriersRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'carriers' }),
  component: () => import('./pages/CarriersPage').then(m => m.CarriersPage),
});

// BOM + Kitting (simplified)
const bomRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'bom' }),
  component: () => import('./pages/BomManagementPage').then(m => m.BomManagementPage),
});

const kittingRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'kitting' }),
  component: () => import('./pages/KittingOrdersPage').then(m => m.KittingOrdersPage),
});

// Staff + Supplies
const staffPerfRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'staff/performance' }),
  component: () => import('./pages/StaffPerformancePage').then(m => m.StaffPerformancePage),
});

const suppliesRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'supplies' }),
  component: () => import('./pages/SuppliesPage').then(m => m.SuppliesPage),
});

// Work Orders
const workOrdersRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'work-orders' }),
  component: () => import('./pages/WorkOrdersPage').then(m => m.WorkOrdersPage),
});

// Settings group
const settingsRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'settings' }),
  component: () => import('./pages/SettingsPage').then(m => m.SettingsPage),
});

const auditRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'audit' }),
  component: () => import('./pages/AuditLogPage').then(m => m.AuditLogPage),
});

const erpSyncRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'erp-sync' }),
  component: () => import('./pages/ErpSyncStatusPage').then(m => m.ErpSyncStatusPage),
});

const webhooksRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'webhooks' }),
  component: () => import('./pages/WebhookAdminPage').then(m => m.WebhookAdminPage),
});

const rolesRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'settings/roles' }),
  component: () => import('./pages/RoleManagementPage').then(m => m.RoleManagementPage),
});

const customerRoute = createRoute({
  ...guard({ getParentRoute: () => layoutRoute, path: 'customer' }),
  component: () => import('./pages/CustomerPortalPage').then(m => m.CustomerPortalPage),
});

// ============================================
// ROUTES — Mobile (MobileLayout)
// ============================================
const mobileLayoutRoute = createRoute({
  ...guard({ getParentRoute: () => rootRoute, path: 'm' }),
  component: MobileLayout,
});

const mobileHomeRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: '/',
  component: () => import('./pages/MobileHomePage').then(m => m.MobileHomePage),
});

const mobileWaveTasksRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'wave-tasks',
  component: () => import('./pages/WaveTasksPage').then(m => m.WaveTasksPage),
});

const mobileReceiveRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'asns/receive',
  component: () => import('./pages/MobileReceiveScanPage').then(m => m.MobileReceiveScanPage),
});

const mobileAsnPutawayRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'asns/$id',
  component: () => import('./pages/MobileAsnPutawayPage').then(m => m.MobileAsnPutawayPage),
});

const mobileStockRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'stocktaking',
  component: () => import('./pages/MobileStocktakingPage').then(m => m.MobileStocktakingPage),
});

const mobileReturnsRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'returns',
  component: () => import('./pages/MobileReturnsPage').then(m => m.MobileReturnsPage),
});

const mobileMoveRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'move',
  component: () => import('./pages/MobileMovePage').then(m => m.MobileMovePage),
});

const mobileStatsRoute = createRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: 'my-stats',
  component: () => import('./pages/MobileMyPerformancePage').then(m => m.MobileMyPerformancePage),
});

// ============================================
// ROUTE TREE
// ============================================
const layoutChildren = [
  dashboardRoute, warehousesRoute, locationsRoute,
  inventoryRoute, skusRoute, inventoryMoveRoute, inventoryAdjustRoute,
  asnsRoute, asnDetailRoute,
  shipmentsRoute, shipmentDetailRoute, shipmentCancelRoute,
  wavesRoute, waveStrategiesRoute, waveTasksRoute,
  stocktakingRoute,
  returnsRoute, fbaReturnsRoute,
  transfersRoute,
  billingRoute, carriersRoute,
  bomRoute, kittingRoute,
  staffPerfRoute, suppliesRoute, workOrdersRoute,
  settingsRoute, rolesRoute, auditRoute, erpSyncRoute, webhooksRoute, customerRoute,
];
layoutRoute.addChildren(layoutChildren);

mobileLayoutRoute.addChildren([
  mobileHomeRoute, mobileWaveTasksRoute, mobileReceiveRoute, mobileAsnPutawayRoute,
  mobileStockRoute, mobileReturnsRoute, mobileMoveRoute, mobileStatsRoute,
]);

const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute,
  mobileLayoutRoute,
]);

const router = createRouter({ routeTree, basepath: '/wms/' });

// ============================================
// RENDER
// ============================================
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
