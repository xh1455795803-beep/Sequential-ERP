#!/usr/bin/env python3
"""P5 前端改造：头像下拉固定5项 + 套餐订阅页完整UI"""
from pathlib import Path
import re

HTML = Path('/workspace/deploy/admin/index.html')
text = HTML.read_text(encoding='utf-8')
original_len = len(text)

# ========== 1. 注入头像下拉 + Billing页面 CSS ==========
BILLING_CSS = r'''
/* ===== 头像下拉菜单（V2·终版） ===== */
.avatar-wrap{position:relative}
.user-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#8b5cf6);color:#fff;font-weight:700;font-size:14px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 6px rgba(37,99,235,0.25);user-select:none}
.user-avatar:hover{transform:scale(1.04)}
.avatar-menu{position:absolute;top:calc(100% + 10px);right:0;background:#fff;border-radius:12px;box-shadow:0 14px 40px rgba(15,23,42,0.15);border:1px solid var(--border);min-width:200px;padding:6px;z-index:200;display:none;animation:dropIn .15s ease-out}
.avatar-menu.show{display:block}
.avatar-menu::before{content:'';position:absolute;top:-6px;right:14px;width:12px;height:12px;background:#fff;border-top:1px solid var(--border);border-left:1px solid var(--border);transform:rotate(45deg)}
.avatar-menu a{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:8px;color:var(--text-1);font-size:13.5px;cursor:pointer;font-weight:500;transition:background .15s}
.avatar-menu a:hover{background:var(--primary-light);color:var(--primary)}
.avatar-menu a::before{content:'';width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;background:var(--primary-light);color:var(--primary);font-size:11px;font-weight:700;flex-shrink:0}
.avatar-menu a:nth-child(1)::before{content:'👤'}
.avatar-menu a:nth-child(2)::before{content:'💎'}
.avatar-menu a:nth-child(3)::before{content:'🔒'}
.avatar-menu a:nth-child(4)::before{content:'🔔'}
.avatar-menu a:nth-child(5)::before{content:'↩';background:#fef2f2;color:#dc2626}
.avatar-menu a:nth-child(5):hover{background:#fef2f2;color:#dc2626}
.avatar-menu .divider{height:1px;background:var(--border);margin:4px 0}
@keyframes dropIn{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

/* ===== Billing套餐订阅页 ===== */
.billing-hero{display:grid;grid-template-columns:1.3fr 1fr;gap:24px;margin-bottom:28px}
.billing-card{background:#fff;border-radius:16px;border:1px solid var(--border);padding:28px;position:relative;overflow:hidden}
.billing-card.current{background:linear-gradient(135deg,#0f172a 0%,#1e3a8a 100%);color:#fff;border-color:transparent}
.billing-card.current::after{content:'';position:absolute;inset:-2px;border-radius:18px;padding:2px;background:linear-gradient(135deg,#38bdf8,#a78bfa,#f472b6);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;pointer-events:none}
.billing-plan-name{font-size:13px;opacity:.7;margin-bottom:6px;font-weight:500;text-transform:uppercase;letter-spacing:.5px}
.billing-plan-title{font-size:30px;font-weight:800;margin-bottom:16px;letter-spacing:-.3px}
.billing-status-pill{display:inline-flex;align-items:center;gap:6px;padding:4px 12px;border-radius:999px;background:rgba(74,222,128,0.15);color:#4ade80;font-size:12px;font-weight:600;margin-bottom:18px}
.billing-status-pill::before{content:'';width:6px;height:6px;border-radius:50%;background:#4ade80}
.billing-status-pill.expired{background:rgba(239,68,68,0.15);color:#f87171}
.billing-status-pill.expired::before{background:#f87171}
.billing-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-bottom:20px}
.billing-meta .lbl{font-size:11px;opacity:.6;margin-bottom:3px;text-transform:uppercase;letter-spacing:.5px}
.billing-meta .val{font-size:15px;font-weight:600}
.billing-quota-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.quota-item{padding:14px;background:rgba(255,255,255,0.05);border-radius:10px;border:1px solid rgba(255,255,255,0.08)}
.quota-item.white{background:#f8fafc;border:1px solid var(--border)}
.quota-item .q-top{display:flex;justify-content:space-between;font-size:12px;margin-bottom:8px}
.quota-item .q-top .q-lbl{color:inherit;opacity:.75}
.quota-item.white .q-top .q-lbl{color:var(--text-2);opacity:1}
.quota-item .q-top .q-val{font-weight:700}
.progress{height:8px;background:rgba(255,255,255,0.1);border-radius:999px;overflow:hidden}
.quota-item.white .progress{background:#e2e8f0}
.progress > div{height:100%;background:linear-gradient(90deg,#38bdf8,#4ade80);border-radius:999px;transition:width .3s}
.progress.warn > div{background:linear-gradient(90deg,#f59e0b,#ef4444)}

.plans-grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:18px;margin-bottom:28px}
.plan-picker{background:#fff;border-radius:14px;border:1.5px solid var(--border);padding:22px 18px;cursor:pointer;transition:all .2s;position:relative}
.plan-picker:hover{transform:translateY(-2px);box-shadow:0 14px 28px rgba(15,23,42,0.08)}
.plan-picker.selected{border-color:var(--primary);background:#eff6ff;box-shadow:0 0 0 3px rgba(37,99,235,0.15)}
.plan-picker.hot{border-color:transparent;background:linear-gradient(145deg,#0f172a,#1e3a8a);color:#fff}
.plan-picker.hot::after{content:'热门';position:absolute;top:-10px;left:50%;transform:translateX(-50%);padding:3px 12px;border-radius:999px;background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;font-size:11px;font-weight:700}
.period-switch{display:inline-flex;background:#f1f5f9;border-radius:10px;padding:3px;margin-bottom:18px}
.period-switch button{padding:7px 16px;border:none;background:transparent;border-radius:8px;color:var(--text-2);font-size:13px;font-weight:500;cursor:pointer}
.period-switch button.on{background:#fff;color:var(--primary);box-shadow:0 2px 6px rgba(0,0,0,0.06);font-weight:600}
.plan-picker .pn{font-size:13px;color:var(--text-2);font-weight:500;margin-bottom:6px}
.plan-picker.hot .pn{color:#94a3b8}
.plan-picker .pp{font-size:26px;font-weight:800;letter-spacing:-.5px;margin-bottom:3px}
.plan-picker .pp .unit{font-size:12px;font-weight:500;opacity:.6}
.plan-picker .features{margin-top:14px}
.plan-picker .features li{font-size:12.5px;padding:5px 0;list-style:none;color:var(--text-2)}
.plan-picker.hot .features li{color:#cbd5e1}
.plan-picker .features li::before{content:'✓ ';color:#10b981;font-weight:700}
.btn-cta{width:100%;padding:12px;margin-top:18px;border-radius:10px;border:none;background:var(--primary);color:#fff;font-weight:600;font-size:14px;cursor:pointer;transition:all .15s}
.btn-cta:hover{filter:brightness(1.08);transform:translateY(-1px)}
.plan-picker.hot .btn-cta{background:#fff;color:#0f172a}

.expand-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}
.expand-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:22px}
.expand-card h4{font-size:15px;margin-bottom:14px}
.expand-item{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px dashed var(--border)}
.expand-item:last-child{border:none}
.expand-item .info .n{font-weight:600;font-size:13px}
.expand-item .info .d{font-size:12px;color:var(--text-2);margin-top:2px}
.expand-item .price{font-weight:700;color:var(--primary)}

.records-table{background:#fff;border-radius:14px;border:1px solid var(--border);overflow:hidden}
.rt-head{padding:18px 22px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
.rt-head h4{font-size:15px}
.table-body table{width:100%;border-collapse:collapse}
.table-body th{padding:12px 22px;background:#f8fafc;font-size:12px;color:var(--text-2);font-weight:600;text-align:left;text-transform:uppercase;letter-spacing:.5px}
.table-body td{padding:14px 22px;font-size:13px;border-top:1px solid var(--border);color:var(--text-1)}
.badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:600}
.badge.pending{background:#fff7ed;color:#c2410c}
.badge.paid{background:#ecfdf5;color:#047857}
.badge.reject{background:#fef2f2;color:#b91c1c}
.badge.active{background:#ecfdf5;color:#047857}
.badge.expire{background:#fef2f2;color:#b91c1c}

@media (max-width:1024px){
  .billing-hero{grid-template-columns:1fr}
  .plans-grid-4{grid-template-columns:repeat(2,1fr)}
  .expand-grid{grid-template-columns:1fr}
}
'''
# 插入到 .notif-btn 样式块之后
m_notif = re.search(r'(\.notif-btn:hover\{border-color:var\(--primary\);color:var\(--primary\)\}\s*\.notif-btn svg\{width:18px;height:18px;display:block\})', text)
if m_notif:
    text = text[:m_notif.end(1)] + '\n' + BILLING_CSS + '\n' + text[m_notif.end(1):]
    print("✅ CSS注入成功")
