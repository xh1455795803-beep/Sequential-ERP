#!/usr/bin/env python3
"""P5 前端终版改造一次性脚本：
- 移除侧边栏"套餐配额"菜单（移到头像下拉）
- 顶栏改造为头像下拉菜单（固定5项）
- 添加套餐订阅页 loadBilling 完整UI
- VIEW_TITLES 和 loaders 注入 billing
- 增加套餐到期弹窗引导续费
"""
import re, os

PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

# ============ 1. 移除侧边栏"套餐配额"菜单 ============
old_quota_menu = '''<a class="nav-item sub badge-new" data-view="quota" href="#/quota" onclick="go('quota')">套餐配额<em>NEW</em></a>
'''
html = html.replace(old_quota_menu, '')

# ============ 2. 改造顶栏 user-box 为头像下拉菜单 ============
old_userbox = '''      <div class="topbar">
        <div class="page-title" id="page-title">概览</div>
        <div class="user-box">
          <div class="notif-btn" id="notif-btn" onclick="toggleNotif()" title="通知公告">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            <span class="notif-dot" id="notif-dot" style="display:none">0</span>
            <div class="notif-panel" id="notif-panel" onclick="event.stopPropagation()">
              <div class="notif-head"><h4>通知公告</h4><a onclick="readAllNotif()">全部已读</a></div>
              <div class="notif-list" id="notif-list"></div>
            </div>
          </div>
          <span class="user-name" id="user-name"></span>
          <button class="btn-ghost" onclick="logout()">退出登录</button>
        </div>
      </div>'''

new_userbox = '''      <div class="topbar">
        <div class="page-title" id="page-title">概览</div>
        <div class="user-box">
          <div class="notif-btn" id="notif-btn" onclick="toggleNotif()" title="通知公告">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
            <span class="notif-dot" id="notif-dot" style="display:none">0</span>
            <div class="notif-panel" id="notif-panel" onclick="event.stopPropagation()">
              <div class="notif-head"><h4>通知公告</h4><a onclick="readAllNotif()">全部已读</a></div>
              <div class="notif-list" id="notif-list"></div>
            </div>
          </div>
          <div class="avatar-wrap" id="avatar-wrap">
            <button class="avatar-btn" onclick="toggleAvatarMenu(event)" id="avatar-btn">
              <span class="avatar-img" id="avatar-img"></span>
              <span class="user-name" id="user-name" style="margin-left:8px"></span>
              <svg class="avatar-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="avatar-menu" id="avatar-menu" onclick="event.stopPropagation()">
              <div class="avatar-menu-header">
                <span class="avatar-big" id="avatar-big"></span>
                <div>
                  <div class="avatar-menu-name" id="avatar-menu-name"></div>
                  <div class="avatar-menu-role" id="avatar-menu-role"></div>
                </div>
              </div>
              <a class="avatar-menu-item" onclick="go('settings');closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                个人设置
              </a>
              <a class="avatar-menu-item" id="menu-billing" onclick="go('billing');closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                套餐订阅
              </a>
              <a class="avatar-menu-item" onclick="openChangePwd()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                修改密码
              </a>
              <a class="avatar-menu-item" onclick="toggleNotif();closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
                消息通知
              </a>
              <div class="avatar-menu-divider"></div>
              <a class="avatar-menu-item logout" onclick="logout()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                退出登录
              </a>
            </div>
          </div>
        </div>
      </div>'''
html = html.replace(old_userbox, new_userbox)

# ============ 3. VIEW_TITLES 注入 billing ============
old_view_titles = "VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', quota:'套餐配额', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置' };"
new_view_titles = "VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置', billing:'套餐订阅' };"
html = html.replace(old_view_titles, new_view_titles)

# ============ 4. loaders 注入 billing: loadBilling ============
old_loaders = "const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, quota: loadQuota, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings };"
new_loaders = "const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings, billing: loadBilling };"
html = html.replace(old_loaders, new_loaders)

