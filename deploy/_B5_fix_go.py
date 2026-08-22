#!/usr/bin/env python3
"""Fix B5 go function bugs:
1. VIEW_TITLES exact check at top of go() prematurely resets product/edit/* to dashboard.
2. titleKey is used in location.hash write before it is defined.
3. product/edit/:id should preserve full path in URL (not strip the id).
"""
import sys

PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

old_go = """function go(view) {
  view = String(view || '').split('?')[0];
  if (!VIEW_TITLES[view]) view = 'dashboard';
  // ===== 路由级前端权限拦截（403）：与后端双重保护 =====
  // SaaS运营后台：仅超级管理员（super_admin）可访问，其他角色一律403拦截并跳回概览
  if (view === 'saas-admin' && !(me && me.role === 'super_admin')) {
    toast('403 无权限访问SaaS运营后台', 'err');
    view = 'dashboard';
  }
  // 套餐订阅页：仅主账号 owner 可见，子账号/超级管理员（租户界面）无权限访问
  if (view === 'billing' && !(me && me.role === 'owner')) {
    toast('403 仅主账号可查看套餐订阅', 'warn');
    view = 'dashboard';
  }
  // 仅当停留在同一视图时保留 URL 查询参数（OAuth 回跳提示用）
  const cur = String(location.hash.replace('#/', '')).split('?')[0];
  const q = (cur === view && location.hash.includes('?')) ? '?' + location.hash.split('?')[1] : '';
  // location.hash 由调用方传入 view（动态路由先解析再写入）
  location.hash = '#/' + (titleKey && titleKey !== view ? titleKey : view) + q;
  // ===== 动态路由解析：product/edit/:id / product/new =====
  let titleKey = view, routeArgs = {};
  if (view.startsWith('product/edit/')) { titleKey = 'product/edit'; routeArgs = { action: 'edit', id: view.replace('product/edit/', '') }; view = 'product-edit'; }
  else if (view === 'product/new') { titleKey = 'product/new'; routeArgs = { action: 'new' }; view = 'product-edit'; }
  document.getElementById('page-title').textContent = VIEW_TITLES[titleKey] || VIEW_TITLES[titleKey.split('/')[0]] || '';
  // 顶部导航高亮：商品编辑时高亮「商品中心 → 商品管理」
  document.querySelectorAll('.nav-item').forEach(n => {
    const v = n.dataset.view;
    n.classList.toggle('on', v === 'products' && (view === 'product-edit' || view === 'products'));
  });
  highlightNavGroup();
  const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'product-edit': () => loadProductEdit(routeArgs), 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings, billing: loadBilling };
  loaders[view]();
}"""

new_go = """function go(view) {
  const rawView = String(view || '').split('?')[0];
  // ===== 动态路由解析（先解析，再判断已知视图） =====
  let titleKey = rawView, routeArgs = {}, loaderKey = rawView;
  if (rawView.startsWith('product/edit/')) {
    titleKey = 'product/edit';
    routeArgs = { action: 'edit', id: rawView.replace('product/edit/', '') };
    loaderKey = 'product-edit';
  } else if (rawView === 'product/new') {
    titleKey = 'product/new';
    routeArgs = { action: 'new' };
    loaderKey = 'product-edit';
  }
  // ===== 校验路由是否合法：VIEW_TITLES 精确 或 合法动态路由 =====
  const knownRoutes = Object.keys(VIEW_TITLES);
  const isValid = knownRoutes.includes(rawView) || knownRoutes.includes(titleKey) || loaderKey !== rawView;
  view = isValid ? rawView : 'dashboard';
  if (!isValid) { titleKey = 'dashboard'; loaderKey = 'dashboard'; routeArgs = {}; }
  // ===== 路由级前端权限拦截（403）：与后端双重保护 =====
  if ((loaderKey === 'saas-admin' || view === 'saas-admin') && !(me && me.role === 'super_admin')) {
    toast('403 无权限访问SaaS运营后台', 'err');
    loaderKey = 'dashboard'; titleKey = 'dashboard'; view = 'dashboard'; routeArgs = {};
  }
  if ((loaderKey === 'billing' || view === 'billing') && !(me && me.role === 'owner')) {
    toast('403 仅主账号可查看套餐订阅', 'warn');
    loaderKey = 'dashboard'; titleKey = 'dashboard'; view = 'dashboard'; routeArgs = {};
  }
  // ===== 写入 URL hash（动态路由保留原始路径含 /:id，不回写为 product/edit） =====
  const cur = String(location.hash.replace('#/', '')).split('?')[0];
  const q = (cur === view && location.hash.includes('?')) ? '?' + location.hash.split('?')[1] : '';
  const hashTarget = view; // 动态路由 view 就是 rawView（含 /:id），不要改成 titleKey
  if (String(location.hash.replace('#/', '')).split('?')[0] !== hashTarget) {
    location.hash = '#/' + hashTarget + q;
  }
  document.getElementById('page-title').textContent = VIEW_TITLES[titleKey] || '';
  // 顶部导航高亮：商品编辑时高亮「商品中心 → 商品管理」
  document.querySelectorAll('.nav-item').forEach(n => {
    const v = n.dataset.view;
    n.classList.toggle('on', v === 'products' && (loaderKey === 'product-edit' || loaderKey === 'products') ? true : (v === loaderKey));
  });
  highlightNavGroup();
  const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'product-edit': () => loadProductEdit(routeArgs), 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings, billing: loadBilling };
  if (loaders[loaderKey]) loaders[loaderKey]();
  else { go('dashboard'); }
}"""

assert old_go in html, "old go function not found - already fixed or different state"
html = html.replace(old_go, new_go)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[OK] go function fixed")