else:
    print("❌ CSS 注入点未找到")

# ========== 2. 改造 user-box 顶栏HTML ==========
OLD_TOPBAR_USER = r'''          <span class="user-name" id="user-name"></span>
          <button class="btn-ghost" onclick="logout()">退出登录</button>'''

NEW_TOPBAR_USER = r'''          <span class="user-name" id="user-name"></span>
          <div class="avatar-wrap">
            <div class="user-avatar" id="user-avatar" onclick="toggleAvatarMenu(event)" title="账户菜单">U</div>
            <div class="avatar-menu" id="avatar-menu" onclick="event.stopPropagation()">
              <a onclick="go('settings');closeAvatarMenu()">个人设置</a>
              <a id="am-billing" class="only-owner" onclick="go('billing');closeAvatarMenu()">套餐订阅</a>
              <a onclick="go('settings');document.getElementById(\'pw-old\')&&document.getElementById(\'pw-old\').focus();closeAvatarMenu()">修改密码</a>
              <a onclick="toggleNotif();closeAvatarMenu()">消息通知</a>
              <a onclick="logout()">退出登录</a>
            </div>
          </div>'''

if OLD_TOPBAR_USER in text:
    text = text.replace(OLD_TOPBAR_USER, NEW_TOPBAR_USER)
    print("✅ 顶栏user-box改造成功（头像下拉5项）")
