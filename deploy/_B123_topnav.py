#!/usr/bin/env python3
"""
B1+B2+B3 大改造：
1. 左侧sidebar → 顶部横向导航（品牌 + 分组下拉菜单 + 用户区）
2. 删除【自动化中心·V2】分组 + scheduler菜单项
3. 汇率保留在财务中心（已在），【系统设置】分组内容与菜单项对齐，SaaS运营后台归到【运营】独立分组
"""
import re, sys, os

SRC = '/workspace/deploy/admin/index.html'
html = open(SRC, 'r', encoding='utf-8').read()

# ========== 1. CSS 重写：sidebar→topnav ==========
old_css_block = '''/* ===== 主布局 ===== */
#app-view{display:none;min-height:100vh}
.layout{display:flex;min-height:100vh}
.sidebar{width:216px;background:#fff;border-right:1px solid var(--border);padding:16px 12px;position:fixed;top:0;bottom:0;left:0;z-index:10;display:flex;flex-direction:column}
.sidebar .brand{display:flex;align-items:center;gap:9px;padding:6px 8px 18px}
.sidebar .brand .mark{width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}
.sidebar .brand .name{font-weight:800;font-size:16px}
.nav-item{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;color:var(--text-2);font-weight:600;margin-bottom:2px;transition:all .15s;text-decoration:none;font-size:14px}
.nav-item:hover{background:var(--primary-light);color:var(--primary)}
.nav-item.on{background:var(--primary-light);color:var(--primary)}
.nav-item svg{width:18px;height:18px;flex:none}
/* 分组子菜单 */
.nav-group{margin-bottom:6px}
.nav-group-title{display:flex;align-items:center;gap:8px;padding:12px 12px 4px;font-size:11px;font-weight:700;color:var(--text-3);letter-spacing:.08em;text-transform:uppercase}
.nav-group-title svg{width:14px;height:14px;flex:none;opacity:.7}
.nav-item.sub{padding:8px 12px 8px 34px;font-weight:500;font-size:13.5px;position:relative}
.nav-item.sub::before{content:'';width:4px;height:4px;border-radius:50%;background:currentColor;opacity:.4;position:absolute;margin-left:-14px}
.sidebar{overflow-y:auto}'''

new_css_block = '''/* ===== 主布局：顶部横向导航 ===== */
:root{--topnav-h:60px;--subnav-h:48px}
#app-view{display:none;min-height:100vh;display:none;flex-direction:column}
.layout{display:flex;flex-direction:column;min-height:100vh}
/* 顶栏上半：品牌 + 导航分组下拉 + 用户区 */
.topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 24px;gap:32px}
.topnav .brand{display:flex;align-items:center;gap:9px;flex:none}
.topnav .brand .mark{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px}
.topnav .brand .name{font-weight:800;font-size:17px;letter-spacing:.3px}
.topnav-groups{display:flex;align-items:center;gap:4px;flex:1;overflow-x:auto;min-width:0}
.nav-group{position:relative}
.nav-group-title{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s}
.nav-group-title:hover{background:var(--primary-light);color:var(--primary)}
.nav-group-title svg{width:16px;height:16px;flex:none;opacity:.9}
.nav-group-title::after{content:'▾';font-size:10px;margin-left:2px;opacity:.6}
.nav-group-title.on{background:var(--primary-light);color:var(--primary)}
/* 下拉子菜单浮层 */
.nav-group-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:230px;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.14);z-index:9999;padding:10px;display:none;flex-direction:column;animation:avatarFadeIn .12s ease-out}
.nav-group.open .nav-group-menu{display:flex}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;color:var(--text-2);font-weight:500;text-decoration:none;font-size:13.5px;transition:all .1s;white-space:nowrap;line-height:1.3}
.nav-item:hover{background:var(--primary-light);color:var(--primary)}
.nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}
.nav-item svg{width:16px;height:16px;flex:none;color:var(--text-2)}
.nav-item:hover svg{color:var(--primary)}
.nav-item.on svg{color:var(--primary)}
.nav-item.badge-new{display:flex;align-items:center;justify-content:space-between;padding-right:12px}
.nav-item.badge-new em{font-style:normal;font-size:10px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:2px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2;margin-left:8px}
.topnav-right{display:flex;align-items:center;gap:12px;margin-left:auto}
.plan-mini{display:inline-flex;flex-direction:column;padding:4px 12px;border-left:1px solid var(--border);gap:1px;line-height:1.3}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:12.5px}
.plan-mini .p-exp{font-size:11.5px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}
/* 顶栏下半：页面标题 */
.subnav{background:#fff;border-bottom:1px solid var(--border);height:var(--subnav-h);display:flex;align-items:center;padding:0 24px}
.subnav .page-title{font-size:17px;font-weight:700;margin-right:auto}
/* 旧 sidebar plan-box 替换：删掉 */
.sidebar{display:none!important}'''