# ============ 5. 在 enterApp 内设置头像 + 权限控制（子账号隐藏 billing） ============
old_enterapp = '''async function enterApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  document.getElementById('user-name').textContent = (tenant ? tenant.name + ' · ' : '') + (me ? me.username : '');
  // 角色权限：非 owner（staff/viewer）隐藏财务中心，viewer 再隐藏写操作入口
  const finNav = document.getElementById('nav-finance');
  if (finNav) finNav.style.display = (me && me.role !== 'owner') ? 'none' : '';
  renderPlanBox();'''
new_enterapp = '''async function enterApp() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'block';
  const uname = (me ? me.username : '');
  const displayName = (tenant ? tenant.name + ' · ' : '') + uname;
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = displayName;
  const menuNameEl = document.getElementById('avatar-menu-name');
  if (menuNameEl) menuNameEl.textContent = displayName;
  const menuRoleEl = document.getElementById('avatar-menu-role');
  if (menuRoleEl) menuRoleEl.textContent = { owner:'主账号·拥有者', staff:'操作员', viewer:'只读成员', super_admin:'超级管理员' }[me && me.role] || (me && me.role) || '成员';
  // 头像首字母渲染
  const ch = (uname || 'U').charAt(0).toUpperCase();
  const colors = ['#6366f1','#06b6d4','#10b981','#f59e0b','#ef4444','#8b5cf6'];
  const color = colors[(uname||'').charCodeAt(0) % colors.length];
  ['avatar-img','avatar-big'].forEach(id => {
    const e = document.getElementById(id);
    if (e) { e.textContent = ch; e.style.background = color; }
  });
  // 权限：子账号（staff/viewer）隐藏「套餐订阅」入口；超级管理员租户视图也隐藏
  const billingMenu = document.getElementById('menu-billing');
  if (billingMenu) billingMenu.style.display = (me && me.role === 'owner') ? '' : 'none';
  // 角色权限：非 owner（staff/viewer）隐藏财务中心，viewer 再隐藏写操作入口
  const finNav = document.getElementById('nav-finance');
  if (finNav) finNav.style.display = (me && me.role !== 'owner') ? 'none' : '';
  renderPlanBox();
  // 套餐到期检测：到期弹窗引导续费
  if (tenant && tenant.expired) {
    setTimeout(() => showExpiredModal(), 600);
  }'''
html = html.replace(old_enterapp, new_enterapp)

# ============ 6. 在样式 section 注入头像菜单 CSS ============
# 找到 </style> 之前插入
avatar_css = '''
/* ===== 头像下拉菜单（固定最终版） ===== */
.avatar-wrap { position:relative; display:inline-flex; align-items:center; }
.avatar-btn { display:inline-flex; align-items:center; gap:4px; padding:4px 10px 4px 4px; border:1px solid var(--border); border-radius:999px; background:#fff; cursor:pointer; transition:all .15s; }
.avatar-btn:hover { border-color:var(--primary); box-shadow:0 2px 8px rgba(99,102,241,.15); }
.avatar-img { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:50%; color:#fff; font-weight:700; font-size:14px; background:#6366f1; flex-shrink:0; }
.avatar-caret { width:14px; height:14px; color:var(--text-2); }
.avatar-menu { position:absolute; right:0; top:calc(100% + 8px); width:280px; background:#fff; border:1px solid var(--border); border-radius:14px; box-shadow:0 12px 40px rgba(15,23,42,.15); z-index:9999; padding:8px; display:none; animation:fadeInDown .18s ease; }
.avatar-menu.show { display:block; }
@keyframes fadeInDown { from { opacity:0; transform:translateY(-6px);} to {opacity:1; transform:translateY(0);} }
.avatar-menu-header { display:flex; align-items:center; gap:12px; padding:12px; border-bottom:1px solid var(--border); margin-bottom:4px; }
.avatar-big { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; color:#fff; font-weight:700; font-size:18px; background:#6366f1; flex-shrink:0; }
.avatar-menu-name { font-weight:700; font-size:14px; color:var(--text-1); line-height:1.3; }
.avatar-menu-role { font-size:12px; color:var(--text-2); margin-top:3px; }
.avatar-menu-item { display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:10px; color:var(--text-1); font-size:14px; cursor:pointer; transition:background .12s; text-decoration:none; }
.avatar-menu-item:hover { background:var(--gray-bg); }
.avatar-menu-item svg { width:18px; height:18px; color:var(--text-2); flex-shrink:0; }
.avatar-menu-item.logout { color:#ef4444; }
.avatar-menu-item.logout svg { color:#ef4444; }
.avatar-menu-divider { height:1px; background:var(--border); margin:6px 4px; }
'''
# 注入到最后一个 </style> 前
html = html.replace('</style>\n\n<!-- ===== 登录视图 ===== -->', avatar_css + '</style>\n\n<!-- ===== 登录视图 ===== -->')

