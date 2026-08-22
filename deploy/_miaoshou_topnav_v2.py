#!/usr/bin/env python3
"""
妙手风格顶部双行导航 - V2（逐段精修，避免整块替换失败）
N1~N3 全部完成后可直接部署。
"""
PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

def _assert(cond, msg):
    if not cond:
        raise AssertionError(msg)

# ============================================================
# 1. CSS：逐段变量/选择器替换
# ============================================================
# 1a. 变量：移除 --sidebar-w，新增 --tabs-h，改高度紧凑
old_vars = ":root{--topnav-h:60px;--sidebar-w:252px;--subnav-h:48px}"
new_vars = ":root{--topnav-h:54px;--tabs-h:44px;--subnav-h:46px}"
_assert(old_vars in html, "VARS NOT FOUND")
html = html.replace(old_vars, new_vars)

# 1b. #app-view background
old_appview = "#app-view{display:none;min-height:100vh;flex-direction:column}"
new_appview = "#app-view{display:none;min-height:100vh;flex-direction:column;background:var(--bg)}"
_assert(old_appview in html, "APP-VIEW NOT FOUND")
html = html.replace(old_appview, new_appview)

# 1c. .topnav 紧凑高度 + 缩小间距
old_topnav = ".topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 18px;gap:18px;flex:none}"
new_topnav = ".topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 18px;gap:14px;flex:none}"
_assert(old_topnav in html, "TOPNAV NOT FOUND")
html = html.replace(old_topnav, new_topnav)

# 1d. brand 加一条分隔线、mark 变小
old_brand = ".topnav .brand{display:flex;align-items:center;gap:8px;flex:none}\n.topnav .brand .mark{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:14px}\n.topnav .brand .name{font-weight:800;font-size:15.5px;letter-spacing:.3px;color:var(--text-1)}"
new_brand = ".topnav .brand{display:flex;align-items:center;gap:8px;flex:none;padding-right:12px;border-right:1px solid var(--border)}\n.topnav .brand .mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}\n.topnav .brand .name{font-weight:800;font-size:15px;letter-spacing:.3px;color:var(--text-1)}"
_assert(old_brand in html, "BRAND NOT FOUND")
html = html.replace(old_brand, new_brand)

# 1e. topnav-groups 溢出滚动去掉、overflow hidden 留底
old_tg = ".topnav-groups{display:flex;align-items:center;gap:2px;flex:1;overflow-x:auto;min-width:0;scrollbar-width:none}\n.topnav-groups::-webkit-scrollbar{display:none}"
new_tg = ".topnav-groups{display:flex;align-items:center;gap:4px;flex:1;overflow:hidden;min-width:0}"
_assert(old_tg in html, "TOPNAV-GROUPS NOT FOUND")
html = html.replace(old_tg, new_tg)

# 1f. nav-group 位置：从 relative → static（去掉原浮层定位，我们用 tabs 平铺）
old_ng = ".nav-group{position:relative}"
new_ng = ".nav-group{position:static}"
_assert(old_ng in html, "NAV-GROUP POS NOT FOUND")
html = html.replace(old_ng, new_ng)

# 1g. nav-group-title 改为紧凑胶囊样式（原来有下拉箭头，我们改成干净的 active 填充色，无箭头）
old_grouptitle = ".nav-group-title{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;font-size:13.5px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s}\n.nav-group-title:hover{background:var(--primary-light);color:var(--primary)}\n.nav-group-title svg{width:16px;height:16px;flex:none;opacity:.9}\n.nav-group-title::after{content:'▾';font-size:10px;margin-left:2px;opacity:.6}\n.nav-group-title.on{background:var(--primary-light);color:var(--primary)}"
new_grouptitle = ".nav-group-title{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:7px;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s;border:1px solid transparent}\n.nav-group-title:hover{background:#f1f5f9;color:var(--text-1)}\n.nav-group-title svg{width:14px;height:14px;flex:none}\n.nav-group-title::after{content:''}\n.topnav-groups .nav-group-title.on{background:var(--primary);color:#fff;border-color:var(--primary)}\n.topnav-groups .nav-group-title.on svg{color:#fff}"
_assert(old_grouptitle in html, "NAV-GROUP-TITLE NOT FOUND")
html = html.replace(old_grouptitle, new_grouptitle)