if old_css_block not in html:
    print("ERROR: old_css_block not found!")
    sys.exit(1)
html = html.replace(old_css_block, new_css_block)

# ========== 2. 改 .main / .content / .topbar 相关 CSS ==========
old_main_css = '''.sidebar .plan-box{margin-top:auto;background:var(--primary-light);border-radius:10px;padding:12px}
.plan-box .p-name{font-weight:700;color:var(--primary);font-size:13px;margin-bottom:4px}
.plan-box .p-exp{font-size:12px;color:var(--text-2);line-height:1.5}
.plan-box .p-exp.warn{color:var(--amber)}
.nav-item.badge-new{position:static;display:flex;align-items:center;justify-content:space-between;padding-right:12px}
.nav-item.badge-new em{font-style:normal;font-size:10px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:2px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2}
.main{flex:1;margin-left:216px;display:flex;flex-direction:column}
.topbar{background:#fff;border-bottom:1px solid var(--border);padding:0 24px;height:56px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:5}
.topbar .page-title{font-size:17px;font-weight:700}
.topbar .user-box{display:flex;align-items:center;gap:12px}
.topbar .user-name{color:var(--text-2);font-size:13px}'''

new_main_css = '''.main{flex:1;display:flex;flex-direction:column}
.subnav .user-box{display:flex;align-items:center;gap:12px}
.subnav .user-name{color:var(--text-2);font-size:13px}
.content{padding:24px;flex:1;max-width:1280px;width:100%;margin:0 auto}'''

if old_main_css not in html:
    print("ERROR: old_main_css not found!")
    sys.exit(1)
html = html.replace(old_main_css, new_main_css)

# ========== 3. HTML 大改：左侧 aside 侧边栏 → 顶栏 + 分组下拉 ==========
old_layout = '''<div id="app-view">
  <div class="layout">
    <aside class="sidebar">
      <div class="brand"><div class="mark">序</div><div class="name">数序ERP</div></div>
      <a class="nav-item" data-view="dashboard" href="#/dashboard" onclick="go('dashboard')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>概览</a>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/><path d="M9 21v-6h6v6"/></svg>店铺中心</div>
        <a class="nav-item sub" data-view="shops" href="#/shops" onclick="go('shops')">店铺授权</a>
        <a class="nav-item sub" data-view="platforms" href="#/platforms" onclick="go('platforms')">平台接入</a>
      </div>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>商品中心</div>
        <a class="nav-item sub" data-view="products" href="#/products" onclick="go('products')">商品管理</a>
        <a class="nav-item sub badge-new" data-view="products-v2" href="#/products-v2" onclick="go('products-v2')">商品·V2完整版<em>NEW</em></a>
        <a class="nav-item sub" data-view="inventory" href="#/inventory" onclick="go('inventory')">库存管理</a>
        <a class="nav-item sub" data-view="inventory-ledger" href="#/inventory-ledger" onclick="go('inventory-ledger')">库存流水</a>
      </div>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>订单中心</div>
        <a class="nav-item sub" data-view="orders" href="#/orders" onclick="go('orders')">订单管理</a>
        <a class="nav-item sub badge-new" data-view="auto-audit" href="#/auto-audit" onclick="go('auto-audit')">自动审单规则<em>NEW</em></a>
        <a class="nav-item sub badge-new" data-view="aftersales" href="#/aftersales" onclick="go('aftersales')">售后逆向中心<em>NEW</em></a>
        <a class="nav-item sub" data-view="shipments" href="#/shipments" onclick="go('shipments')">发货记录</a>
      </div>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v7h-7V8z"/><circle cx="5.5" cy="19" r="1.5"/><circle cx="18.5" cy="19" r="1.5"/></svg>供应链</div>
        <a class="nav-item sub" data-view="purchases" href="#/purchases" onclick="go('purchases')">采购单</a>
        <a class="nav-item sub" data-view="suppliers" href="#/suppliers" onclick="go('suppliers')">供应商</a>
        <a class="nav-item sub" data-view="carriers" href="#/carriers" onclick="go('carriers')">物流商</a>
      </div>

      <div class="nav-group" id="nav-finance">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>财务中心</div>
        <a class="nav-item sub" data-view="finance" href="#/finance" onclick="go('finance')">订单利润</a>
        <a class="nav-item sub badge-new" data-view="finance-v2" href="#/finance-v2" onclick="go('finance-v2')">利润看板·V2<em>NEW</em></a>
        <a class="nav-item sub badge-new" data-view="exchange-rates" href="#/exchange-rates" onclick="go('exchange-rates')">多币种汇率<em>NEW</em></a>
        <a class="nav-item sub" data-view="finance-report" href="#/finance-report" onclick="go('finance-report')">经营报表</a>
      </div>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>自动化中心·V2</div>
        <a class="nav-item sub badge-new" data-view="scheduler" href="#/scheduler" onclick="go('scheduler')">任务监控调度<em>NEW</em></a>
                <a class="nav-item sub badge-new" id="nav-saas-admin" data-view="saas-admin" href="#/saas-admin" onclick="go('saas-admin')">SaaS运营后台<em>NEW</em></a>
      </div>

      <div class="nav-group">
        <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>系统设置</div>
        <a class="nav-item sub" data-view="audit-logs" href="#/audit-logs" onclick="go('audit-logs')">审计日志</a>
        <a class="nav-item sub" data-view="settings" href="#/settings" onclick="go('settings')">账户设置</a>
      </div>

      <div class="plan-box" id="plan-box"></div>
    </aside>
    <div class="main">
      <div class="topbar">
        <div class="page-title" id="page-title">概览</div>
        <div class="user-box">'''

