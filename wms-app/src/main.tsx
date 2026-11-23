import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute, redirect } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { AppLayout } from './components/AppLayout';
import { MobileLayout } from './components/MobileLayout';
import './styles.css';
import { AsnsPage, AsnDetailPage } from './pages/AsnsPage';
import { AuditLogPage } from './pages/AuditLogPage';
import { BillingPage } from './pages/BillingPage';
import { BomManagementPage } from './pages/BomManagementPage';
import { CarriersPage } from './pages/CarriersPage';
import { CustomerPortalPage } from './pages/CustomerPortalPage';
import { DashboardPage } from './pages/DashboardPage';
import { ErpSyncStatusPage } from './pages/ErpSyncStatusPage';
import { FbaReturnsPage } from './pages/FbaReturnsPage';
import { InventoryAdjustPage } from './pages/InventoryAdjustPage';
import { InventoryMovePage } from './pages/InventoryMovePage';
import { InventoryPage } from './pages/InventoryPage';
import { KittingOrdersPage } from './pages/KittingOrdersPage';
import { LocationsPage } from './pages/LocationsPage';
import { LoginPage } from './pages/LoginPage';
import { MobileAsnPutawayPage } from './pages/MobileAsnPutawayPage';
import { MobileHomePage } from './pages/MobileHomePage';
import { MobileMovePage } from './pages/MobileMovePage';
import { MobileMyPerformancePage } from './pages/MobileMyPerformancePage';
import { MobileReceiveScanPage } from './pages/MobileReceiveScanPage';
import { MobileReturnsPage } from './pages/MobileReturnsPage';
import { MobileStocktakingPage } from './pages/MobileStocktakingPage';
import { ReturnsPage } from './pages/ReturnsPage';
import { RoleManagementPage } from './pages/RoleManagementPage';
import { SKUsPage } from './pages/SKUsPage';
import { SettingsPage } from './pages/SettingsPage';
import { ShipmentCancellationPage } from './pages/ShipmentCancellationPage';
import { ShipmentsPage, ShipmentDetailPage } from './pages/ShipmentsPage';
import { StaffPerformancePage } from './pages/StaffPerformancePage';
import { StocktakingPage } from './pages/StocktakingPage';
import { SuppliesPage } from './pages/SuppliesPage';
import { TransferPage as TransfersPage } from './pages/TransfersPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { WaveStrategiesPage } from './pages/WaveStrategiesPage';
import { WaveTasksPage } from './pages/WaveTasksPage';
import { WavesPage } from './pages/WavesPage';
import { WebhookAdminPage } from './pages/WebhookAdminPage';
import { WorkOrdersPage } from './pages/WorkOrdersPage';

// Query client
const queryClient = new QueryClient();

// Auth guard — 简单版本
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw redirect({ to: '/login' });
}

// ============================================
// ROUTES — Admin (AppLayout)
// ============================================
const rootRoute = createRootRoute({ component: AppLayout });
// Login (no auth guard)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'login',
  component: LoginPage,
});

// Auth wrapper — 替代 createRoute，自动加 beforeLoad: requireAuth
function createAuthRoute<T extends { getParentRoute: () => any; path?: string }>(spec: T) {
  return createRoute({ ...spec, beforeLoad: requireAuth });
}

const dashboardRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'dashboard',
  component: DashboardPage,
});

const warehousesRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'warehouses',
  component: WarehousesPage,
});

const locationsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'locations',
  component: LocationsPage,
});

// Inventory group
const inventoryRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'inventory',
  component: InventoryPage,
});

const skusRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'skus',
  component: SKUsPage,
});

const inventoryMoveRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'inventory/move',
  component: InventoryMovePage,
});

const inventoryAdjustRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'inventory/adjust',
  component: InventoryAdjustPage,
});

// ASN group
const asnsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'asns',
  component: AsnsPage,
});

const asnDetailRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'asns/$id',
  component: AsnDetailPage,
});

// Shipments group
const shipmentsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'shipments',
  component: ShipmentsPage,
});

const shipmentDetailRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'shipments/$id',
  component: ShipmentDetailPage,
});

const shipmentCancelRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'shipment-cancellations',
  component: ShipmentCancellationPage,
});

// Waves
const wavesRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'waves',
  component: WavesPage,
});

const waveStrategiesRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'wave-strategies',
  component: WaveStrategiesPage,
});

const waveTasksRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'wave-tasks',
  component: WaveTasksPage,
});

// Stocktaking
const stocktakingRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'stocktaking',
  component: StocktakingPage,
});

// Returns
const returnsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'returns',
  component: ReturnsPage,
});

// FBA Returns + Relabels
const fbaReturnsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'fba-returns',
  component: FbaReturnsPage,
});

// Transfers
const transfersRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'transfers',
  component: TransfersPage,
});

// Billing + Carriers
const billingRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'billing',
  component: BillingPage,
});

const carriersRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'carriers',
  component: CarriersPage,
});

// BOM + Kitting (simplified)
const bomRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'bom',
  component: BomManagementPage,
});

const kittingRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'kitting',
  component: KittingOrdersPage,
});

// Staff + Supplies
const staffPerfRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'staff/performance',
  component: StaffPerformancePage,
});

const suppliesRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'supplies',
  component: SuppliesPage,
});

// Work Orders
const workOrdersRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'work-orders',
  component: WorkOrdersPage,
});

// Settings group
const settingsRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'settings',
  component: SettingsPage,
});

const auditRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'audit',
  component: AuditLogPage,
});

const erpSyncRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'erp-sync',
  component: ErpSyncStatusPage,
});

const webhooksRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'webhooks',
  component: WebhookAdminPage,
});

const rolesRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'settings/roles',
  component: RoleManagementPage,
});

const customerRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'customer',
  component: CustomerPortalPage,
});

// ============================================
// ROUTES — Mobile (MobileLayout)
// ============================================
const mobileLayoutRoute = createAuthRoute({
  getParentRoute: () => rootRoute, path: 'm',
  component: MobileLayout,
});

const mobileHomeRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute,
  path: '/',
  component: MobileHomePage,
});

const mobileWaveTasksRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'wave-tasks',
  component: WaveTasksPage,
});

const mobileReceiveRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'asns/receive',
  component: MobileReceiveScanPage,
});

const mobileAsnPutawayRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'asns/$id',
  component: MobileAsnPutawayPage,
});

const mobileStockRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'stocktaking',
  component: MobileStocktakingPage,
});

const mobileReturnsRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'returns',
  component: MobileReturnsPage,
});

const mobileMoveRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'move',
  component: MobileMovePage,
});

const mobileStatsRoute = createAuthRoute({
  getParentRoute: () => mobileLayoutRoute, path: 'my-stats',
  component: MobileMyPerformancePage,
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
mobileLayoutRoute.addChildren([
  mobileHomeRoute, mobileWaveTasksRoute, mobileReceiveRoute, mobileAsnPutawayRoute,
  mobileStockRoute, mobileReturnsRoute, mobileMoveRoute, mobileStatsRoute,
]);

const routeTree = rootRoute.addChildren([
  loginRoute,
  ...layoutChildren,
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
