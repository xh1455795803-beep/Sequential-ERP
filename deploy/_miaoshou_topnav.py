#!/usr/bin/env python3
"""
N1~N4 一步到位：妙手风格【干净顶部双行导航】
  行1（topnav）：Logo | 分组胶囊（少量，店铺/商品/订单/供应链/财务/设置）| 通知 | 头像
  行2（subnav-tabs）：选中分组的二级菜单 Tab 全部平铺（无浮层）
  → 完全没有左侧栏（aside.sidebar 彻底移除）
  → 没有下拉浮层 / mega-menu / 动画那些"有的没的"
  → 保留 B2~B5
"""
PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()
orig = html

# ============================================================
# 1. 变量 & 布局 CSS 整块替换（从 :root 到 .subnav .user-name）
# ============================================================
OLD_CSS_LAYOUT_START = "/* ===== 主布局：顶部横向导航 ===== */"
OLD_CSS_LAYOUT_END_MARKER = ".content{padding:24px;flex:1;max-width:1280px;width:100%;margin:0 auto}"

NEW_CSS_LAYOUT = """/* ===== 主布局：妙手风格 · 顶部双行导航（无左侧栏） ===== */
:root{--topnav-h:54px;--tabs-h:44px;--subnav-h:46px}
#app-view{display:none;min-height:100vh;flex-direction:column;background:var(--bg)}
.layout{display:flex;flex-direction:column;min-height:100vh}
/* 第一行：Logo + 分组胶囊 + 头像/通知 */
.topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 18px;gap:14px;flex:none}
.topnav .brand{display:flex;align-items:center;gap:8px;flex:none;padding-right:12px;border-right:1px solid var(--border)}
.topnav .brand .mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}
.topnav .brand .name{font-weight:800;font-size:15px;letter-spacing:.3px;color:var(--text-1)}
/* 分组胶囊（第一行导航）：数量少、间距小，绝对不溢出 */
.topnav-groups{display:flex;align-items:center;gap:4px;flex:1;overflow:hidden;min-width:0}
.topnav-groups .nav-group{position:static}
.topnav-groups .nav-group-title{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:7px;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s;border:1px solid transparent}
.topnav-groups .nav-group-title:hover{background:#f1f5f9;color:var(--text-1)}
.topnav-groups .nav-group-title svg{width:14px;height:14px;flex:none}
.topnav-groups .nav-group-title::after{content:''}
.topnav-groups .nav-group-title.on{background:var(--primary);color:#fff;border-color:var(--primary)}
.topnav-groups .nav-group-title.on svg{color:#fff}
/* 顶部分组下拉：彻底关掉不用，二级改到行2平铺 */
.topnav-groups .nav-group-menu{display:none!important}
/* 导航通用：去掉之前 sidebar 继承的下拉浮层样式（重写） */
.nav-group{position:static}
.nav-group-menu{display:none!important}
.nav-item{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:6px;color:var(--text-2);font-weight:500;text-decoration:none;font-size:13px;transition:all .1s;white-space:nowrap;line-height:1.3;border:1px solid transparent}
.nav-item:hover{background:#f1f5f9;color:var(--text-1)}
.nav-item.on{background:#fff;color:var(--primary);font-weight:600;border-color:#e0e7ff}
.nav-item svg{width:14px;height:14px;flex:none;color:inherit;opacity:.9}
.nav-item.badge-new{display:inline-flex;align-items:center;gap:6px;padding-right:12px}
.nav-item.badge-new em{font-style:normal;font-size:9.5px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:1.5px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2}
.topnav-right{display:flex;align-items:center;gap:10px;margin-left:auto;flex:none}
.plan-mini{display:inline-flex;flex-direction:column;padding:3px 10px;border-left:1px solid var(--border);gap:0;line-height:1.2;flex:none}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:11.5px}
.plan-mini .p-exp{font-size:10.5px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}
/* 第二行：当前分组下的二级菜单 Tab（全部平铺，无下拉） */
.subnav-tabs{background:#fff;border-bottom:1px solid var(--border);height:var(--tabs-h);display:flex;align-items:center;padding:0 18px;gap:2px;overflow-x:auto;scrollbar-width:none;flex:none}
.subnav-tabs::-webkit-scrollbar{display:none}
/* 第三行：面包屑页面标题条（短条） */
.subnav{background:transparent;border:none;height:var(--subnav-h);display:flex;align-items:center;padding:0 22px;flex:none}
.subnav .page-title{font-size:15.5px;font-weight:700;margin-right:auto;color:var(--text-1)}
/* 旧侧边栏：彻底删除不保留 */
.sidebar, .app-body, .app-main-col{display:none!important}
/* 主区单列 */
.main{flex:1;display:flex;flex-direction:column;min-width:0;padding:0 0 40px 0}
.subnav .user-box{display:flex;align-items:center;gap:10px}
.subnav .user-name{color:var(--text-2);font-size:12.5px}
.content{padding:0 22px 0 22px;flex:1;width:100%;box-sizing:border-box;max-width:1600px;margin:0 auto}
/* 平台授权卡片 / 表格样式保留原状不改动 */"""

