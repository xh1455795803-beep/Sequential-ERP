import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { supabase } from './lib/supabase';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { LocationsPage } from './pages/LocationsPage';
import { AsnsPage, AsnDetailPage } from './pages/AsnsPage';
import { ShipmentsPage, ShipmentDetailPage } from './pages/ShipmentsPage';
import { InventoryPage } from './pages/InventoryPage';
import { StocktakingPage } from './pages/StocktakingPage';
import { ProductsPage } from './pages/ProductsPage';
import { OrdersPage, OrderDetailPage } from './pages/OrdersPage';
import { ChannelsPage } from './pages/ChannelsPage';
import { ExceptionsPage } from './pages/ExceptionsPage';
import './styles.css';

// --- 鉴权 ---
async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('UNAUTHORIZED');
  return session;
}

// --- 路由树 ---
const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: LoginPage,
});

const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: requireAuth,
  component: AppLayout,
});

// 所有子路由
const dashRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/dashboard', component: DashboardPage });

// 新增 v2 路由
const productsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/products', component: ProductsPage });
const ordersRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders', component: OrdersPage });
const orderDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/orders/$id', component: OrderDetailPage });
const channelsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/channels', component: ChannelsPage });
const exceptionsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/exceptions', component: ExceptionsPage });

// 保留旧路由
const warehousesRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/warehouses', component: WarehousesPage });
const locationsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/locations', component: LocationsPage });
const asnsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/asns', component: AsnsPage });
const asnDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/asns/$id', component: AsnDetailPage });
const shipmentsRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/shipments', component: ShipmentsPage });
const shipmentDetailRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/shipments/$id', component: ShipmentDetailPage });
const inventoryRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/inventory', component: InventoryPage });
const stocktakingRoute = createRoute({ getParentRoute: () => layoutRoute, path: '/stocktaking', component: StocktakingPage });

const routeTree = rootRoute.addChildren([
  loginRoute,
  layoutRoute.addChildren([
    dashRoute,
    productsRoute,
    ordersRoute,
    orderDetailRoute,
    channelsRoute,
    exceptionsRoute,
    warehousesRoute,
    locationsRoute,
    asnsRoute,
    asnDetailRoute,
    shipmentsRoute,
    shipmentDetailRoute,
    inventoryRoute,
    stocktakingRoute,
  ]),
]);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

const router = createRouter({
  routeTree,
  basepath: '/wms',
  defaultPreload: 'intent',
  defaultErrorComponent: ({ error }: any) => {
    if (error?.message === 'UNAUTHORIZED') {
      const u = new URL(window.location.href);
      u.pathname = '/wms/';
      window.location.replace(u.toString());
      return null;
    }
    return (
      <div className="p-8 text-center text-red-500">
        <h2 className="text-xl font-semibold mb-2">出错了</h2>
        <p className="text-sm text-gray-500">{error?.message}</p>
        <button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-brand-500 text-white rounded">刷新</button>
      </div>
    );
  },
});

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