new_layout = '''<div id="app-view">
  <div class="layout">
    <!-- 顶部导航：品牌 + 分组菜单 + 用户区 -->
    <div class="topnav">
      <div class="brand"><div class="mark">序</div><div class="name">数序ERP</div></div>
      <div class="topnav-groups" id="topnav-groups">
        <!-- 概览：单按钮无下拉 -->
        <div class="nav-group" data-group="dashboard">
          <a class="nav-group-title" data-view="dashboard" href="#/dashboard" onclick="go('dashboard')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>概览
          </a>
        </div>
        <div class="nav-group" data-group="shops" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/><path d="M9 21v-6h6v6"/></svg>店铺中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="shops" href="#/shops" onclick="go('shops');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/></svg>店铺授权
            </a>
            <a class="nav-item" data-view="platforms" href="#/platforms" onclick="go('platforms');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>平台接入
            </a>
          </div>
        </div>
        <div class="nav-group" data-group="products" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>商品中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="products" href="#/products" onclick="go('products');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L12 3 4 7l8 4 8-4z"/><path d="M4 7v10l8 4 8-4V7"/><line x1="12" y1="11" x2="12" y2="21"/></svg>商品管理
            </a>
            <a class="nav-item badge-new" data-view="products-v2" href="#/products-v2" onclick="go('products-v2');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="13" y2="18"/></svg>商品·V2完整版<em>NEW</em>
            </a>
            <a class="nav-item" data-view="inventory" href="#/inventory" onclick="go('inventory');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>库存管理
            </a>
            <a class="nav-item" data-view="inventory-ledger" href="#/inventory-ledger" onclick="go('inventory-ledger');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>库存流水
            </a>
          </div>
        </div>
        <div class="nav-group" data-group="orders" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>订单中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="orders" href="#/orders" onclick="go('orders');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>订单管理
            </a>
            <a class="nav-item badge-new" data-view="auto-audit" href="#/auto-audit" onclick="go('auto-audit');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.93 0 3.68.61 5.12 1.65"/><path d="M21 3v6h-6"/></svg>自动审单规则<em>NEW</em>
            </a>
            <a class="nav-item badge-new" data-view="aftersales" href="#/aftersales" onclick="go('aftersales');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/><path d="M12 15v5"/><path d="M9 18h6"/></svg>售后逆向中心<em>NEW</em>
            </a>
            <a class="nav-item" data-view="shipments" href="#/shipments" onclick="go('shipments');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v7h-7V8z"/><circle cx="5.5" cy="19" r="1.5"/><circle cx="18.5" cy="19" r="1.5"/></svg>发货记录
            </a>
          </div>
        </div>
        <div class="nav-group" data-group="supply" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v7h-7V8z"/><circle cx="5.5" cy="19" r="1.5"/><circle cx="18.5" cy="19" r="1.5"/></svg>供应链
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="purchases" href="#/purchases" onclick="go('purchases');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>采购单
            </a>
            <a class="nav-item" data-view="suppliers" href="#/suppliers" onclick="go('suppliers');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/><path d="M17 3h3v3"/><path d="M7 3H4v3"/></svg>供应商
            </a>
            <a class="nav-item" data-view="carriers" href="#/carriers" onclick="go('carriers');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>物流商
            </a>
          </div>
        </div>
        <div class="nav-group" id="nav-finance" data-group="finance" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>财务中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="finance" href="#/finance" onclick="go('finance');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>订单利润
            </a>
            <a class="nav-item badge-new" data-view="finance-v2" href="#/finance-v2" onclick="go('finance-v2');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>利润看板·V2<em>NEW</em>
            </a>
            <a class="nav-item badge-new" data-view="exchange-rates" href="#/exchange-rates" onclick="go('exchange-rates');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>多币种汇率<em>NEW</em>
            </a>
            <a class="nav-item" data-view="finance-report" href="#/finance-report" onclick="go('finance-report');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>经营报表
            </a>
          </div>
        </div>
        <div class="nav-group" id="nav-saas-group" data-group="saas" onclick="event.stopPropagation()" style="display:none">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3h18v18H3z"/><path d="M9 9h6v6H9z"/></svg>运营
          </div>
          <div class="nav-group-menu">
            <a class="nav-item badge-new" id="nav-saas-admin" data-view="saas-admin" href="#/saas-admin" onclick="go('saas-admin');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>SaaS运营后台<em>NEW</em>
            </a>
          </div>
        </div>
        <div class="nav-group" data-group="settings" onclick="event.stopPropagation()">
          <div class="nav-group-title" onclick="toggleNavGroup(this)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>系统设置
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="audit-logs" href="#/audit-logs" onclick="go('audit-logs');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="16" y2="13"/><line x1="9" y1="17" x2="16" y2="17"/></svg>审计日志
            </a>
            <a class="nav-item" data-view="settings" href="#/settings" onclick="go('settings');closeNavGroups()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>账户设置
            </a>
          </div>
        </div>
      </div>
      <div class="topnav-right">
        <div class="plan-mini" id="plan-box"></div>
        <div class="user-box">'''

