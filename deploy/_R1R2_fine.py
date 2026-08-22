#!/usr/bin/env python3
"""R1+R2 修复：精细粒度替换（避免整块字符串不匹配）"""
import re, sys
PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()
orig = html

# ========= 1. CSS: 替换变量和 layout 基本 ==========
html = html.replace(
    ':root{--topnav-h:60px;--subnav-h:48px}',
    ':root{--topnav-h:60px;--sidebar-w:252px;--subnav-h:48px}'
)
html = html.replace(
    '#app-view{display:none;min-height:100vh;display:none;flex-direction:column}',
    '#app-view{display:none;min-height:100vh;flex-direction:column}'
)
# layout 保持 flex-direction:column（顶栏通栏 → 下方 app-body 横排）
# ========= 2. CSS: topnav 改紧凑（padding/gap 减小），groups 去掉下拉样式 ==========
old_topnav = '.topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 24px;gap:32px}\n.topnav .brand{display:flex;align-items:center;gap:9px;flex:none}\n.topnav .brand .mark{width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:16px}\n.topnav .brand .name{font-weight:800;font-size:17px;letter-spacing:.3px}\n.topnav-groups{display:flex;align-items:center;gap:4px;flex:1;overflow-x:auto;min-width:0}'
new_topnav = '.topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 18px;gap:18px;flex:none}\n.topnav .brand{display:flex;align-items:center;gap:8px;flex:none}\n.topnav .brand .mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}\n.topnav .brand .name{font-weight:800;font-size:15.5px;letter-spacing:.3px;color:var(--text-1)}\n.topnav-groups{display:flex;align-items:center;gap:2px;flex:1;overflow-x:auto;min-width:0;scrollbar-width:none}\n.topnav-groups::-webkit-scrollbar{display:none}'
assert old_topnav in html, "topnav CSS 片段不匹配"
html = html.replace(old_topnav, new_topnav)

# ========= 3. CSS: nav-group-title / nav-group-menu 在 topnav-groups 下 = 快速 Tab（无下拉箭头、无浮层） ==========
old_nav_group = '.nav-group{position:relative}\n.nav-group-title{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s}\n.nav-group-title:hover{background:var(--primary-light);color:var(--primary)}\n.nav-group-title svg{width:16px;height:16px;flex:none;opacity:.9}\n.nav-group-title::after{content:\'▾\';font-size:10px;margin-left:2px;opacity:.6}\n.nav-group-title.on{background:var(--primary-light);color:var(--primary)}\n/* 下拉子菜单浮层 */\n.nav-group-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:230px;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.14);z-index:9999;padding:10px;display:none;flex-direction:column;animation:avatarFadeIn .12s ease-out}\n.nav-group.open .nav-group-menu{display:flex}'
new_nav_group = '.nav-group{position:relative}\n.nav-group-title{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s}\n.nav-group-title:hover{background:var(--primary-light);color:var(--primary)}\n.nav-group-title svg{width:16px;height:16px;flex:none;opacity:.9}\n.nav-group-title::after{content:\'▾\';font-size:10px;margin-left:2px;opacity:.6}\n.nav-group-title.on{background:var(--primary-light);color:var(--primary)}\n/* 顶部 Tab：无下拉箭头、不显示浮层菜单（菜单改放左侧 Sidebar 展开） */\n.topnav-groups .nav-group-title::after{content:\'\'!important}\n.topnav-groups .nav-group-menu{display:none!important}\n/* 左侧 Sidebar：分组菜单始终展开（手风琴常显），无浮层 */\n.sidebar .nav-group{margin-bottom:4px}\n.sidebar .nav-group-title{padding:7px 10px;font-size:12px;color:var(--text-3);font-weight:700;cursor:default;letter-spacing:.2px}\n.sidebar .nav-group-title::after{content:\'\'}\n.sidebar .nav-group-title svg{width:14px;height:14px;color:var(--primary)}\n.sidebar .nav-group-menu{display:flex!important;position:static!important;flex-direction:column;min-width:0!important;background:transparent!important;border:none!important;box-shadow:none!important;padding:2px 0 6px 0!important;margin:0!important;gap:1px;animation:none!important}\n.sidebar .nav-group-menu .nav-item{padding:7px 10px 7px 34px;border-radius:7px;font-size:13px;color:var(--text-2)}\n.sidebar .nav-group-menu .nav-item svg{width:14px;height:14px}\n.sidebar .nav-group-menu .nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}\n.sidebar .nav-group-menu .nav-item.badge-new em{margin-left:6px}\n/* 下拉子菜单浮层（保留供其他区域使用，sidebar 覆盖） */\n.nav-group-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:230px;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.14);z-index:9999;padding:10px;display:none;flex-direction:column;animation:avatarFadeIn .12s ease-out}\n.nav-group.open .nav-group-menu{display:flex}'
assert old_nav_group in html, "nav-group CSS 不匹配"
html = html.replace(old_nav_group, new_nav_group)