# 1h. 顶部 Tab + Sidebar 下拉箭头/浮层注释整块 → 替换为：顶部无下拉、Sidebar 整体 display:none（已不需要）
old_comment_sb = "/* 顶部 Tab：无下拉箭头、不显示浮层菜单（菜单改放左侧 Sidebar 展开） */\n.topnav-groups .nav-group-title::after{content:''!important}\n.topnav-groups .nav-group-menu{display:none!important}\n/* 左侧 Sidebar：分组菜单始终展开（手风琴常显），无浮层 */\n.sidebar .nav-group{margin-bottom:4px}\n.sidebar .nav-group-title{padding:7px 10px;font-size:12px;color:var(--text-3);font-weight:700;cursor:default;letter-spacing:.2px}\n.sidebar .nav-group-title::after{content:''}\n.sidebar .nav-group-title svg{width:14px;height:14px;color:var(--primary)}\n.sidebar .nav-group-menu{display:flex!important;position:static!important;flex-direction:column;min-width:0!important;background:transparent!important;border:none!important;box-shadow:none!important;padding:2px 0 6px 0!important;margin:0!important;gap:1px;animation:none!important}\n.sidebar .nav-group-menu .nav-item{padding:7px 10px 7px 34px;border-radius:7px;font-size:13px;color:var(--text-2)}\n.sidebar .nav-group-menu .nav-item svg{width:14px;height:14px}\n.sidebar .nav-group-menu .nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}\n.sidebar .nav-group-menu .nav-item.badge-new em{margin-left:6px}"
new_comment_sb = "/* 顶部 Tab：纯分组胶囊；无下拉；二级菜单平铺在 subnav-tabs 行 */\n.topnav-groups .nav-group-title::after{content:''!important}\n.topnav-groups .nav-group-menu{display:none!important}\n.nav-group-menu{display:none!important}"
_assert(old_comment_sb in html, "SIDEBAR COMMENT NOT FOUND")
html = html.replace(old_comment_sb, new_comment_sb)

# 1i. nav-group-menu 浮层样式 + nav-item 样式：修改 nav-item 为 inline-flex 紧凑、tab 感
old_gm = "/* 下拉子菜单浮层（保留供其他区域使用，sidebar 覆盖） */\n.nav-group-menu{position:absolute;left:0;top:calc(100% + 6px);min-width:230px;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 18px 48px rgba(15,23,42,.14);z-index:9999;padding:10px;display:none;flex-direction:column;animation:avatarFadeIn .12s ease-out}\n.nav-group.open .nav-group-menu{display:flex}\n.nav-item{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:9px;color:var(--text-2);font-weight:500;text-decoration:none;font-size:13.5px;transition:all .1s;white-space:nowrap;line-height:1.3}\n.nav-item:hover{background:var(--primary-light);color:var(--primary)}\n.nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:600}\n.nav-item svg{width:16px;height:16px;flex:none;color:var(--text-2)}\n.nav-item:hover svg{color:var(--primary)}\n.nav-item.on svg{color:var(--primary)}\n.nav-item.badge-new{display:flex;align-items:center;justify-content:space-between;padding-right:12px}\n.nav-item.badge-new em{font-style:normal;font-size:10px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:2px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2;margin-left:8px}"
new_gm = """.nav-group-menu{display:none!important}
.nav-item{display:inline-flex;align-items:center;gap:7px;padding:7px 12px;border-radius:6px;color:var(--text-2);font-weight:500;text-decoration:none;font-size:13px;transition:all .1s;white-space:nowrap;line-height:1.3;border:1px solid transparent}
.nav-item:hover{background:#f1f5f9;color:var(--text-1)}
.nav-item.on{background:#fff;color:var(--primary);font-weight:600;border-color:#e0e7ff}
.nav-item svg{width:14px;height:14px;flex:none;color:inherit;opacity:.9}
.nav-item.badge-new{display:inline-flex;align-items:center;gap:6px;padding-right:12px}
.nav-item.badge-new em{font-style:normal;font-size:9.5px;font-weight:800;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;padding:1.5px 6px;border-radius:999px;letter-spacing:.3px;line-height:1.2}"""
_assert(old_gm in html, "NAV-GROUP-MENU / NAV-ITEM 未找到")
html = html.replace(old_gm, new_gm)