else:
    print("❌ 顶栏 user-box 未匹配到")

# ========== 3. VIEW_TITLES 增加 billing ==========
old_view = "const VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', quota:'套餐配额', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置' };"
new_view = "const VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', billing:'套餐订阅', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置' };"
if old_view in text:
    text = text.replace(old_view, new_view)
    print("✅ VIEW_TITLES 增加 billing")
else:
    print("⚠️ VIEW_TITLES 精确匹配失败，尝试正则替换")
    text = re.sub(r"quota:'套餐配额',\s*'saas-admin'", "billing:'套餐订阅', 'saas-admin'", text)

# ========== 4. 路由loaders 增加 billing ==========
old_loaders = "const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, quota: loadQuota, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings };"
new_loaders = "const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, billing: loadBilling, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings };"
if old_loaders in text:
    text = text.replace(old_loaders, new_loaders)
    print("✅ 路由 loaders 增加 billing: loadBilling")
else:
    print("⚠️ loaders 精确匹配失败，正则替换")
    text = re.sub(r"scheduler:\s*loadScheduler,\s*quota:\s*loadQuota,", "scheduler: loadScheduler, billing: loadBilling,", text)

# ========== 5. 侧边栏删除"套餐配额"（禁止放侧边栏，只放头像下拉） ==========
old_side_quota = '''<a class="nav-item sub badge-new" data-view="quota" href="#/quota" onclick="go('quota')">套餐配额<em>NEW</em></a>
'''
if old_side_quota in text:
    text = text.replace(old_side_quota, '')
    print("✅ 侧边栏移除套餐配额入口（已移到头像下拉）")
