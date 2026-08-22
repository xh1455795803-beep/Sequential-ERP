#!/usr/bin/env python3
"""
R1+R2 紧急修复：
问题：纯横向顶栏布局宽度不足，「系统设置」等分组溢出视口，用户侧表现为「导航栏/功能消失」
方案：恢复经典 ERP 双导航布局 = 顶部通栏(Logo + 分组快速 Tab + 通知 + 头像) + 左侧完整菜单 Sidebar（分组展开式，100% 功能可见不溢出）

保留 B2~B5：无自动化中心、汇率在财务中心、汇率 60s 轮询、商品独立编辑页
"""
import re, sys

PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()
orig = html

# ========= 1. 替换布局 CSS =========
old_css_block = """/* ===== 主布局：顶部横向导航 ===== */
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
.sidebar{display:none!important}
.main{flex:1;display:flex;flex-direction:column}
.subnav .user-box{display:flex;align-items:center;gap:12px}
.subnav .user-name{color:var(--text-2);font-size:13px}"""

new_css_block = """/* ===== 主布局：经典 ERP 双导航（左侧 + 顶部） ===== */
:root{--topnav-h:60px;--sidebar-w:248px;--subnav-h:48px}
#app-view{display:none;min-height:100vh;flex-direction:column}
.layout{display:flex;flex-direction:column;min-height:100vh}
/* 顶部通栏：品牌 + 分组快速 Tab + 通知 + 头像 */
.topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 20px;gap:18px;flex:none}
.topnav .brand{display:flex;align-items:center;gap:9px;flex:none}
.topnav .brand .mark{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.topnav .brand .name{font-weight:800;font-size:16px;letter-spacing:.3px;color:var(--text-1)}
/* 顶部分组快速 Tab：单行不换行，宽度够装 6~8 个分组名，无下拉不抢空间 */
.topnav-groups{display:flex;align-items:center;gap:2px;flex:1;overflow-x:auto;min-width:0;scrollbar-width:none}
.topnav-groups::-webkit-scrollbar{display:none}
.topnav-groups .nav-group{position:static}
.topnav-groups .nav-group-title{display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:8px;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s}
.topnav-groups .nav-group-title:hover{background:var(--primary-light);color:var(--primary)}
.topnav-groups .nav-group-title svg{width:15px;height:15px;flex:none}
.topnav-groups .nav-group-title::after{content:''}
.topnav-groups .nav-group-title.on{background:var(--primary-light);color:var(--primary)}
/* 顶部分组 Tab 不显示下拉菜单：全功能改放左侧 Sidebar 垂直展开 */
.topnav-groups .nav-group-menu{display:none!important}
.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;color:var(--text-2);font-weight:500;text-decoration:none;font-size:13.5px;transition:all .1s;white-space:nowrap;line-height:1.3}
.nav-item:hover{background:var(--primary-light);color:var(--primary)}
.nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}
.nav-item svg{width:16px;height:16px;flex:none;color:var(--text-2)}
.nav-item:hover svg{color:var(--primary)}
.nav-item.on svg{color:var(--primary)}
.nav-item.badge-new{display:flex;align-items:center;justify-content:space-between;padding-right:12px}
.nav-item.badge-new em{font-style:normal;font-size:10px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:2px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2;margin-left:8px}
.topnav-right{display:flex;align-items:center;gap:12px;margin-left:auto}
.plan-mini{display:inline-flex;flex-direction:column;padding:4px 10px;border-left:1px solid var(--border);gap:1px;line-height:1.3}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:12.5px}
.plan-mini .p-exp{font-size:11.5px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}
/* 主体容器：左侧 Sidebar + 右侧 主区 */
.app-body{display:flex;flex:1;min-height:0}
/* 左侧完整菜单 Sidebar：分组垂直展开式，不溢出，所有功能一眼可见 */
.sidebar{display:flex!important;flex-direction:column;width:var(--sidebar-w);flex:0 0 var(--sidebar-w);background:#fff;border-right:1px solid var(--border);padding:14px 10px;gap:2px;overflow-y:auto}
.sidebar .nav-group{position:relative;display:flex;flex-direction:column;margin-bottom:2px}
.sidebar .nav-group-title{display:flex;align-items:center;gap:9px;padding:9px 12px;border-radius:9px;font-size:12.5px;font-weight:700;color:var(--text-3);cursor:default;letter-spacing:.2px;text-transform:none}
.sidebar .nav-group-title svg{width:15px;height:15px;flex:none;color:var(--primary)}
.sidebar .nav-group-title::after{content:''}
/* Sidebar 分组菜单：默认直接展开（手风琴始终可见），无浮层、无点击隐藏 */
.sidebar .nav-group-menu{display:flex!important;position:static!important;flex-direction:column;min-width:0!important;background:transparent!important;border:none!important;box-shadow:none!important;padding:0 0 6px 0!important;margin:0!important}
.sidebar .nav-group-menu .nav-item{padding:8px 10px 8px 36px;border-radius:7px;font-size:13px;font-weight:500;color:var(--text-2)}
.sidebar .nav-group-menu .nav-item svg{width:14px;height:14px}
.sidebar .nav-group-menu .nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}
/* SaaS 隐藏的运营分组仍保留 display:none（按权限控制） */
.sidebar .nav-group[data-group="saas"]{display:none}
/* 标题栏（页面面包屑标题） */
.subnav{background:#fff;border-bottom:1px solid var(--border);height:var(--subnav-h);display:flex;align-items:center;padding:0 22px;flex:none}
.subnav .page-title{font-size:16.5px;font-weight:700;margin-right:auto;color:var(--text-1)}
/* 主内容区：可滚动 */
.main{flex:1;display:flex;flex-direction:column;min-width:0}
.subnav .user-box{display:flex;align-items:center;gap:12px}
.subnav .user-name{color:var(--text-2);font-size:13px}
/* 小屏下：顶部分组Tab可滚动，sidebar 默认收起（这里先不做响应式，优先桌面端 ERP） */
@media (max-width:768px){
  :root{--sidebar-w:0px}
  .sidebar{display:none!important}
}"""