# 1j. topnav-right / plan-mini 紧凑
old_tnr = ".topnav-right{display:flex;align-items:center;gap:12px;margin-left:auto}"
new_tnr = ".topnav-right{display:flex;align-items:center;gap:10px;margin-left:auto;flex:none}"
_assert(old_tnr in html, "TOPNAV-RIGHT NOT FOUND")
html = html.replace(old_tnr, new_tnr)

old_planmini = """.plan-mini{display:inline-flex;flex-direction:column;padding:3px 10px;border-left:1px solid var(--border);gap:0;line-height:1.25;flex:none}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:12px}
.plan-mini .p-exp{font-size:11px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}"""
new_planmini = """.plan-mini{display:inline-flex;flex-direction:column;padding:3px 10px;border-left:1px solid var(--border);gap:0;line-height:1.2;flex:none}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:11.5px}
.plan-mini .p-exp{font-size:10.5px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}"""
_assert(old_planmini in html, "PLAN-MINI NOT FOUND")
html = html.replace(old_planmini, new_planmini)

# 1k. subnav：透明背景 + 紧凑
old_subnav = ".subnav{background:#fff;border-bottom:1px solid var(--border);height:var(--subnav-h);display:flex;align-items:center;padding:0 20px;flex:none}\n.subnav .page-title{font-size:16.5px;font-weight:700;margin-right:auto;color:var(--text-1)}"
new_subnav = ".subnav-tabs{background:#fff;border-bottom:1px solid var(--border);height:var(--tabs-h);display:flex;align-items:center;padding:0 18px;gap:2px;overflow-x:auto;scrollbar-width:none;flex:none}\n.subnav-tabs::-webkit-scrollbar{display:none}\n.subnav{background:transparent;border:none;height:var(--subnav-h);display:flex;align-items:center;padding:0 22px;flex:none}\n.subnav .page-title{font-size:15.5px;font-weight:700;margin-right:auto;color:var(--text-1)}"
_assert(old_subnav in html, "SUBNAV NOT FOUND")
html = html.replace(old_subnav, new_subnav)

# 1l. Sidebar + app-body：彻底 display:none！
old_sb_css = "/* 左侧完整 Sidebar + app-body 双栏布局（ERP 经典，菜单永不消失） */\n.sidebar{display:flex!important;flex-direction:column;width:var(--sidebar-w);flex:0 0 var(--sidebar-w);background:#fff;border-right:1px solid var(--border);padding:14px 10px;gap:2px;overflow-y:auto;min-height:calc(100vh - var(--topnav-h));max-height:calc(100vh - var(--topnav-h));position:sticky;top:var(--topnav-h)}\n.app-body{display:flex;flex:1;min-height:0}\n.app-main-col{display:flex;flex-direction:column;flex:1;min-width:0}"
new_sb_css = "/* 旧双栏：彻底隐藏不留占位 */\n.sidebar, .app-body, .app-main-col{display:none!important}\n.main{flex:1;display:flex;flex-direction:column;min-width:0;padding:0 0 40px 0}"
_assert(old_sb_css in html, "SIDEBAR/APP-BODY CSS 没找到")
html = html.replace(old_sb_css, new_sb_css)

# 1m. .subnav .user-box & .content padding 适配
old_subnavuser = ".subnav .user-box{display:flex;align-items:center;gap:12px}\n.subnav .user-name{color:var(--text-2);font-size:13px}\n.content{padding:22px;flex:1;width:100%;box-sizing:border-box}"
new_subnavuser = ".subnav .user-box{display:flex;align-items:center;gap:10px}\n.subnav .user-name{color:var(--text-2);font-size:12.5px}\n.content{padding:0 22px 0 22px;flex:1;width:100%;box-sizing:border-box;max-width:1600px;margin:0 auto}"
_assert(old_subnavuser in html, "SUBNAV USER / CONTENT 未找到")
html = html.replace(old_subnavuser, new_subnavuser)