# 精确定位起止
start = html.find(OLD_CSS_LAYOUT_START)
end = html.find(OLD_CSS_LAYOUT_END_MARKER) + len(OLD_CSS_LAYOUT_END_MARKER)
assert start > 0 and end > start, "CSS 布局块定位失败"
html = html[:start] + NEW_CSS_LAYOUT + html[end:]

# ============================================================
# 2. HTML：彻底移除 <div class="app-body">...<aside>...</aside>...<div class="app-main-col">，
#    改为：</div><!-- topnav 结束 --> <div class="subnav-tabs"><!-- 二级平铺 --></div> <div class="subnav"><!-- 标题 --></div> <div class="main">...
# ============================================================
# 先找 topnav 结束 </div> 的位置
OLD_HTML_A = """    </div>
    <div class="app-body">
      <aside class="sidebar" id="sidebar">"""
assert OLD_HTML_A in html, "HTML app-body/aside 起点没找到"

# subnav-tabs 的初始内容会在 enterApp / go 里动态渲染，这里先放一个占位
SUBNAV_TABS_HTML = """    </div>
    <!-- 第二行：当前分组的二级菜单 Tab（全部平铺展示，无浮层下拉） -->
    <div class="subnav-tabs" id="subnav-tabs"></div>"""

html = html.replace(OLD_HTML_A, SUBNAV_TABS_HTML)

# 再找 app-main-col 包裹的结尾，去掉 app-main-col wrapper 和 </div></div> 多余闭合
OLD_APP_WRAP = """      <aside class="sidebar" id="sidebar">"""
# 不需要单独处理 aside（已经在上面的替换中删了前半），现在处理 app-main-col 的 div
old_wrap_b = """      <div class="app-main-col">
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

new_wrap_b = """    <!-- 第三行：页面标题 -->
    <div class="subnav">
      <div class="page-title" id="page-title">概览</div>
    </div>
    <div class="main">
      <div class="content" id="content"></div>
    </div>
  </div>