assert old_css_block in html, "CSS block NOT FOUND — may have already changed"
html = html.replace(old_css_block, new_css_block)

# ========= 2. HTML：添加 .app-body 包裹 Sidebar + Main，并注入完整 Sidebar（分组展开式） =========
# 当前 HTML：
#   <div class="layout">
#     <div class="topnav">...</div>
#     <div class="subnav">...</div>
#     <div class="main">...</div>
#   </div>
# 改为：
#   <div class="layout">
#     <div class="topnav">...</div>
#     <div class="app-body">
#       <aside class="sidebar">...</aside>
#       <div style="display:flex;flex-direction:column;flex:1;min-width:0">
#         <div class="subnav">...</div>
#         <div class="main">...</div>
#       </div>
#     </div>
#   </div>

# Sidebar 内容（分组标题 + 菜单项展开，不含下拉），与顶部分组保持一致，去掉 onclick 下拉逻辑
SIDEBAR_HTML = r"""      <!-- 左侧完整菜单 Sidebar：分组始终展开，所有功能一眼可见（不依赖下拉，永不消失） -->
      <aside class="sidebar" id="sidebar">
        <!-- 概览：单菜单项 -->
        <div class="nav-group" data-group="dashboard">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>概览
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="dashboard" href="#/dashboard" onclick="go('dashboard')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>总览概览
            </a>
          </div>
        </div>
        <!-- 店铺中心 -->
        <div class="nav-group" data-group="shops">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/><path d="M9 21v-6h6v6"/></svg>店铺中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="shops" href="#/shops" onclick="go('shops')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/></svg>店铺授权
            </a>
            <a class="nav-item" data-view="platforms" href="#/platforms" onclick="go('platforms')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>平台接入
            </a>
          </div>
        </div>
        <!-- 商品中心 -->
        <div class="nav-group" data-group="products">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>商品中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="products" href="#/products" onclick="go('products')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L12 3 4 7l8 4 8-4z"/><path d="M4 7v10l8 4 8-4V7"/></svg>商品管理
            </a>
            <a class="nav-item badge-new" data-view="products-v2" href="#/products-v2" onclick="go('products-v2')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="18" x2="13" y2="18"/></svg>商品·V2完整版<em>NEW</em>
            </a>
            <a class="nav-item" data-view="inventory" href="#/inventory" onclick="go('inventory')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4z"/><path d="M3.27 6.96L12 12.01l8.73-5.05"/></svg>库存管理
            </a>
            <a class="nav-item" data-view="inventory-ledger" href="#/inventory-ledger" onclick="go('inventory-ledger')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>库存流水
            </a>
          </div>
        </div>
        <!-- 订单中心 -->
        <div class="nav-group" data-group="orders">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>订单中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="orders" href="#/orders" onclick="go('orders')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>订单管理
            </a>
            <a class="nav-item badge-new" data-view="auto-audit" href="#/auto-audit" onclick="go('auto-audit')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.93 0 3.68.61 5.12 1.65"/></svg>自动审单规则<em>NEW</em>
            </a>
            <a class="nav-item badge-new" data-view="aftersales" href="#/aftersales" onclick="go('aftersales')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>售后逆向中心<em>NEW</em>
            </a>
            <a class="nav-item" data-view="shipments" href="#/shipments" onclick="go('shipments')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v7h-7V8z"/></svg>发货记录
            </a>
          </div>
        </div>
        <!-- 供应链 -->
        <div class="nav-group" data-group="supply">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-8-4-8 4v10l8 4 8-4V7z"/><path d="M2 13h20"/><path d="M2 17h20"/></svg>供应链
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="purchases" href="#/purchases" onclick="go('purchases')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>采购单
            </a>
            <a class="nav-item" data-view="suppliers" href="#/suppliers" onclick="go('suppliers')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>供应商
            </a>
            <a class="nav-item" data-view="carriers" href="#/carriers" onclick="go('carriers')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 4v4h-7V8z"/></svg>物流商
            </a>
          </div>
        </div>
        <!-- 财务中心（多币种汇率在此分组 B3 ✅） -->
        <div class="nav-group" data-group="finance">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>财务中心
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="finance" href="#/finance" onclick="go('finance')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/></svg>订单利润
            </a>
            <a class="nav-item badge-new" data-view="finance-v2" href="#/finance-v2" onclick="go('finance-v2')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>利润看板·V2<em>NEW</em>
            </a>
            <a class="nav-item badge-new" data-view="exchange-rates" href="#/exchange-rates" onclick="go('exchange-rates')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>多币种汇率<em>NEW</em>
            </a>
            <a class="nav-item" data-view="finance-report" href="#/finance-report" onclick="go('finance-report')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>经营报表
            </a>
          </div>
        </div>
        <!-- SaaS运营后台分组：权限控制隐藏 display:none，由 enterApp 按 super_admin 显示 -->
        <div class="nav-group" id="nav-saas-sidebar" data-group="saas" style="display:none">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/></svg>运营后台
          </div>
          <div class="nav-group-menu">
            <a class="nav-item badge-new" id="nav-saas-admin-sidebar" data-view="saas-admin" href="#/saas-admin" onclick="go('saas-admin')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>SaaS运营后台<em>NEW</em>
            </a>
          </div>
        </div>
        <!-- 系统设置 -->
        <div class="nav-group" data-group="settings">
          <div class="nav-group-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>系统设置
          </div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="audit-logs" href="#/audit-logs" onclick="go('audit-logs')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>审计日志
            </a>
            <a class="nav-item" data-view="settings" href="#/settings" onclick="go('settings')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>账户设置
            </a>
          </div>
        </div>
      </aside>
      <div class="app-main-col" style="display:flex;flex-direction:column;flex:1;min-width:0">
"""

