import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute } from '@tanstack/react-router';

function LoginPage() { return <div>LOGIN PAGE ✅</div>; }
function HomePage() { return <div>HOME PAGE ✅</div>; }
function WarehousesPage() { return <div>WAREHOUSES ✅</div>; }

const rootRoute = createRootRoute();

const loginRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'login',
  component: LoginPage,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'home',
  component: HomePage,
});

const warehousesRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'warehouses',
  component: WarehousesPage,
});

const routeTree = rootRoute.addChildren([loginRoute, homeRoute, warehousesRoute]);

// Browser history + basepath /wms/
const router = createRouter({ routeTree, basepath: '/wms/' });

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<RouterProvider router={router} />);