</div>"""
assert old_wrap_b in html, "app-main-col 的闭合包裹没找到：可能已经被改过"
html = html.replace(old_wrap_b, new_wrap_b)

# ============================================================
# 3. JS：重写分组切换（顶部分组点击 → 渲染 subnav-tabs 二级平铺 → 默认跳转首项）
#    保留：B2（无scheduler）/ B3（汇率在财务）/ B4（轮询）/ B5（独立页）
# ============================================================
# 3a. 定义 分组 → 二级菜单项 映射（B2~B3 在此保证）
GROUP_DEFS_JS = r"""
/* 妙手风格：分组 → 平铺二级菜单定义（少而全，无多余） */
const ERP_GROUPS = [
  { key:'dashboard', label:'概览',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/></svg>',
    items:[ {view:'dashboard',     label:'总览概览', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/></svg>'} ] },
  { key:'shops',    label:'店铺',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/></svg>',
    items:[ {view:'shops',     label:'店铺授权', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1-5h16l1 5"/></svg>'},
            {view:'platforms', label:'平台接入', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>'} ] },
  { key:'products', label:'商品',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4"/></svg>',
    items:[ {view:'products',         label:'商品管理',     svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7L12 3 4 7l8 4 8-4z"/></svg>'},
            {view:'products-v2',      label:'商品V2',       svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/></svg>', badge:'NEW'},
            {view:'inventory',        label:'库存管理',     svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4"/></svg>'},
            {view:'inventory-ledger', label:'库存流水',     svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'} ] },
  { key:'orders',   label:'订单',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/></svg>',
    items:[ {view:'orders',       label:'订单管理',     svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/></svg>'},
            {view:'auto-audit',   label:'自动审单',     svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 12l2 2 4-4"/></svg>', badge:'NEW'},
            {view:'aftersales',   label:'售后',         svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/></svg>', badge:'NEW'},
            {view:'shipments',    label:'发货',          svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="15" height="13" rx="1"/></svg>'} ] },
  { key:'supply',   label:'供应链', iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7l-8-4-8 4v10l8 4 8-4V7z"/></svg>',
    items:[ {view:'purchases',  label:'采购单', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/></svg>'},
            {view:'suppliers',  label:'供应商',  svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'},
            {view:'carriers',   label:'物流商',  svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/></svg>'} ] },
  { key:'finance',  label:'财务',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/></svg>',
    items:[ {view:'finance',        label:'订单利润',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/></svg>'},
            {view:'finance-v2',     label:'利润看板',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/></svg>', badge:'NEW'},
            {view:'exchange-rates', label:'多币种汇率', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>', badge:'NEW'},  // B3 ✅ 汇率在财务分组
            {view:'finance-report', label:'经营报表',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'} ] },
  { key:'settings', label:'设置',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>',
    items:[ {view:'audit-logs', label:'审计日志', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'},
            {view:'settings',   label:'账户设置', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'} ] },
  // SaaS 运营：隐藏分组，仅超管渲染到顶栏分组和二级
  { key:'saas',     label:'运营',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>',
    items:[ {view:'saas-admin', label:'SaaS运营后台', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>', badge:'NEW'} ],
    hidden: true }
];
/* view → group key 映射（用于路由变化时自动选中正确分组与正确二级） */
const VIEW_TO_GROUP = (function(){
  var m = {};
  ERP_GROUPS.forEach(function(g){ g.items.forEach(function(it){ m[it.view] = g.key; }); });
  // 动态路由：product/edit/:id / product/new → 归 products 分组
  m['product/new']  = 'products';
  m['product/edit'] = 'products';
  return m;
})();
"""

# 注入 ERP_GROUPS / VIEW_TO_GROUP：放在 VIEW_TITLES 之后
old_after_titles = "const VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'product/new':'新增商品', 'product/edit':'编辑商品', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置', billing:'套餐订阅' };\n\nfunction toast(msg, type) {"
assert old_after_titles in html, "VIEW_TITLES 行没找到"
new_after_titles = old_after_titles.replace("\n\nfunction toast(msg, type) {", GROUP_DEFS_JS + "\n\nfunction toast(msg, type) {")
html = html.replace(old_after_titles, new_after_titles)

# 3b. 替换 enterApp：顶部分组（根据权限）渲染 + subnav-tabs 初始化
# 先定位 enterApp 函数开头和末尾的一段做替换
old_enterapp_start_end = """async function enterApp() {
  // 显示 app-view，隐藏登录/注册页"""
# 找 enterApp 中 SaaS 权限显示 + highlightNavGroup 那一段的尾部，并追加渲染逻辑
# 我们用更稳的方式：在 enterApp 最后 `// 初始化通知` 之前，插入"渲染顶栏分组+subnav二级"代码
# 先找 enterApp 尾部比较稳的 anchor
old_enterapp_tail_anchor = """  // 初始化通知公告
  try { loadNotifications(); } catch(e) {}
  // 初始化当前 hash（登录成功统一会跳 dashboard，这里兜底）"""

new_enterapp_tail_anchor = """  // ===== 渲染顶栏分组（妙手风格）：根据当前权限筛掉 SaaS（非超管）=====
  var groupsWrap = document.getElementById('topnav-groups');
  if (groupsWrap) {
    var visibleGroups = ERP_GROUPS.filter(function(g){
      if (g.key === 'saas') return (me && me.role === 'super_admin');
      return !g.hidden;
    });
    groupsWrap.innerHTML = visibleGroups.map(function(g){
      return '<div class="nav-group" data-group="'+g.key+'"><div class="nav-group-title" data-groupkey="'+g.key+'" onclick="pickGroup(\\''+g.key+'\\')">'+g.iconSvg+g.label+'</div></div>';
    }).join('');
  }
  // 先按当前路由渲染一次二级 Tab + 高亮
  refreshTabsAndHighlight();
  // 初始化通知公告
  try { loadNotifications(); } catch(e) {}
  // 初始化当前 hash（登录成功统一会跳 dashboard，这里兜底）"""

assert old_enterapp_tail_anchor in html, "enterApp tail anchor 没找到"
html = html.replace(old_enterapp_tail_anchor, new_enterapp_tail_anchor)

# 3c. 新增三个 helper 函数 + 替换 highlightNavGroup 整段
# 先把旧的 highlightNavGroup / document.addEventListener('click') 整块替换掉
# 定位 anchor：找 "function highlightNavGroup()" 开头 到 "// 绑定顶部分组 title 的 onclick..." 末尾的 IIFE 之后
HIGHLIGHT_START = "function highlightNavGroup() {"
# 查找旧 highlightNavGroup 范围：找个 end anchor
HIGHLIGHT_END_AFTER = "})();\n\nlet token = localStorage.getItem('sx_token') || '';"
# 不，可能是另一个位置。我们换 anchor：找 go 函数之前的 highlightNavGroup 结束位置更安全。
# 直接用 "function go(view) {" 之前的全部内容替换（如果高亮函数在 go 前面）。

# 先用 search 找 "function go(view) {" 的位置
go_pos = html.find("function go(view) {")

# 再找 "function highlightNavGroup() {" 位置
hln_pos = html.find("function highlightNavGroup() {")
assert hln_pos > 0 and go_pos > hln_pos, "找不到 highlightNavGroup / go 函数位置"

# 现在替换 hln_pos 到 go_pos 之间（含 highlightNavGroup, addEventListener click, bindTopnavGroups IIFE）为新的逻辑块
NEW_NAV_LOGIC = """/* ===== 妙手风格：分组 + 二级 Tab 导航控制 ===== */
/* 点顶部分组胶囊 → 渲染二级 Tab 并跳该分组首项 */
function pickGroup(groupKey, opts) {
  var g = ERP_GROUPS.find(function(x){ return x.key === groupKey; });
  if (!g) return;
  // SaaS 权限：非超管直接屏蔽
  if (g.key === 'saas' && !(me && me.role === 'super_admin')) return;
  var first = g.items[0];
  if (first && (!opts || !opts.stay)) go(first.view);
}
/* 根据当前 view：(1) 高亮顶部分组 (2) 渲染该分组的二级 Tab (3) 高亮二级菜单项 */
function refreshTabsAndHighlight() {
  var raw = String(location.hash || '').replace('#/', '').split('?')[0];
  // 动态路由归并：product/edit → products
  var view = raw;
  if (raw.startsWith('product/edit/') || raw === 'product/new') view = 'product/edit';
  var groupKey = VIEW_TO_GROUP[view] || VIEW_TO_GROUP[raw] || 'dashboard';
  // 概览 特殊：raw === 'dashboard' 时直接用 dashboard
  if (!VIEW_TO_GROUP[view] && ERP_GROUPS.find(function(g){ return g.key === view; })) groupKey = view;
  // 1) 顶部胶囊高亮
  document.querySelectorAll('.topnav-groups .nav-group-title').forEach(function(btn){
    btn.classList.toggle('on', btn.getAttribute('data-groupkey') === groupKey);
  });
  // 2) subnav-tabs：平铺当前分组所有二级
  var tabs = document.getElementById('subnav-tabs');
  var g = ERP_GROUPS.find(function(x){ return x.key === groupKey; });
  if (tabs) {
    if (!g || !g.items || !g.items.length) { tabs.innerHTML = ''; tabs.style.display='none'; }
    else {
      tabs.style.display = '';
      tabs.innerHTML = g.items.map(function(it){
        // 显示：若当前 view 匹配该 item.view 高亮（动态路由 products 组里 view=product/edit 则匹配 products 等的首项不动）
        var on = (it.view === raw) || (it.view === view);
        // 兼容：product/edit 路由 → 商品管理 "商品管理" 单独不高亮也没关系，因为 VIEW_TITLES 显示"编辑商品"
        // 更准：匹配 raw 时才高亮（商品管理 view=products，当 raw=products 高亮）
        on = (it.view === raw);
        var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
        return '<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>';
      }).join('');
    }
  }
}
/* 点二级 Tab → 直接 go(view) 即可，refreshTabsAndHighlight 会在 go() 内被调用 */
"""
# 插入：删除旧 [hln_pos, go_pos)，再插入 NEW_NAV_LOGIC + "\n" + "function go(view) {"
assert html[go_pos:go_pos+18] == "function go(view) {"
html = html[:hln_pos] + NEW_NAV_LOGIC + "\n" + html[go_pos:]

# 3d. go 函数内部：原先调用过 highlightNavGroup() 的地方改为 refreshTabsAndHighlight()
# 搜索 "highlightNavGroup();" → 替换
if "highlightNavGroup();" in html:
    html = html.replace("highlightNavGroup();", "refreshTabsAndHighlight();")
if "highlightNavGroup()" in html:
    # 还有参数式
    html = html.replace("highlightNavGroup()", "refreshTabsAndHighlight()")

# 3e. enterApp 中对 SaaS 的显示（原先 nav-saas-admin / nav-saas-sidebar）：已经通过 ERP_GROUPS 控制，注释掉旧逻辑避免警告
old_saas_line2 = "  document.getElementById('nav-saas-admin').style.display = (me && me.role === 'super_admin') ? '' : 'none';\n  // 左侧 Sidebar 的 SaaS 运营后台：同步权限控制（仅 super_admin）\n  var sbSaas = document.getElementById('nav-saas-sidebar');\n  if (sbSaas) sbSaas.style.display = (me && me.role === 'super_admin') ? '' : 'none';"
if old_saas_line2 in html:
    html = html.replace(old_saas_line2, "  // SaaS 运营入口：由 ERP_GROUPS.hidden + enterApp 中 filter 动态渲染顶栏分组（非超管不渲染）")

# 3f. 删掉原来的 toggleNavGroup / navGroupGo / bindTopnavGroups 若存在（避免污染）
for fn_name in ["toggleNavGroup", "navGroupGo"]:
    # 不做复杂删除，只要没用到就安全；保留不影响
    pass

# ============================================================
# 4. 媒体查询 .sidebar{display:none} 的旧行 & 重复 .content 清除
# ============================================================
# 旧 @media 里的 sidebar 行保留（已无 sidebar，但不会冲突），不管

# 写回
if html != orig:
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(html)
    print("[OK] 妙手风格顶部双行导航：已完成")
else:
    print("[NOCHANGE]")
    import sys; sys.exit(1)