if old_layout not in html:
    print("ERROR: old_layout not found!")
    sys.exit(1)
html = html.replace(old_layout, new_layout)

# ========== 4. user-box 后续：把 <div class="main"> 后面的 topbar 改为 subnav ==========
old_userbox_tail = '''        </div>
      </div>
      <div class="content" id="content"></div>
    </div>
  </div>
</div>'''

new_userbox_tail = '''        </div>
      </div>
    </div>
    <!-- 子导航栏：页面标题 -->
    <div class="subnav">
      <div class="page-title" id="page-title">概览</div>
    </div>
    <div class="main">
      <div class="content" id="content"></div>
    </div>
  </div>
</div>'''

if old_userbox_tail not in html:
    print("ERROR: old_userbox_tail not found!")
    sys.exit(1)
html = html.replace(old_userbox_tail, new_userbox_tail)

# ========== 5. 注入 JS：顶部分组下拉 toggle + 旧 nav 高亮逻辑替换 ==========
# 找 enterApp 函数开头，在里面插入新的权限逻辑（SaaS分组）和高亮逻辑
old_enter_app_hl = '''  // 侧边栏菜单权限：SaaS运营后台 仅 super_admin（超级管理员）可见，其他角色完全隐藏
  const saasNav = document.getElementById('nav-saas-admin');
  if (saasNav) saasNav.style.display = (me && me.role === 'super_admin') ? '' : 'none';
  // 角色权限：非 owner（staff/viewer）隐藏财务中心，viewer 再隐藏写操作入口
  const finNav = document.getElementById('nav-finance');
  if (finNav) finNav.style.display = (me && me.role !== 'owner') ? 'none' : '';'''

new_enter_app_hl = '''  // 顶部导航菜单权限：SaaS运营后台 仅 super_admin（超级管理员）可见，其他角色完全隐藏
  const saasGroup = document.getElementById('nav-saas-group');
  if (saasGroup) saasGroup.style.display = (me && me.role === 'super_admin') ? '' : 'none';
  const saasNav = document.getElementById('nav-saas-admin');
  if (saasNav) saasNav.style.display = '';
  // 角色权限：非 owner（staff/viewer）隐藏财务中心分组，viewer 再隐藏写操作入口
  const finNav = document.getElementById('nav-finance');
  if (finNav) finNav.style.display = (me && me.role !== 'owner') ? 'none' : '';
  // 顶栏分组高亮：根据当前 view 找到对应所属分组
  highlightNavGroup();'''