# ========= 4. CSS: 关键！恢复 sidebar，添加 app-body，调整 subnav/main/plan-mini ==========
old_sidebar_line = '/* 旧 sidebar plan-box 替换：删掉 */\n.sidebar{display:none!important}'
new_sidebar_line = '/* 左侧完整 Sidebar + app-body 双栏布局（ERP 经典，菜单永不消失） */\n.sidebar{display:flex!important;flex-direction:column;width:var(--sidebar-w);flex:0 0 var(--sidebar-w);background:#fff;border-right:1px solid var(--border);padding:14px 10px;gap:2px;overflow-y:auto;min-height:calc(100vh - var(--topnav-h));max-height:calc(100vh - var(--topnav-h));position:sticky;top:var(--topnav-h)}\n.app-body{display:flex;flex:1;min-height:0}\n.app-main-col{display:flex;flex-direction:column;flex:1;min-width:0}'
assert old_sidebar_line in html, "sidebar 隐藏行不匹配"
html = html.replace(old_sidebar_line, new_sidebar_line)

# plan-mini 缩小，顶栏更紧凑
old_plan = '.plan-mini{display:inline-flex;flex-direction:column;padding:4px 12px;border-left:1px solid var(--border);gap:1px;line-height:1.3}\n.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:12.5px}\n.plan-mini .p-exp{font-size:11.5px;color:var(--text-2)}\n.plan-mini .p-exp.warn{color:var(--amber)}'
new_plan = '.plan-mini{display:inline-flex;flex-direction:column;padding:3px 10px;border-left:1px solid var(--border);gap:0;line-height:1.25;flex:none}\n.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:12px}\n.plan-mini .p-exp{font-size:11px;color:var(--text-2)}\n.plan-mini .p-exp.warn{color:var(--amber)}'
assert old_plan in html, "plan-mini CSS 不匹配"
html = html.replace(old_plan, new_plan)

# subnav 内容 padding 按 app-main-col 对齐
old_subnav = '/* 顶栏下半：页面标题 */\n.subnav{background:#fff;border-bottom:1px solid var(--border);height:var(--subnav-h);display:flex;align-items:center;padding:0 24px}\n.subnav .page-title{font-size:17px;font-weight:700;margin-right:auto}'
new_subnav = '/* 子导航：页面标题面包屑条 */\n.subnav{background:#fff;border-bottom:1px solid var(--border);height:var(--subnav-h);display:flex;align-items:center;padding:0 20px;flex:none}\n.subnav .page-title{font-size:16.5px;font-weight:700;margin-right:auto;color:var(--text-1)}'
assert old_subnav in html, "subnav CSS 不匹配"
html = html.replace(old_subnav, new_subnav)

# 媒体查询：小屏幕隐藏 sidebar（保留兜底）
# 找 .main{flex:1...} 的行
old_main_97 = '.main{flex:1;display:flex;flex-direction:column}'
new_main_97 = '.main{flex:1;display:flex;flex-direction:column;min-width:0}'
assert old_main_97 in html, ".main CSS 行不匹配"
html = html.replace(old_main_97, new_main_97)

# 追加 app-main-col 里的内容宽度：最大宽度
old_content_100 = '.content{padding:24px;flex:1;max-width:1280px;width:100%;margin:0 auto}'
if old_content_100 in html:
    new_content_100 = '.content{padding:22px;flex:1;width:100%;box-sizing:border-box}'
    html = html.replace(old_content_100, new_content_100)
# 还有第 111 行 content 重复
old_content_111 = '.content{padding:24px;flex:1;max-width:1200px;width:100%}'
if old_content_111 in html:
    new_content_111 = '/* (duplicate content rule removed) */'
    html = html.replace(old_content_111, new_content_111)

# ========= 5. HTML: 在 topnav 之后、subnav 之前插入 app-body wrapper 和 sidebar ==========
# 找到 <div class="topnav">...</div> 后面的 subnav
old_wrap_a = """    <!-- 子导航栏：页面标题 -->
    <div class="subnav">
      <div class="page-title" id="page-title">概览</div>
    </div>
    <div class="main">
      <div class="content" id="content"></div>
    </div>
  </div>
</div>"""