# 1n. 原来的 113 行 .main 重复了 → 删掉（因为我们在 1l 中已经写了新的）
# 1n. 若存在两份未合并的 .main{}，最后由 CSS 级联兜底；此处不再手工裁剪，避免匹配位置偏差

# ============================================================
# 2. HTML：去掉 app-body + sidebar + app-main-col 三层，插入 subnav-tabs 行
# ============================================================
old_appbody_start = """    </div>
    <div class="app-body">
      <aside class="sidebar" id="sidebar">"""
_assert(old_appbody_start in html, "APP-BODY START HTML NOT FOUND")
html = html.replace(old_appbody_start, """    </div>
    <!-- 第二行：当前分组二级菜单 Tab（全部平铺，无浮层下拉） -->
    <div class="subnav-tabs" id="subnav-tabs"></div>""")

# 找 sidebar 结束后 app-main-col 的那个 div 组
old_wrap = """      </aside>
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
new_wrap = """    <!-- 第三行：页面标题条 -->
    <div class="subnav">
      <div class="page-title" id="page-title">概览</div>
    </div>
    <div class="main">
      <div class="content" id="content"></div>
    </div>
  </div>
</div>"""
_assert(old_wrap in html, "APP-MAIN-COL WRAP NOT FOUND")
html = html.replace(old_wrap, new_wrap)

# ============================================================
# 3. JS：注入分组定义 + 重写分组/二级联动逻辑
# ============================================================
GROUP_DEFS_JS = r"""
/* 妙手风格：分组 → 平铺二级菜单（数量少，干净） */
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
            {view:'exchange-rates', label:'多币种汇率', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>', badge:'NEW'},
            {view:'finance-report', label:'经营报表',   svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>'} ] },
  { key:'settings', label:'设置',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>',
    items:[ {view:'audit-logs', label:'审计日志', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>'},
            {view:'settings',   label:'账户设置', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'} ] },
  { key:'saas',     label:'运营',   iconSvg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/></svg>',
    items:[ {view:'saas-admin', label:'SaaS运营后台', svg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>', badge:'NEW'} ],
    hidden: true }
];
const VIEW_TO_GROUP = (function(){
  var m = {};
  ERP_GROUPS.forEach(function(g){ g.items.forEach(function(it){ m[it.view] = g.key; }); });
  m['product/new']  = 'products';
  m['product/edit'] = 'products';
  return m;
})();
"""
anchor_titles = "function toast(msg, type) {"
toast_pos = html.find(anchor_titles)
_assert(toast_pos > 0, "toast() 未找到")
html = html[:toast_pos] + GROUP_DEFS_JS + "\n" + html[toast_pos:]

# 3b. enterApp 尾部替换：渲染分组 + 一次 refresh（anchor 换成更稳的 "通知中心初始化 + 每 30s 轮询" 前）
old_tail = """  // 顶栏分组高亮：根据当前 view 找到对应所属分组
  highlightNavGroup();
  renderPlanBox();
  // 套餐到期检测：到期弹窗引导续费
  if (tenant && tenant.expired) {
    setTimeout(() => showExpiredModal(), 600);
  }
  // 通知中心初始化 + 每 30s 轮询"""
new_tail = """  // 渲染顶栏分组（妙手风格）：按权限过滤
  var groupsWrap = document.getElementById('topnav-groups');
  if (groupsWrap) {
    var visibleGroups = ERP_GROUPS.filter(function(g){
      if (g.key === 'saas') return !!(me && me.role === 'super_admin');
      return !g.hidden;
    });
    groupsWrap.innerHTML = visibleGroups.map(function(g){
      return '<div class="nav-group" data-group="'+g.key+'"><div class="nav-group-title" data-groupkey="'+g.key+'" onclick="pickGroup(\\''+g.key+'\\')">'+g.iconSvg+g.label+'</div></div>';
    }).join('');
  }
  // 角色视图：非 owner 隐藏财务中心（顶栏分组里），viewer 额外隐藏写操作入口（由 view 层控制）
  if (!(me && me.role === 'owner')) {
    var finBtns = document.querySelectorAll('.topnav-groups .nav-group-title[data-groupkey="finance"]');
    finBtns.forEach(function(b){ if (b && b.parentNode) b.parentNode.style.display = 'none'; });
  }
  refreshTabsAndHighlight();
  renderPlanBox();
  // 套餐到期检测：到期弹窗引导续费
  if (tenant && tenant.expired) {
    setTimeout(() => showExpiredModal(), 600);
  }
  // 通知中心初始化 + 每 30s 轮询"""
_assert(old_tail in html, "enterApp tail (highlightNavGroup + renderPlanBox) 未找到")
html = html.replace(old_tail, new_tail)

# 3c. 删除旧 SaaS sidebar 行，避免 warning
old_saas_line2 = "  document.getElementById('nav-saas-admin').style.display = (me && me.role === 'super_admin') ? '' : 'none';\n  // 左侧 Sidebar 的 SaaS 运营后台：同步权限控制（仅 super_admin）\n  var sbSaas = document.getElementById('nav-saas-sidebar');\n  if (sbSaas) sbSaas.style.display = (me && me.role === 'super_admin') ? '' : 'none';"
if old_saas_line2 in html:
    html = html.replace(old_saas_line2, "  // SaaS 入口：由 ERP_GROUPS.hidden + enterApp filter 动态渲染（非超管不渲染）")

# 3d. 定位旧 highlightNavGroup 块（可能在 go 之后的页面底部附近）→ 整段替换为新逻辑 pickGroup + refreshTabsAndHighlight
hln_func_start = html.find("function highlightNavGroup() {")
_assert(hln_func_start > 0, "highlightNavGroup() 函数开头未找到")
# highlightNavGroup 后面紧跟：navGroupGo + click listener + bindTopnavGroups IIFE，直到 "头像下拉菜单逻辑" 前
avatar_comment = "/* ===== 头像下拉菜单逻辑 ===== */"
avatar_pos = html.find(avatar_comment)
_assert(avatar_pos > hln_func_start, "找不到" + avatar_comment)

NEW_NAV_FUNC = """/* ===== 妙手风格：顶部双行导航逻辑 ===== */
function pickGroup(groupKey, opts) {
  var g = ERP_GROUPS.find(function(x){ return x.key === groupKey; });
  if (!g) return;
  if (g.key === 'saas' && !(me && me.role === 'super_admin')) return;
  var first = g.items[0];
  if (first && (!opts || !opts.stay)) go(first.view);
}
function refreshTabsAndHighlight() {
  var raw = String(location.hash || '').replace('#/', '').split('?')[0];
  var view = raw;
  if (raw.startsWith('product/edit/') || raw === 'product/new') view = 'product/edit';
  var groupKey = VIEW_TO_GROUP[view] || VIEW_TO_GROUP[raw] || 'dashboard';
  if (!VIEW_TO_GROUP[view] && ERP_GROUPS.find(function(g){ return g.key === view; })) groupKey = view;
  document.querySelectorAll('.topnav-groups .nav-group-title').forEach(function(btn){
    btn.classList.toggle('on', btn.getAttribute('data-groupkey') === groupKey);
  });
  var tabs = document.getElementById('subnav-tabs');
  var g = ERP_GROUPS.find(function(x){ return x.key === groupKey; });
  if (tabs) {
    if (!g || !g.items || !g.items.length) { tabs.innerHTML = ''; tabs.style.display='none'; }
    else {
      tabs.style.display = '';
      tabs.innerHTML = g.items.map(function(it){
        var on = (it.view === raw);
        var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
        return '<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>';
      }).join('');
    }
  }
}
"""
html = html[:hln_func_start] + NEW_NAV_FUNC + "\n" + html[avatar_pos:]

# 3e. go 函数中所有 highlightNavGroup() 调用 → refreshTabsAndHighlight()
if "highlightNavGroup();" in html:
    html = html.replace("highlightNavGroup();", "refreshTabsAndHighlight();")

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[OK] 妙手风格顶部双行导航完成（逐段精修）")
