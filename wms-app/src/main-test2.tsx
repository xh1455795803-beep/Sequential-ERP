import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider, createRouter, createRootRoute, createRoute, createHashHistory } from '@tanstack/react-router';

function LoginPage() { return <div>LOGIN PAGE ✅</div>; }
function HomePage() { return <div>HOME PAGE ✅</div>; }
function WarehousesPage() { return <div>WAREHOUSES ✅</div>; }

const rootRoute = createRootRoute();

// 调换顺序：home 第一个
const homeRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'home',
  component: HomePage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'login',
  component: LoginPage,
});

const warehousesRoute = createRoute({
  getParentRoute: () => rootRoute, path: 'warehouses',
  component: WarehousesPage,
});

// 不同顺序测试
const routeTree = rootRoute.addChildren([homeRoute, loginRoute, warehousesRoute]);

const router = createRouter({ routeTree, history: createHashHistory() });

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<RouterProvider router={router} />);