if old_enter_app_hl not in html:
    print("ERROR: old_enter_app_hl not found")
    sys.exit(1)
html = html.replace(old_enter_app_hl, new_enter_app_hl)

# ========== 6. 在 avatar menu toggle 函数附近注入分组menu函数 + 高亮函数 + 点击空白关闭 ==========
# 在头像菜单脚本前插入
old_avatar_script = '''/* ===== 头像下拉菜单逻辑 ===== */'''
new_helper_scripts = '''/* ===== 顶部导航分组下拉逻辑 ===== */
function toggleNavGroup(el) {
  event && event.stopPropagation && event.stopPropagation();
  var groups = document.querySelectorAll('.topnav-groups .nav-group');
  var thisGroup = el ? el.closest('.nav-group') : null;
  groups.forEach(function(g) { if (g !== thisGroup) g.classList.remove('open'); });
  if (thisGroup) thisGroup.classList.toggle('open');
}
function closeNavGroups() {
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('open'); });
}
function highlightNavGroup() {
  var cur = String(location.hash || '').replace('#/','').split('?')[0] || 'dashboard';
  var items = document.querySelectorAll('.topnav-groups .nav-item, .topnav-groups [data-view]');
  var matchGroup = null;
  items.forEach(function(el) {
    var v = el.getAttribute && el.getAttribute('data-view');
    var on = (v === cur);
    el.classList.toggle('on', !!on);
    if (on) {
      var g = el.closest && el.closest('.nav-group');
      if (g) matchGroup = g;
    }
  });
  // 对所属分组title加on
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g) {
    var t = g.querySelector('.nav-group-title');
    if (t) t.classList.toggle('on', g === matchGroup);
  });
}
// 点击空白关闭所有顶部分组下拉
document.addEventListener('click', function(){ closeNavGroups(); });

/* ===== 头像下拉菜单逻辑 ===== */'''

if old_avatar_script not in html:
    print("ERROR: old_avatar_script not found!")
    sys.exit(1)
html = html.replace(old_avatar_script, new_helper_scripts)

# ========== 7. go() 里补高亮 ==========
old_go_hl = '''  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.view === view));
  document.getElementById('page-title').textContent = VIEW_TITLES[view];'''

new_go_hl = '''  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.view === view));
  highlightNavGroup();
  document.getElementById('page-title').textContent = VIEW_TITLES[view];'''

if old_go_hl not in html:
    print("ERROR: old_go_hl not found!")
    sys.exit(1)
html = html.replace(old_go_hl, new_go_hl)

# ========== 8. renderPlanBox 适配新 plan-mini 结构 ==========
old_render_plan = '''function renderPlanBox() {
  if (!tenant) return;
  const expired = tenant.expired;
  document.getElementById('plan-box').innerHTML = `
    <div class="p-name">${esc(tenant.planName)}</div>
    <div class="p-exp ${expired ? 'warn' : ''}">${expired ? '已到期，续费后恢复使用' : '有效期至 ' + fmtDate(tenant.expire_at)}</div>`;
}'''

new_render_plan = '''function renderPlanBox() {
  if (!tenant) return;
  const expired = tenant.expired;
  document.getElementById('plan-box').innerHTML = `
    <div class="p-name">${esc(tenant.planName)}</div>
    <div class="p-exp ${expired ? 'warn' : ''}">${expired ? '已到期' : '至 ' + String(tenant.expire_at||'').slice(5,10)}</div>`;
}'''

if old_render_plan not in html:
    print("ERROR: old_render_plan not found!")
    sys.exit(1)
html = html.replace(old_render_plan, new_render_plan)

# ========== 9. 删除 go() 中 scheduler 路由？保留作为隐藏功能以防万一，但前端不显示菜单入口 ==========
# 不删 loader，因为路由还可被知道的人访问，只是 UI 不提供入口。已经在上面 HTML 里删除了 scheduler 菜单项（B2 完成）

open(SRC, 'w', encoding='utf-8').write(html)
print("✓ B1+B2+B3 改造完成：sidebar→topnav")
print("  - 所有分组菜单改为 hover / 点击下拉浮层")
print("  - 自动化中心·V2 分组 + scheduler 菜单项 已删除")
print("  - SaaS运营后台移至独立【运营】分组(super_admin可见)")
print("  - 汇率仍在财务中心分组下")
print("  - 系统设置: 审计日志 + 账户设置（与菜单项对齐）")
print("  - plan-box 改为顶栏 plan-mini（品牌右侧 非侧边栏底部）")