old_html_wrap = """    <!-- 子导航栏：页面标题 -->
    <div class="subnav">
      <div class="page-title" id="page-title">概览</div>
    </div>
    <div class="main">
      <div class="content" id="content"></div>
    </div>
  </div>
</div>"""

new_html_wrap = f"""    <div class="app-body">
{SIDEBAR_HTML}        <!-- 子导航栏：页面标题 -->
        <div class="subnav">
          <div class="page-title" id="page-title">概览</div>
        </div>
        <div class="main">
          <div class="content" id="content"></div>
        </div>
      </div>
    </div>
  </div>
</div>"""

assert old_html_wrap in html, "HTML wrap NOT FOUND"
html = html.replace(old_html_wrap, new_html_wrap)

# ========= 3. enterApp 权限控制：同步控制 sidebar SaaS 运营后台 =========
old_enter_saas = "  document.getElementById('nav-saas-admin').style.display = (me && me.role === 'super_admin') ? '' : 'none';"
if old_enter_saas in html:
    new_enter_saas = old_enter_saas + "\n  // 左侧 Sidebar 的 SaaS 运营后台同步权限控制（与顶部一致）\n  const sidebarSaas = document.getElementById('nav-saas-sidebar');\n  if (sidebarSaas) sidebarSaas.style.display = (me && me.role === 'super_admin') ? '' : 'none';"
    html = html.replace(old_enter_saas, new_enter_saas)
else:
    # 兜底找 enterApp 内对 nav-saas-admin 的操作
    pass

# ========= 4. highlightNavGroup：同时高亮 sidebar 对应分组（基于当前 view → 所属分组） =========
# 修改旧的 highlightNavGroup 使其也扫 sidebar 的 nav-item
if 'function highlightNavGroup()' in html:
    old_hln = """function highlightNavGroup() {
  var groups = document.querySelectorAll('.topnav-groups .nav-group');
  groups.forEach(function(g){ g.classList.remove('on'); });
  var active = document.querySelector('.topnav-groups .nav-item.on');
  if (active) {
    var group = active.closest('.nav-group');
    if (group) group.classList.add('on');
  }
  // 点击空白关闭所有分组下拉
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('open'); });
}
document.addEventListener('click', function(e) {
  var items = document.querySelectorAll('.topnav-groups .nav-item, .topnav-groups [data-view]');
  var outside = true;
  items.forEach(function(i){ if (i.contains(e.target)) outside = false; });
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g) {
    var title = g.querySelector('.nav-group-title');
    if (title && title.contains(e.target)) outside = false;
    g.classList.remove('open');
  });
  if (outside) return;
});"""
else:
    old_hln = None