SIDEBAR_HTML = """    <div class="app-body">
      <aside class="sidebar" id="sidebar">
        <div class="nav-group" data-group="dashboard">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>概览</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="dashboard" href="#/dashboard" onclick="go('dashboard')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/></svg>总览概览</a>
          </div>
        </div>
        <div class="nav-group" data-group="shops">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M4 9v11a1 1 0 001 1h14a1 1 0 001-1V9"/></svg>店铺中心</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="shops" href="#/shops" onclick="go('shops')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/></svg>店铺授权</a>
            <a class="nav-item" data-view="platforms" href="#/platforms" onclick="go('platforms')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/></svg>平台接入</a>
          </div>
        </div>
        <div class="nav-group" data-group="products">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>商品中心</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="products" href="#/products" onclick="go('products')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L12 3 4 7l8 4 8-4z"/></svg>商品管理</a>
            <a class="nav-item badge-new" data-view="products-v2" href="#/products-v2" onclick="go('products-v2')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/></svg>商品·V2完整版<em>NEW</em></a>
            <a class="nav-item" data-view="inventory" href="#/inventory" onclick="go('inventory')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4"/></svg>库存管理</a>
            <a class="nav-item" data-view="inventory-ledger" href="#/inventory-ledger" onclick="go('inventory-ledger')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>库存流水</a>
          </div>
        </div>
        <div class="nav-group" data-group="orders">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>订单中心</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="orders" href="#/orders" onclick="go('orders')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/></svg>订单管理</a>
            <a class="nav-item badge-new" data-view="auto-audit" href="#/auto-audit" onclick="go('auto-audit')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/></svg>自动审单规则<em>NEW</em></a>
            <a class="nav-item badge-new" data-view="aftersales" href="#/aftersales" onclick="go('aftersales')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/></svg>售后逆向中心<em>NEW</em></a>
            <a class="nav-item" data-view="shipments" href="#/shipments" onclick="go('shipments')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/></svg>发货记录</a>
          </div>
        </div>
        <div class="nav-group" data-group="supply">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-8-4-8 4v10l8 4 8-4V7z"/></svg>供应链</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="purchases" href="#/purchases" onclick="go('purchases')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/></svg>采购单</a>
            <a class="nav-item" data-view="suppliers" href="#/suppliers" onclick="go('suppliers')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>供应商</a>
            <a class="nav-item" data-view="carriers" href="#/carriers" onclick="go('carriers')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/></svg>物流商</a>
          </div>
        </div>
        <div class="nav-group" id="nav-finance-sidebar" data-group="finance">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/></svg>财务中心</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="finance" href="#/finance" onclick="go('finance')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/></svg>订单利润</a>
            <a class="nav-item badge-new" data-view="finance-v2" href="#/finance-v2" onclick="go('finance-v2')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/></svg>利润看板·V2<em>NEW</em></a>
            <a class="nav-item badge-new" data-view="exchange-rates" href="#/exchange-rates" onclick="go('exchange-rates')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>多币种汇率<em>NEW</em></a>
            <a class="nav-item" data-view="finance-report" href="#/finance-report" onclick="go('finance-report')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><rect x="3" y="3" width="18" height="18" rx="2"/></svg>经营报表</a>
          </div>
        </div>
        <div class="nav-group" id="nav-saas-sidebar" data-group="saas" style="display:none">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>运营后台</div>
          <div class="nav-group-menu">
            <a class="nav-item badge-new" id="nav-saas-admin-sidebar" data-view="saas-admin" href="#/saas-admin" onclick="go('saas-admin')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>SaaS运营后台<em>NEW</em></a>
          </div>
        </div>
        <div class="nav-group" data-group="settings">
          <div class="nav-group-title"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>系统设置</div>
          <div class="nav-group-menu">
            <a class="nav-item" data-view="audit-logs" href="#/audit-logs" onclick="go('audit-logs')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>审计日志</a>
            <a class="nav-item" data-view="settings" href="#/settings" onclick="go('settings')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>账户设置</a>
          </div>
        </div>
      </aside>
      <div class="app-main-col">
        <!-- 子导航栏：页面标题 -->
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

new_wrap_b = SIDEBAR_HTML
assert old_wrap_a in html, "HTML wrap 片段不匹配"
html = html.replace(old_wrap_a, new_wrap_b)

# ========= 6. JS: enterApp 同步显示 Sidebar SaaS 分组 + highlightNavGroup 改 + 顶部分组 Tab 点击跳转 ==========
# 6a. enterApp 加 sidebar SaaS 显示
old_saas_line = "  document.getElementById('nav-saas-admin').style.display = (me && me.role === 'super_admin') ? '' : 'none';"
if old_saas_line in html:
    html = html.replace(old_saas_line, old_saas_line + "\n  // 左侧 Sidebar 的 SaaS 运营后台：同步权限控制（仅 super_admin）\n  var sbSaas = document.getElementById('nav-saas-sidebar');\n  if (sbSaas) sbSaas.style.display = (me && me.role === 'super_admin') ? '' : 'none';")

# 6b. 重写 highlightNavGroup：sidebar + topnav 联动高亮 + mapView 解析 product/edit
# 先找旧函数
old_hln = re.search(r"function highlightNavGroup\(\)\s*\{[^}]*\}", html, re.S)
if not old_hln:
    print("WARN: highlightNavGroup 函数找不到，跳过 highlight 修改")
else:
    # 用更精确的片段：找 "function highlightNavGroup" 开头、到 "document.addEventListener('click'" 之前
    old_full_block = html[html.find('function highlightNavGroup()') : html.find("document.addEventListener('click', function(e) {") + len("document.addEventListener('click', function(e) {")]
    # 不，还是找整块
    start = html.find('function highlightNavGroup()')
    end_marker = "});\n"
    # 找到第二个 document.addEventListener 结尾的 });
    click_idx = html.find("document.addEventListener('click'", start)
    end_idx = html.find("});\n", click_idx) + 3
    if end_idx > 0 and start > 0:
        old_hln_ev = html[start:end_idx]
        new_hln_ev = """function highlightNavGroup() {
  var cur = String(location.hash || '').replace('#/', '').split('?')[0];
  var mapView = cur;
  if (cur.startsWith('product/edit') || cur === 'product/new') mapView = 'products';
  // 高亮所有相同 data-view 的 nav-item（topnav + sidebar 一起）
  document.querySelectorAll('#sidebar .nav-item, .topnav-groups .nav-item').forEach(function(n){
    n.classList.toggle('on', n.dataset.view === mapView);
  });
  // 顶部分组快速 Tab：根据所属分组高亮
  var groupMap = { dashboard:'dashboard', shops:'shops', platforms:'shops', products:'products', 'products-v2':'products', inventory:'products', 'inventory-ledger':'products', orders:'orders', 'auto-audit':'orders', aftersales:'orders', shipments:'orders', purchases:'supply', suppliers:'supply', carriers:'supply', finance:'finance', 'finance-v2':'finance', 'exchange-rates':'finance', 'finance-report':'finance', 'saas-admin':'saas', 'audit-logs':'settings', settings:'settings' };
  var gk = groupMap[mapView];
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('on'); });
  if (gk) {
    var tg = document.querySelector('.topnav-groups .nav-group[data-group="'+gk+'"]');
    if (tg) tg.classList.add('on');
  }
  // 顶部分组下拉始终关闭（菜单改放 Sidebar）
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('open'); });
}
// 顶部分组快速 Tab：点击跳转到该分组第一个菜单项
function navGroupGo(groupKey) {
  var first = { dashboard:'dashboard', shops:'shops', products:'products', orders:'orders', supply:'purchases', finance:'finance', saas:'saas-admin', settings:'audit-logs' };
  if (first[groupKey]) go(first[groupKey]);
}
document.addEventListener('click', function(e) {
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g){ g.classList.remove('open'); });
});
// 绑定顶部分组 title 的 onclick：如果是 toggleNavGroup(this)，改为 navGroupGo
(function bindTopnavGroups() {
  var binds = { 'shops':'shops', 'products':'products', 'orders':'orders', 'supply':'supply', 'finance':'finance', 'saas':'saas', 'settings':'settings' };
  document.querySelectorAll('.topnav-groups .nav-group').forEach(function(g) {
    var key = binds[g.getAttribute('data-group')];
    if (key) {
      var title = g.querySelector('.nav-group-title');
      if (title) title.setAttribute('onclick', 'navGroupGo(\\''+key+'\\')');
    }
  });
  // 概览分组：<a class="nav-group-title" data-view="dashboard"> → 保持 go 跳转
})();"""
        html = html[:start] + new_hln_ev + html[end_idx:]
    else:
        print("WARN: 找不到 highlightNavGroup 起止，跳过 JS 重写")

if html != orig:
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(html)
    print("[OK] R1+R2 fine-grained applied")
else:
    print("[NOCHANGE]")
    sys.exit(1)