# ============ 7. 在 saasAdminLogin 函数后注入：头像菜单逻辑 + 到期弹窗 + 修改密码 + loadBilling 完整UI ============
inject_code = r'''
/* ===== 头像下拉菜单逻辑 ===== */
function toggleAvatarMenu(ev) {
  if (ev) ev.stopPropagation();
  const m = document.getElementById('avatar-menu');
  m.classList.toggle('show');
  if (m.classList.contains('show')) {
    setTimeout(() => {
      const hd = (e) => { if (!(e.target.closest && e.target.closest('#avatar-wrap'))) { m.classList.remove('show'); document.removeEventListener('click', hd); } };
      document.addEventListener('click', hd);
    }, 10);
  }
}
function closeAvatarMenu() {
  const m = document.getElementById('avatar-menu');
  if (m) m.classList.remove('show');
}
/* ===== 修改密码弹窗 ===== */
function openChangePwd() {
  closeAvatarMenu();
  openModal('修改密码', `
    <div style="display:flex;flex-direction:column;gap:14px;max-width:400px">
      <div><label class="lbl">当前密码</label><input id="pwd-old" type="password" class="input" placeholder="请输入当前密码"></div>
      <div><label class="lbl">新密码（≥8位）</label><input id="pwd-new" type="password" class="input" placeholder="至少8位，建议包含大小写+数字"></div>
      <div><label class="lbl">确认新密码</label><input id="pwd-new2" type="password" class="input" placeholder="再次输入新密码"></div>
    </div>`, [
      { text:'取消', class:'ghost', click: closeModal },
      { text:'确认修改', class:'primary', click: async () => {
          const o = document.getElementById('pwd-old').value;
          const n = document.getElementById('pwd-new').value;
          const n2 = document.getElementById('pwd-new2').value;
          if (!o || !n || !n2) { toast('请填写完整','warn'); return; }
          if (n.length < 8) { toast('新密码至少8位','warn'); return; }
          if (n !== n2) { toast('两次新密码不一致','warn'); return; }
          try {
            await api('/auth/change-password', 'POST', { old_password:o, new_password:n });
            toast('密码修改成功，请重新登录','ok');
            closeModal(); logout();
          } catch(e) { toast(e.message, 'err'); }
        }}
    ]);
}
/* ===== 套餐到期弹窗引导 ===== */
function showExpiredModal() {
  openModal('套餐已到期', `
    <div style="text-align:center;padding:10px 0 20px">
      <div style="font-size:48px">⏰</div>
      <h3 style="margin:12px 0 6px;color:#ef4444">您的套餐已到期</h3>
      <p style="color:var(--text-2);margin:0 0 20px">新增订单、商品、店铺等功能已冻结<br/>续费后立即恢复全部功能使用</p>
    </div>`, [
      { text:'稍后再说', class:'ghost', click: closeModal },
      { text:'立即续费', class:'primary', click: () => { closeModal(); go('billing'); } }
    ]);
}
/* ===== 套餐订阅页（头像下拉 → 套餐订阅） ===== */
const PLAN_DEFS = {
  basic:    { name:'基础版',  price:{ month:199,  quarter:539,  year:1999  }, shops:5,   monthlyOrders:3000,  products:500,   ai:500,    storage:5,    features:['订单管理','商品管理','库存管理','基础财务报表','5个店铺接入'] },
  standard: { name:'标准版',  price:{ month:599,  quarter:1599, year:5999  }, shops:20,  monthlyOrders:15000, products:3000,  ai:3000,   storage:50,   features:['基础版全部功能','自动审单规则','售后逆向流程','多币种汇率','API接口对接'] },
  pro:      { name:'专业版',  price:{ month:1599, quarter:4299, year:15999 }, shops:100, monthlyOrders:80000, products:20000, ai:20000,  storage:500,  features:['标准版全部功能','AI智能服务（销量预测/风险检测）','高级财务利润中心','任务调度中心','专属客户经理'] },
  enterprise:{name:'企业版',  price:{ month:4999, quarter:13499,year:49999 }, shops:999, monthlyOrders:9999999,products:999999,ai:999999, storage:5000, features:['专业版全部功能','私有化部署定制','独立数据库','7x24专属技术支持','二开功能定制','SLA服务保障'] }
};
const EXPAND_PACKS = [
  { key:'shop_10',  name:'店铺扩容包 +10',   price:199,  unit:'次' },
  { key:'shop_50',  name:'店铺扩容包 +50',   price:799,  unit:'次' },
  { key:'order_1w', name:'订单额度包 +1万/月',price:299,  unit:'月' },
  { key:'ai_1w',    name:'AI调用包 +1万次',  price:499,  unit:'次' },
  { key:'stor_100', name:'存储扩容包 +100G', price:999,  unit:'次' }
];
async function loadBilling() {
  // 权限拦截：非 owner 跳 dashboard
  if (!me || me.role !== 'owner') {
    toast('仅主账号可查看套餐订阅','warn');
    go('dashboard'); return;
  }
  let sub = null, orders = [], usage = {};
  try { sub = await api('/billing/subscription'); } catch(e) { toast(e.message,'err'); }
  try { usage = await api('/quota/usage'); } catch(e) {}
  try { const r = await api('/billing/orders?page=1&size=20'); orders = r.items || []; } catch(e) {}
  const s = sub && sub.subscription ? sub.subscription : {};
  const plan = PLAN_DEFS[s.plan_code] || PLAN_DEFS.basic;
  const u = usage && usage.usage ? usage.usage : {};
  const pct = (key, lim) => lim>0 ? Math.min(100, Math.round((Number(u[key]||0)/lim)*100)) : 0;
  document.getElementById('content').innerHTML = `
    <div class="banner ok">
      <strong>💎 套餐订阅中心</strong>
      <span style="margin-left:12px;color:var(--text-2)">主账号专属：查看当前套餐、选购套餐、购买扩容包、续费记录与在线支付</span>
    </div>
    <!-- 当前套餐卡片 -->
    <div class="card" style="margin-top:18px;background:linear-gradient(135deg,#6366f1 0%,#06b6d4 100%);color:#fff;border:none">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:18px">
        <div>
          <div style="font-size:13px;opacity:.85;margin-bottom:6px">当前套餐</div>
          <div style="font-size:28px;font-weight:800">${plan.name}</div>
          <div style="margin-top:10px;opacity:.9">${s.expired?'<b style="color:#fecaca">⚠️ 已到期</b>':'有效期至：'+fmtDate(s.expire_at)} · 购买时间：${fmtDate(s.start_at)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:13px;opacity:.85">续费状态</div>
          <div style="font-size:20px;font-weight:700;margin:4px 0">${s.expired?'<span style="color:#fecaca">已冻结</span>':'<span>正常使用中</span>'}</div>
          <button class="btn" style="background:#fff;color:#6366f1;font-weight:700;margin-top:8px" onclick="document.getElementById('billing-plans').scrollIntoView({behavior:'smooth'})">${s.expired?'立即续费':'升级 / 续费'}</button>
        </div>
      </div>
      <!-- 用量进度条 -->
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:22px;padding-top:20px;border-top:1px solid rgba(255,255,255,.2)">
        ${[
          {k:'shop_count', lim:plan.shops, label:'店铺', unit:'个'},
          {k:'month_orders', lim:plan.monthlyOrders, label:'本月订单', unit:'单'},
          {k:'product_count', lim:plan.products, label:'商品', unit:'个'},
          {k:'ai_calls', lim:plan.ai, label:'AI调用', unit:'次'},
          {k:'storage_mb', lim:plan.storage*1024, label:'存储', unit:'MB'}
        ].map(x => {
          const used = Number(u[x.k]||0);
          const p = x.lim>0 ? Math.min(100, Math.round(used/x.lim*100)) : 0;
          return `<div>
            <div style="display:flex;justify-content:space-between;font-size:12px;opacity:.9;margin-bottom:6px">
              <span>${x.label}</span><b>${used.toLocaleString()} / ${x.lim>=1e9?'不限':x.lim.toLocaleString()} ${x.unit}</b>
            </div>
            <div style="height:8px;background:rgba(255,255,255,.2);border-radius:999px;overflow:hidden">
              <div style="height:100%;width:${p}%;background:#fff;border-radius:999px"></div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>
    <!-- 套餐选购 -->
    <div id="billing-plans" style="margin-top:24px">
      <h3 style="margin:0 0 4px">🛒 选购套餐</h3>
      <div style="color:var(--text-2);font-size:13px;margin-bottom:14px">选择套餐版本与购买周期，支持月付 / 季付 / 年付（年付省 2 个月）</div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px">
        ${Object.entries(PLAN_DEFS).map(([code, p]) => `
          <div class="card plan-card ${s.plan_code===code?'plan-card-current':''}" style="position:relative">
            ${code==='pro'?'<div style="position:absolute;top:-10px;right:12px;background:linear-gradient(90deg,#f59e0b,#ef4444);color:#fff;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700">🔥 最受欢迎</div>':''}
            ${s.plan_code===code?'<div style="position:absolute;top:-10px;left:12px;background:#10b981;color:#fff;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700">✓ 当前套餐</div>':''}
            <div style="text-align:center;padding:14px 0">
              <div style="font-size:18px;font-weight:800;color:var(--text-1)">${p.name}</div>
              <div style="margin-top:12px">
                <span style="font-size:12px;color:var(--text-2)">¥</span>
                <span style="font-size:36px;font-weight:800;color:var(--primary)" id="plan-price-${code}">${p.price.month}</span>
                <span style="font-size:13px;color:var(--text-2)" id="plan-unit-${code}">/月</span>
              </div>
              <div style="margin-top:12px;display:flex;gap:6px;justify-content:center">
                ${['month','quarter','year'].map(t => `<button class="btn-sm plan-cycle ${t==='month'?'primary':'neutral'}" data-plan="${code}" data-cycle="${t}" onclick="switchPlanCycle('${code}','${t}')">${{month:'月付',quarter:'季付',year:'年付'}[t]}</button>`).join('')}
              </div>
            </div>
            <div style="border-top:1px solid var(--border);padding:14px 8px;min-height:220px">
              <div style="font-size:12px;font-weight:700;color:var(--text-2);margin-bottom:10px;text-transform:uppercase">套餐包含</div>
              <ul style="list-style:none;padding:0;margin:0;font-size:13px;color:var(--text-1);line-height:2">
                <li>🏬 店铺数：<b>${p.shops}</b> 个</li>
                <li>📦 月订单：<b>${p.monthlyOrders>=1e9?'不限':p.monthlyOrders.toLocaleString()}</b></li>
                <li>🏷️ 商品数：<b>${p.products>=1e9?'不限':p.products.toLocaleString()}</b></li>
                <li>🤖 AI调用：<b>${p.ai>=1e9?'不限':p.ai.toLocaleString()}</b> 次/月</li>
                <li>💾 存储：<b>${p.storage}</b> GB</li>
              </ul>
              <div style="height:1px;background:var(--border);margin:12px 0"></div>
              <ul style="list-style:none;padding:0;margin:0;font-size:12px;color:var(--text-2);line-height:1.9">
                ${p.features.map(f => `<li>✓ ${f}</li>`).join('')}
              </ul>
            </div>
            <div style="padding:12px 0 4px;text-align:center">
              <button class="btn ${s.plan_code===code?'':'primary'}" style="width:92%" onclick="createPlanOrder('${code}', window.__planCycle['${code}']||'month')">${s.plan_code===code?'续费 / 延长有效期':'立即选购'}</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <!-- 扩容包 -->
    <div style="margin-top:28px">
      <h3 style="margin:0 0 4px">📦 扩容包采购</h3>
      <div style="color:var(--text-2);font-size:13px;margin-bottom:14px">按需叠加资源，立即生效不等待</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px">
        ${EXPAND_PACKS.map(e => `
          <div class="card" style="text-align:center;padding:18px 12px">
            <div style="font-weight:700;font-size:14px;min-height:40px;display:flex;align-items:center;justify-content:center">${e.name}</div>
            <div style="margin:14px 0">
              <span style="color:var(--text-2);font-size:12px">¥</span>
              <span style="font-size:26px;font-weight:800;color:var(--primary)">${e.price}</span>
              <span style="color:var(--text-2);font-size:12px">/${e.unit}</span>
            </div>
            <button class="btn primary btn-sm" style="width:100%" onclick="buyExpandPack('${e.key}', ${e.price}, '${e.name}')">立即购买</button>
          </div>
        `).join('')}
      </div>
    </div>
    <!-- 续费记录 -->
    <div class="card" style="margin-top:28px">
      <div class="card-head"><h3>📋 续费 / 购买记录</h3></div>
      <table class="data-table">
        <thead><tr><th>订单号</th><th>类型</th><th>套餐 / 包</th><th>金额</th><th>支付方式</th><th>状态</th><th>下单时间</th><th>操作</th></tr></thead>
        <tbody>
          ${orders.map(o => `
            <tr>
              <td>#${o.order_no||o.id}</td>
              <td>${{plan:'套餐订阅',expand:'扩容包',renewal:'续费'}[o.order_type]||o.order_type}</td>
              <td>${o.item_name||'-'} ${o.cycle?'('+{month:'月',quarter:'季',year:'年'}[o.cycle]+')':''}</td>
              <td style="font-weight:700;color:var(--primary)">¥${Number(o.amount||0).toFixed(2)}</td>
              <td>${{transfer:'对公转账',wechat:'微信',alipay:'支付宝'}[o.pay_method]||o.pay_method||'待支付'}</td>
              <td><span class="pill ${o.status==='PAID'?'ok':o.status==='PENDING'?'warn':'neutral'}">${{PENDING:'待付款',PAID:'已付款',CANCELLED:'已取消',REFUNDED:'已退款'}[o.status]||o.status}</span></td>
              <td>${fmtDate(o.created_at)}</td>
              <td>${o.status==='PENDING'?`<button class="btn-sm primary" onclick="payOrder(${o.id}, '${o.order_no}')">去支付</button>`:''}<button class="btn-sm neutral" onclick="toast('订单详情（WIP）','ok')">详情</button></td>
            </tr>
          `).join('') || `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-2)">暂无订单记录，选购套餐后将在这里展示</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
  // 初始化套餐切换状态
  if (!window.__planCycle) window.__planCycle = {};
  Object.keys(PLAN_DEFS).forEach(c => { if (!window.__planCycle[c]) window.__planCycle[c] = 'month'; });
}
function switchPlanCycle(code, cycle) {
  window.__planCycle = window.__planCycle || {};
  window.__planCycle[code] = cycle;
  const p = PLAN_DEFS[code];
  const priceEl = document.getElementById('plan-price-'+code);
  const unitEl = document.getElementById('plan-unit-'+code);
  if (priceEl) priceEl.textContent = p.price[cycle];
  if (unitEl) unitEl.textContent = cycle==='month'?'/月':(cycle==='quarter'?'/季':'/年');
  // 按钮高亮
  document.querySelectorAll(`.plan-cycle[data-plan="${code}"]`).forEach(b => {
    b.classList.toggle('primary', b.dataset.cycle === cycle);
    b.classList.toggle('neutral', b.dataset.cycle !== cycle);
  });
}
async function createPlanOrder(planCode, cycle) {
  try {
    const r = await api('/billing/orders', 'POST', { order_type:'plan', plan_code:planCode, cycle:cycle });
    toast('订单已创建','ok');
    payOrder(r.order.id, r.order.order_no);
  } catch(e) { toast(e.message, 'err'); }
}
async function buyExpandPack(packKey, price, name) {
  try {
    const r = await api('/billing/orders', 'POST', { order_type:'expand', pack_key:packKey, amount:price });
    toast('扩容包订单已创建','ok');
    payOrder(r.order.id, r.order.order_no);
  } catch(e) { toast(e.message, 'err'); }
}
function payOrder(orderId, orderNo) {
  openModal('在线支付 · 订单 #' + orderNo, `
    <div style="max-width:520px">
      <div style="text-align:center;padding:14px;border:1px dashed var(--primary);border-radius:12px;background:var(--primary-light)">
        <div style="font-size:13px;color:var(--text-2)">订单应付金额</div>
        <div style="font-size:38px;font-weight:800;color:var(--primary);margin-top:6px" id="pay-amount">--</div>
      </div>
      <h4 style="margin:20px 0 12px">选择支付方式</h4>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
        <label class="pay-method" onclick="selectPay('wechat')">
          <input type="radio" name="pay-m" value="wechat" checked>
          <div><div class="pay-icon" style="background:#1aad19">💚</div><div class="pay-name">微信支付</div></div>
        </label>
        <label class="pay-method" onclick="selectPay('alipay')">
          <input type="radio" name="pay-m" value="alipay">
          <div><div class="pay-icon" style="background:#1677ff">💙</div><div class="pay-name">支付宝</div></div>
        </label>
        <label class="pay-method" onclick="selectPay('transfer')">
          <input type="radio" name="pay-m" value="transfer">
          <div><div class="pay-icon" style="background:#6366f1">🏦</div><div class="pay-name">对公转账</div></div>
        </label>
      </div>
      <div id="pay-transfer-box" style="display:none;margin-top:18px;padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg);font-size:13px;line-height:2">
        <div><b>开户名：</b>深圳数序科技有限公司</div>
        <div><b>银行账号：</b>4000 0234 0920 0188 666</div>
        <div><b>开户行：</b>中国工商银行深圳南山支行</div>
        <div><b>备注：</b>请在转账备注填写订单号 <b style="color:var(--primary)">${orderNo}</b></div>
        <div style="margin-top:8px;color:var(--text-2)">上传转账凭证 → 财务 30 分钟内审核 → 自动开通</div>
        <div style="margin-top:10px"><label class="btn-ghost btn-sm" style="display:inline-flex;align-items:center;gap:6px;cursor:pointer">📎 上传转账凭证<input id="pay-voucher" type="file" accept="image/*" style="display:none"></label> <span id="pay-voucher-name" style="color:var(--text-2);font-size:12px;margin-left:8px"></span></div>
      </div>
      <div id="pay-qr-box" style="margin-top:18px;text-align:center;display:none">
        <div style="display:inline-block;padding:16px;border:1px solid var(--border);border-radius:14px;background:#fff">
          <div style="width:200px;height:200px;background:repeating-conic-gradient(#000 0 25%, #fff 0 50%) 50%/12px 12px;border-radius:4px"></div>
          <div style="font-size:12px;color:var(--text-2);margin-top:10px">请使用微信/支付宝扫码支付</div>
        </div>
      </div>
    </div>`, [
      { text:'取消支付', class:'ghost', click: closeModal },
      { text:'确认支付', class:'primary', click: async () => {
          const m = document.querySelector('input[name="pay-m"]:checked').value;
          try {
            await api('/billing/orders/'+orderId+'/pay', 'POST', { pay_method:m, voucher_url: window.__payVoucher||null });
            toast('支付成功，套餐已开通/续费！','ok');
            closeModal();
            loadBilling();
          } catch(e) { toast(e.message, 'err'); }
        }}
    ]);
  // 回填金额
  api('/billing/orders/'+orderId).then(r => {
    const el = document.getElementById('pay-amount');
    if (el && r && r.order) el.textContent = '¥' + Number(r.order.amount||0).toFixed(2);
  }).catch(()=>{});
  // 支付方式切换
  setTimeout(() => {
    const vf = document.getElementById('pay-voucher');
    if (vf) vf.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      document.getElementById('pay-voucher-name').textContent = '已选择：' + f.name;
      // 模拟上传（真实实现用 FormData + /media/upload）
      window.__payVoucher = '/mock/voucher/' + Date.now() + '.jpg';
    };
    window.selectPay = (m) => {
      document.getElementById('pay-transfer-box').style.display = m==='transfer' ? 'block' : 'none';
      document.getElementById('pay-qr-box').style.display = (m==='wechat'||m==='alipay') ? 'block' : 'none';
    };
    selectPay('wechat');
  }, 50);
}
/* ===== 套餐订阅页 CSS ===== */
'''
# 还要加 plan-card CSS
inject_css_billing = '''
.plan-card { transition:all .18s; cursor:pointer; }
.plan-card:hover { transform:translateY(-4px); box-shadow:0 16px 40px rgba(15,23,42,.12); border-color:var(--primary); }
.plan-card-current { border-color:var(--primary); background:linear-gradient(180deg, rgba(99,102,241,.04), transparent); }
.plan-cycle { min-width:56px; }
.pay-method { display:block; padding:14px; border:2px solid var(--border); border-radius:12px; cursor:pointer; transition:all .15s; position:relative; }
.pay-method:has(input:checked) { border-color:var(--primary); background:var(--primary-light); }
.pay-method input { position:absolute; opacity:0; pointer-events:none; }
.pay-icon { width:40px; height:40px; border-radius:10px; color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; margin:0 auto 8px; }
.pay-name { text-align:center; font-weight:700; font-size:13px; color:var(--text-1); }
'''
# 注入到刚才的头像 CSS 后面：先替换头像 CSS 结尾位置，我们找个好位置：
html = html.replace('/* ===== 头像下拉菜单（固定最终版） ===== */',
                    '/* ===== 头像下拉菜单（固定最终版） ===== */\n' + inject_css_billing)