else:
    print("⚠️ 侧边栏配额未精确匹配，尝试正则")
    text = re.sub(r'<a[^>]*data-view="quota"[^>]*>.*?</a>\s*', '', text, flags=re.DOTALL)

# ========== 6. 注入 avatar 菜单逻辑 + loadBilling 页面函数 ==========
# 找 logout 函数前的注入点（function logout上方）
BILLING_JS = r'''
/* ================= 头像下拉菜单（固定5项·V2终版） ================= */
function toggleAvatarMenu(e){ if(e) e.stopPropagation(); document.getElementById('avatar-menu').classList.toggle('show'); }
function closeAvatarMenu(){ document.getElementById('avatar-menu').classList.remove('show'); }
document.addEventListener('click', closeAvatarMenu);

function renderAvatar(){
  // 主账号才显示"套餐订阅"，子账号隐藏；超级管理员租户视图也隐藏
  const isOwner = me && me.role === 'owner';
  const isSaasAdm = (window.__saasMode === true);
  const el = document.getElementById('am-billing');
  if (el) el.style.display = (isOwner && !isSaasAdm) ? '' : 'none';
  // 头像首字母
  const av = document.getElementById('user-avatar');
  const nm = document.getElementById('user-name');
  if (av && me) {
    const ch = (me.username || me.phone || 'U').charAt(0).toUpperCase();
    av.textContent = ch;
  }
  if (nm && me) nm.textContent = me.username || me.phone;
  // 套餐到期时，到期联动弹窗引导续费（仅主账号）
  if (tenant && tenant.expired && isOwner && !sessionStorage.getItem('__billing_tip_seen')) {
    sessionStorage.setItem('__billing_tip_seen', '1');
    showModal('套餐已到期', `
      <div style="padding:10px 0">
        <div style="padding:14px;background:#fef2f2;color:#b91c1c;border-radius:10px;margin-bottom:16px;font-weight:600">
          ⚠️ 您的「${tenant.planName||'套餐'}」已到期，新增订单、商品、店铺等功能已冻结。
        </div>
        <p style="color:var(--text-2);font-size:14px;line-height:1.7">续费后立即恢复所有功能，并延续已购买的扩容包额度。</p>
      </div>
    `, [
      {label:'稍后再说', cls:'neutral', cb: closeModal},
      {label:'立即续费', cls:'primary', cb: () => { closeModal(); go('billing'); }}
    ]);
  }
}

/* ================= Billing 套餐订阅页（V2完整版） ================= */
const PLAN_CATALOG = {
  basic:      { name:'基础版',   tag:'入门首选', prices:{month:199,quarter:529,year:1980},
                quotas:{shops:3, monthlyOrders:500, products:2000, aiCalls:100, storageMB:1024},
                features:['3个店铺接入','每月500单处理','2000个商品SKU','100次AI调用/月','1GB素材存储空间','订单/商品/库存/财务基础功能','工作日工单支持'] },
  standard:   { name:'标准版',   tag:'热门推荐', prices:{month:599,quarter:1599,year:5980}, hot:true,
                quotas:{shops:10, monthlyOrders:5000, products:10000, aiCalls:2000, storageMB:10240},
                features:['10个店铺接入','每月5000单处理','10000个商品SKU','2000次AI调用/月','10GB素材存储','自动审单规则自定义','多仓+批次序列号','利润看板+月度结算','汇率30天趋势','工作日1v1客服'] },
  pro:        { name:'专业版',   tag:'专业卖家', prices:{month:1599,quarter:4299,year:15980},
                quotas:{shops:30, monthlyOrders:30000, products:999999, aiCalls:10000, storageMB:102400},
                features:['30个店铺接入','每月30000单/不限商品','每月10000次AI调用','100GB素材存储','AI销量预测/风险检测','7x12小时客服响应','高级运营后台API','定制物流对接','SLA 99.9%保障'] },
  enterprise: { name:'企业版',   tag:'品牌旗舰', prices:{month:4999,quarter:13499,year:47980},
                quotas:{shops:100, monthlyOrders:200000, products:999999, aiCalls:50000, storageMB:524288},
                features:['100个店铺接入','每月20万单/不限商品','50000次AI调用/月','512GB+专属存储','专属实施顾问1对1','定制化功能开发','私有化部署可选','SLA 99.95%','7x24专属运维支持'] }
};
const EXPAND_PACKS = [
  {key:'shop',   name:'店铺扩容包', unit:'每店铺/月', price:49, desc:'每包增加1个店铺接入额度'},
  {key:'order',  name:'订单扩容包', unit:'每1000单/月', price:29, desc:'每包增加1000单/月处理额度'},
  {key:'ai',     name:'AI调用扩容包', unit:'每1000次/月', price:59, desc:'每包增加1000次AI智能调用'},
  {key:'space',  name:'存储扩容包', unit:'每10GB/月', price:39, desc:'每包增加10GB素材存储空间'},
  {key:'user',   name:'子账号扩容包', unit:'每账号/月', price:29, desc:'每包增加1个子账号席位'},
];
let __billing = { curPlan:'standard', period:'month', selectedPlan:null };

async function loadBilling(){
  if (me && me.role !== 'owner') {
    document.getElementById('content').innerHTML = `
      <div style="padding:60px 20px;text-align:center;color:var(--text-2)">
        <div style="font-size:50px;margin-bottom:16px">🔒</div>
        <h3 style="margin-bottom:10px;color:var(--text-1)">无权限访问</h3>
        <p>套餐订阅仅主账号可见，请联系主账号查看或续费。</p>
      </div>`;
    return;
  }
  let sub = null, quotas = null, records = [];
  try { sub = await api('/billing/subscription'); } catch(e) {}
  try { quotas = await api('/billing/quotas/usage'); } catch(e) {}
  try { records = (await api('/billing/records')).items || []; } catch(e) {}
  const planCode = (sub && sub.planCode) || (tenant && tenant.plan) || 'standard';
  const plan = PLAN_CATALOG[planCode] || PLAN_CATALOG.standard;
  const isExpired = sub ? sub.status === 'expired' : (tenant && tenant.expired);
  const expDate = sub ? sub.expiresAt : (tenant && tenant.expire_at);
  __billing.curPlan = planCode;

  // 当前套餐卡片
  const used = quotas || { shopsUsed:0, ordersUsed:0, productsUsed:0, aiUsed:0, storageUsed:0, shops:plan.quotas.shops, orders:plan.quotas.monthlyOrders, products:plan.quotas.products, ai:plan.quotas.aiCalls, storage:plan.quotas.storageMB };
  function pct(u, t){ if (!t || t >= 999999) return 0; return Math.min(100, Math.round(Number(u||0)/t*100)); }
  const qItem = (lbl,u,t,klass='') => {
    const p = pct(u,t); const w = p>=85?'warn':''; const display = t>=999999?'不限':`${u} / ${t.toLocaleString()}`;
    return `<div class="quota-item ${klass}"><div class="q-top"><span class="q-lbl">${lbl}</span><span class="q-val">${display}</span></div><div class="progress ${w}"><div style="width:${p}%"></div></div></div>`;
  };

  const html = `
    <div class="billing-hero">
      <div class="billing-card current">
        <div class="billing-plan-name">当前订阅</div>
        <div class="billing-plan-title">${plan.name}</div>
        <div class="billing-status-pill ${isExpired?'expired':''}">${isExpired?'已到期':'服务中 · 正常使用'}</div>
        <div class="billing-meta">
          <div><div class="lbl">开通时间</div><div class="val">${fmtDate(sub?sub.startedAt:tenant&&tenant.created_at)}</div></div>
          <div><div class="lbl">到期时间</div><div class="val">${fmtDate(expDate)}</div></div>
          <div><div class="lbl">计费周期</div><div class="val">${(sub&&sub.period)?({month:'按月',quarter:'按季',year:'按年'}[sub.period]||'按月'):'按月'}</div></div>
          <div><div class="lbl">扩容包</div><div class="val">${sub?(sub.extraShops||0)+'店铺 / '+(sub.extraAiCalls||0)+' AI次':'未购买'}</div></div>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn-primary" style="padding:11px 22px" onclick="__billScrollTo('plans')">立即续费 / 升级</button>
          <button class="btn-ghost" style="padding:11px 22px" onclick="__billScrollTo('records')">续费记录</button>
        </div>
      </div>
      <div class="billing-card">
        <h3 style="font-size:16px;margin-bottom:18px">用量概览（${plan.name}额度）</h3>
        <div class="billing-quota-grid">
          ${qItem('店铺接入', used.shopsUsed||0, used.shops||0, 'white')}
          ${qItem('月度订单', used.ordersUsed||0, used.orders||0, 'white')}
          ${qItem('商品SKU', used.productsUsed||0, used.products||0, 'white')}
          ${qItem('AI调用', used.aiUsed||0, used.ai||0, 'white')}
        </div>
      </div>
    </div>

    <div id="plans">
      <h3 style="font-size:20px;margin:8px 0 12px">选购套餐 / 续费升级</h3>
      <div class="period-switch">
        <button class="${__billing.period==='month'?'on':''}" onclick="__billPeriod('month')">按月付费</button>
        <button class="${__billing.period==='quarter'?'on':''}" onclick="__billPeriod('quarter')">按季付费 <span style="color:#10b981;font-size:11px">省11%</span></button>
        <button class="${__billing.period==='year'?'on':''}" onclick="__billPeriod('year')">按年付费 <span style="color:#10b981;font-size:11px">省17%</span></button>
      </div>
      <div class="plans-grid-4" id="plan-picker"></div>
    </div>

    <div id="expand">
      <h3 style="font-size:20px;margin:8px 0 16px">扩容包购买</h3>
      <div class="expand-grid">
        ${EXPAND_PACKS.map(p=>`
          <div class="expand-card">
            <h4>${p.name}</h4>
            <div style="font-size:12px;color:var(--text-2);margin-bottom:14px">${p.desc}</div>
            <div class="expand-item">
              <div class="info"><div class="n">1 份 / ${p.unit}</div><div class="d">${p.desc}</div></div>
              <div class="price">+¥${p.price}</div>
            </div>
            <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
              <input type="number" min="0" value="0" id="exp-qty-${p.key}" style="width:70px;padding:7px;border-radius:8px;border:1px solid var(--border);text-align:center">
              <button class="btn-primary" style="flex:1;padding:8px" onclick="__billBuyExpand('${p.key}',${p.price},'${p.name}')">购买</button>
            </div>
          </div>`).join('')}
      </div>
    </div>

    <div id="records">
      <div class="records-table">
        <div class="rt-head"><h4>续费 / 购买 记录</h4><span style="color:var(--text-2);font-size:12px">共 ${records.length} 条</span></div>
        <div class="table-body">
          <table>
            <thead><tr><th>时间</th><th>类型</th><th>套餐/内容</th><th>周期</th><th>金额</th><th>状态</th><th>操作</th></tr></thead>
            <tbody>
              ${(records.length?records:[]).map(r=>`
                <tr>
                  <td>${fmtDate(r.createdAt||r.created_at)}</td>
                  <td><span class="badge ${r.action==='subscribe'||r.action==='renew'?'paid':'pending'}">${({subscribe:'新购',renew:'续费',expand:'扩容',adjust:'调整'})[r.action]||r.action||'—'}</span></td>
                  <td>${PLAN_CATALOG[r.planCode]?PLAN_CATALOG[r.planCode].name:r.note||'—'}</td>
                  <td>${({month:'月',quarter:'季',year:'年'})[r.period]||r.period||'—'}</td>
                  <td style="font-weight:700">¥${Number(r.amount||0).toFixed(2)}</td>
                  <td><span class="badge active">成功</span></td>
                  <td><a class="link-like" onclick="showModal('凭证详情', '<div style=\\'padding:10px 0;color:#666;font-size:13px\\'>订单号：<b>${r.orderId||'—'}</b><br>操作员：<b>${r.operator||'系统'}</b><br>备注：${esc(r.note||'无')}</div>')">详情</a></td>
                </tr>`).join('') || `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--text-2)">暂无续费记录，选购套餐或扩容包后将在这里显示。</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
  document.getElementById('content').innerHTML = html;
  __billRenderPlans();
}
function __billPeriod(p){ __billing.period = p; loadBilling(); }
function __billRenderPlans(){
  const wrap = document.getElementById('plan-picker');
  if(!wrap) return;
  const period = __billing.period;
  wrap.innerHTML = Object.entries(PLAN_CATALOG).map(([code,pl])=>{
    const price = pl.prices[period];
    const isCur = code === __billing.curPlan;
    const months = period==='month'?1:period==='quarter'?3:12;
    return `
      <div class="plan-picker ${pl.hot?'hot':''} ${isCur?'selected':''}" onclick="__billPickPlan('${code}')">
        <div class="pn">${pl.tag}</div>
        <div class="pp">¥${price}<span class="unit">/${period==='month'?'月':period==='quarter'?'季':'年'}</span></div>
        <div style="font-size:12px;color:var(--text-2);margin-top:-2px;opacity:.7">约 ¥${(price/months).toFixed(0)}/月</div>
        <ul class="features">
          ${pl.features.slice(0,5).map(f=>`<li>${f}</li>`).join('')}
        </ul>
        <button class="btn-cta" onclick="event.stopPropagation();__billCheckout('${code}')">${isCur?'立即续费':'选择'}</button>
      </div>`;
  }).join('');
}
function __billPickPlan(c){ __billing.selectedPlan = c; document.querySelectorAll('.plan-picker').forEach((el,i)=>{ el.classList.toggle('selected', Object.keys(PLAN_CATALOG)[i]===c || Object.keys(PLAN_CATALOG)[i]===__billing.curPlan&&!__billing.selectedPlan); }); }
function __billScrollTo(id){ const el=document.getElementById(id); if(el) el.scrollIntoView({behavior:'smooth',block:'start'}); }
function __billCheckout(code){
  const plan = PLAN_CATALOG[code]; const period = __billing.period;
  const price = plan.prices[period];
  const months = period==='month'?1:period==='quarter'?3:12;
  showModal('确认支付订单', `
    <div style="padding:6px 0">
      <div style="padding:16px;background:#f8fafc;border-radius:10px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:var(--text-2)">套餐</span><b>${plan.name} · ${({month:'月付',quarter:'季付',year:'年付'})[period]}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="color:var(--text-2)">开通时长</span><b>${months} 个月</b></div>
        <div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:8px;border-top:1px dashed var(--border);font-size:16px"><span>应付总金额</span><b style="color:var(--primary);font-size:18px">¥${price.toFixed(2)}</b></div>
      </div>
      <div style="padding:14px;background:#ecfdf5;color:#047857;border-radius:10px;font-size:13px;line-height:1.7">
        💡 <b>支付说明：</b>提交后将生成订单，请在 24 小时内联系专属顾问转账或上传支付凭证到下方，财务审核通过后自动开通，订单秒级生效。
      </div>
      <div style="margin-top:16px">
        <label style="font-size:13px;font-weight:600;display:block;margin-bottom:8px">支付凭证（图片URL，可选，后续支持直接上传）</label>
        <input type="text" id="pay-proof" class="input" placeholder="选填：支付凭证图片链接" style="width:100%;padding:10px;border-radius:8px;border:1px solid var(--border)">
      </div>
    </div>
  `, [
    {label:'取消', cls:'neutral', cb:closeModal},
    {label:'提交订单 ¥'+price.toFixed(2), cls:'primary', cb: async () => {
      const proof = document.getElementById('pay-proof').value.trim();
      try {
        const r = await api('/billing/orders', 'POST', { planCode:code, period, payProof:proof, payMethod:'bank' });
        toast('订单已提交，审核通过后立即开通 🎉', 'ok');
        closeModal(); loadBilling();
      } catch(e){ toast(e.message||'提交失败','err'); }
    }}
  ]);
}
function __billBuyExpand(key, price, name){
  const qty = parseInt(document.getElementById('exp-qty-'+key).value || 0);
  if(qty <= 0) return toast('请输入购买数量', 'warn');
  const total = price * qty;
  showModal('购买扩容包', `
    <div style="padding:10px 0">
      <div style="padding:14px;background:#f8fafc;border-radius:10px">
        <div style="display:flex;justify-content:space-between;padding:5px 0"><span style="color:var(--text-2)">扩容包</span><b>${name}</b></div>
        <div style="display:flex;justify-content:space-between;padding:5px 0"><span style="color:var(--text-2)">数量</span><b>${qty} 份</b></div>
        <div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:8px;border-top:1px dashed var(--border)"><span>合计</span><b style="color:var(--primary);font-size:18px">¥${total.toFixed(2)}</b></div>
      </div>
    </div>
  `, [
    {label:'取消', cls:'neutral', cb:closeModal},
    {label:'确认支付 ¥'+total.toFixed(2), cls:'primary', cb:async () => {
      try {
        await api('/billing/orders', 'POST', { orderType:'expand', planCode:key, period:'month', amount:total, extra:{packKey:key, qty}, payMethod:'bank' });
        toast('扩容包订单提交成功，审核后开通 📦', 'ok'); closeModal(); loadBilling();
      } catch(e){ toast(e.message||'提交失败','err'); }
    }}
  ]);
}
'''