if old_hln and old_hln in html:
    new_hln = """function highlightNavGroup() {
  // 顶部分组 Tab 高亮（和当前 view 所在分组对应）
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('on'); });
  // 左侧 Sidebar：所有 nav-item 先移除 on，再根据当前 view 高亮
  var curView = String(location.hash || '').replace('#/', '').split('?')[0];
  // 处理 product/edit/:id → 高亮 products
  var mapView = curView;
  if (curView.startsWith('product/edit') || curView === 'product/new') mapView = 'products';
  document.querySelectorAll('#sidebar .nav-item, .topnav-groups .nav-item').forEach(function(n){
    n.classList.toggle('on', n.dataset.view === mapView);
  });
  // 顶部分组高亮：根据 view 推断所属分组
  var groupMap = {
    dashboard:'dashboard', shops:'shops', platforms:'shops',
    products:'products', 'products-v2':'products', inventory:'products', 'inventory-ledger':'products',
    orders:'orders', 'auto-audit':'orders', aftersales:'orders', shipments:'orders',
    purchases:'supply', suppliers:'supply', carriers:'supply',
    finance:'finance', 'finance-v2':'finance', 'exchange-rates':'finance', 'finance-report':'finance',
    'saas-admin':'saas', 'audit-logs':'settings', settings:'settings'
  };
  var gKey = groupMap[mapView];
  if (gKey) {
    var topG = document.querySelector('.topnav-groups .nav-group[data-group="'+gKey+'"]');
    if (topG) topG.classList.add('on');
  }
  // 顶部分组下拉浮层：点击页面其他地方自动关闭（sidebar 不用下拉，保留原逻辑不影响）
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('open'); });
}
document.addEventListener('click', function(e) {
  // 顶部分组下拉保持关闭（菜单在 Sidebar 展开），此处无需额外逻辑
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g) { g.classList.remove('open'); });
});
// 顶部分组 Tab 点击：跳转到该分组的第一个菜单项（快速切换）
function navGroupGo(group) {
  var firstMap = { dashboard:'dashboard', shops:'shops', products:'products', orders:'orders', supply:'purchases', finance:'finance', saas:'saas-admin', settings:'audit-logs' };
  if (firstMap[group]) go(firstMap[group]);
}"""
    html = html.replace(old_hln, new_hln)
    # 然后给顶部分组的 .nav-group-title 添加 onclick（原本是 toggleNavGroup → 改为 navGroupGo）
    # 注：概览本身是 <a> 标签 data-view="dashboard"，不需要改
    # 其他分组：<div class="nav-group-title" onclick="toggleNavGroup(this)"> → <div class="nav-group-title" onclick="navGroupGo('xxx')">
    # 用正则批量改
    import re
    grp_map = {
        'data-group="shops"': 'shops',
        'data-group="products"': 'products',
        'data-group="orders"': 'orders',
        'data-group="supply"': 'supply',
        'data-group="finance"': 'finance',
        'data-group="saas"': 'saas',
        'data-group="settings"': 'settings',
    }
    # 在 .topnav-groups 范围内的 nav-group-title
    for dg, key in grp_map.items():
        pat = r'(<div class="nav-group" ' + re.escape(dg) + r' onclick="event.stopPropagation\(\)">\s*<div class="nav-group-title" )onclick="toggleNavGroup\(this\)"'
        repl = r'\1onclick="navGroupGo(\'' + key + '\')"'
        html = re.sub(pat, repl, html)

# ========= 5. toggleNavGroup：保留（若未用到则兼容不报错） =========
if 'function toggleNavGroup' not in html:
    pass  # 已经没了也没关系

# ========= 6. 移除旧侧边栏关于调度中心 scheduler 的入口（B2 保证无自动化中心） =========
# VIEW_TITLES 中如果有 scheduler → 确保菜单不可见（CSS 中已无，sidebar 新注入也没有）
if "'scheduler'" in html and "scheduler:'任务监控·调度中心'" in html:
    print("注意：VIEW_TITLES 仍含 scheduler，但 Sidebar 已不渲染入口，若需完全清理可再处理")

# 写回
if html != orig:
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(html)
    print("[OK] R1+R2 经典双导航布局恢复：左侧 Sidebar + 顶部快速 Tab")
else:
    print("[NOCHANGE] 未修改，原文件相同")
    sys.exit(1)