# 把所有函数注入到 saasAdminLogin 后面
marker = "async function saasAdminLogin() {\n  const u = document.getElementById('saas-user').value.trim();\n  const p = document.getElementById('saas-pass').value;\n  if (!u || !p) { toast('请填写账号+密码','warn'); return; }\n  try {\n    const r = await fetch('/api/v1/saas/admin/login', {\n      method: 'POST',\n      headers: { 'Content-Type':'application/json' },\n      body: JSON.stringify({ username: u, password: p })\n    }).then(x => x.ok ? x.json() : Promise.reject(new Error(x.status + ' ' + x.statusText)));\n    toast(`运营账号「${r.admin&&r.admin.username}」登录成功（角色：${r.admin&&r.admin.role}）`,'ok');\n  } catch(e) { toast('运营后台登录失败：'+e.message,'err'); }\n}"
html = html.replace(marker, marker + '\n' + inject_code)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)

print('✅ P5 改造完成：')
print('  - 侧边栏套餐配额菜单已移除')
print('  - 顶栏已改为头像按钮 + 下拉菜单（固定5项）')
print('  - VIEW_TITLES 和 loaders 已注入 billing')
print('  - 子账号隐藏套餐订阅 / 到期弹窗引导续费')
print('  - loadBilling 完整UI：当前套餐渐变卡片 + 用量条 + 4套餐月/季/年切换 + 5扩容包 + 续费记录表 + 支付弹窗')
print(f'  - 文件总行数：{len(html.splitlines())}')