# 注入到 loadSettings 函数前
m_settings = re.search(r'(/\* ================= 账户设置 ================= \*/\nasync function loadSettings)', text)
if m_settings:
    text = text[:m_settings.start(1)] + BILLING_JS + '\n' + text[m_settings.start(1):]
    print("✅ JS注入成功（头像下拉逻辑 + loadBilling页面）")
else:
    print("❌ JS注入点未找到")

# ========== 7. 在登录/渲染时调用 renderAvatar() ==========
# 在 renderPlanBox 调用之后（初始化阶段），加上 renderAvatar()
text = text.replace('renderPlanBox();', 'renderPlanBox(); renderAvatar();')

# 检查修改是否生效
if len(text) == original_len:
    print("❌ 所有替换都没生效！"); exit(1)

HTML.write_text(text, encoding='utf-8')
print(f"\n✅ 写入成功，原{original_len}字符，新{len(text)}字符")
print("\n🎉 P5 改造内容：")
print("  · 头像下拉菜单（5项固定）：个人设置/套餐订阅/修改密码/消息通知/退出登录")
print("  · 套餐订阅仅主账号可见，子账号+管理员隐藏")
print("  · #/billing 页面：当前套餐卡片+用量进度条+月季年切换4套餐+扩容包5种+续费记录+支付弹窗")
print("  · 套餐到期弹窗联动续费引导")
print("  · 侧边栏套餐配额已移除，仅头像下拉可见")
