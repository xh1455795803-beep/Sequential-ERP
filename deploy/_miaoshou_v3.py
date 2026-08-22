#!/usr/bin/env python3
"""
妙手 ERP 1:1 风格复刻（V3）
关键元素（截图实锤对比）：
  顶栏（1 行）：青蓝背景色 #23c1a0 + 白色分组文字（首页/产品/订单/客服/数据/采购/仓库/物流/财务/服务/授权）+ 右侧用户/消息/订购栏
  内容头部：搜索条（可选，ERP截图中央有「快速搜索功能」）
  二级/三级菜单：每个分组点进去，在内容区左上角浅灰"通用功能"卡片列表形式（不是再一行 tab）
"""
PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

def _a(c, m):
    if not c:
        raise AssertionError(m)

# ============================================================
# 1) 主色、主题、高度 CSS 变量 - 用妙手青蓝 #23c1a0 替换紫色 primary（两处 :root 都改）
# ============================================================
# 1a. 头一个 :root（登录+全局色板）
old_theme1 = """:root{
  --primary:#4f46e5;--primary-dark:#4338ca;--primary-light:#eef2ff;
  --bg:#f4f5f9;--card:#fff;--text:#1e293b;--text-2:#64748b;--text-3:#94a3b8;
  --border:#e2e8f0;--green:#059669;--green-bg:#ecfdf5;--red:#dc2626;--red-bg:#fef2f2;
  --amber:#d97706;--amber-bg:#fffbeb;--blue:#2563eb;--blue-bg:#eff6ff;--gray-bg:#f1f5f9;
  --radius:12px;--shadow:0 1px 3px rgba(16,24,40,.08);
}"""
new_theme1 = """:root{
  --primary:#23c1a0;--primary-dark:#1fae90;--primary-light:#e5faf5;
  --bg:#f5f7fa;--card:#fff;--text:#1f2937;--text-2:#4b5563;--text-3:#9ca3af;
  --border:#e5e7eb;--green:#059669;--green-bg:#ecfdf5;--red:#dc2626;--red-bg:#fef2f2;
  --amber:#d97706;--amber-bg:#fffbeb;--blue:#2563eb;--blue-bg:#eff6ff;--gray-bg:#f1f5f9;
  --radius:6px;--shadow:0 1px 2px rgba(16,24,40,.06);
}"""
_a(old_theme1 in html, "THEME1 (登录版) NOT FOUND")
html = html.replace(old_theme1, new_theme1)

# 1b. 第二个 :root（APP 内 topnav/subnav 变量）
old_theme2 = ":root{--topnav-h:54px;--tabs-h:44px;--subnav-h:46px}"
new_theme2 = ":root{--topnav-h:48px;--tabs-h:0px;--subnav-h:44px}"
_a(old_theme2 in html, "THEME2 (APP) NOT FOUND")
html = html.replace(old_theme2, new_theme2)

# ============================================================
# 2) 顶栏 1:1 妙手风格：青蓝背景 (#23c1a0) + 白色扁平分组 + 右侧用户/消息/订购
# ============================================================
old_topnav_css = ".topnav{position:sticky;top:0;z-index:50;background:#fff;border-bottom:1px solid var(--border);height:var(--topnav-h);display:flex;align-items:center;padding:0 18px;gap:14px;flex:none}"
new_topnav_css = ".topnav{position:sticky;top:0;z-index:50;background:#23c1a0;color:#fff;height:var(--topnav-h);display:flex;align-items:center;padding:0 14px;gap:0;flex:none;box-shadow:0 1px 2px rgba(0,0,0,.08)}"
_a(old_topnav_css in html, "TOPNAV CSS 未找到")
html = html.replace(old_topnav_css, new_topnav_css)

old_brand_css = ".topnav .brand{display:flex;align-items:center;gap:8px;flex:none;padding-right:12px;border-right:1px solid var(--border)}\n.topnav .brand .mark{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:13px}\n.topnav .brand .name{font-weight:800;font-size:15px;letter-spacing:.3px;color:var(--text-1)}"
new_brand_css = ".topnav .brand{display:flex;align-items:center;gap:8px;flex:none;padding:0 14px 0 6px}\n.topnav .brand .mark{width:26px;height:26px;border-radius:5px;background:#fff;color:#23c1a0;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12.5px}\n.topnav .brand .name{font-weight:800;font-size:15px;color:#fff;letter-spacing:.2px}"
_a(old_brand_css in html, "BRAND CSS 未找到")
html = html.replace(old_brand_css, new_brand_css)

# topnav-groups + nav-group-title 改成妙手风格：白底 active，hover 稍暗
old_tg = ".topnav-groups{display:flex;align-items:center;gap:4px;flex:1;overflow:hidden;min-width:0}"
new_tg = ".topnav-groups{display:flex;align-items:center;gap:0;flex:0 0 auto;overflow:hidden;min-width:0}"
_a(old_tg in html, "TOPNAV-GROUPS CSS 未找到")
html = html.replace(old_tg, new_tg)

old_ng = ".nav-group{position:static}"
_a(old_ng in html, ".nav-group not found")
html = html.replace(old_ng, ".nav-group{position:static}")

old_grouptitle = ".nav-group-title{display:inline-flex;align-items:center;gap:5px;padding:7px 13px;border-radius:7px;font-size:13px;font-weight:600;color:var(--text-2);cursor:pointer;white-space:nowrap;transition:all .12s;border:1px solid transparent}\n.nav-group-title:hover{background:#f1f5f9;color:var(--text-1)}\n.nav-group-title svg{width:14px;height:14px;flex:none}\n.nav-group-title::after{content:''}\n.topnav-groups .nav-group-title.on{background:var(--primary);color:#fff;border-color:var(--primary)}\n.topnav-groups .nav-group-title.on svg{color:#fff}"
new_grouptitle = ".nav-group-title{display:inline-flex;align-items:center;gap:4px;padding:0 14px;height:var(--topnav-h);font-size:13px;font-weight:600;color:rgba(255,255,255,.92);cursor:pointer;white-space:nowrap;transition:all .1s}\n.nav-group-title:hover{background:rgba(0,0,0,.08);color:#fff}\n.nav-group-title svg{width:13px;height:13px;flex:none;opacity:.9}\n.nav-group-title::after{content:''}\n.topnav-groups .nav-group-title.on{background:#fff;color:var(--primary);font-weight:700;border-radius:0}\n.topnav-groups .nav-group-title.on svg{color:var(--primary)}"
_a(old_grouptitle in html, "GROUP TITLE 未找到")
html = html.replace(old_grouptitle, new_grouptitle)

# old: /* 顶部 Tab：纯分组胶囊；无下拉；二级菜单平铺在 subnav-tabs 行 */ —— 新改为：顶部无二级；二级改内容区左侧浅灰小卡
old_tabrow_comment = """/* 顶部 Tab：纯分组胶囊；无下拉；二级菜单平铺在 subnav-tabs 行 */
.topnav-groups .nav-group-title::after{content:''!important}
.topnav-groups .nav-group-menu{display:none!important}
.nav-group-menu{display:none!important}"""
new_tabrow_comment = """/* 妙手风格：顶部只放大分组；二级菜单改在内容区左侧浅灰卡片 */
.topnav-groups .nav-group-title::after{content:''!important}
.topnav-groups .nav-group-menu{display:none!important}
.nav-group-menu{display:none!important}
/* 旧第二行平铺二级：隐藏不用（改为左侧浅灰卡） */
.subnav-tabs{display:none!important}"""
_a(old_tabrow_comment in html, "TABROW COMMENT 未找到")
html = html.replace(old_tabrow_comment, new_tabrow_comment)

# 顶部 右侧：plan-mini + 用户区（改白色系适配青蓝顶栏）
old_tnr = ".topnav-right{display:flex;align-items:center;gap:10px;margin-left:auto;flex:none}"
new_tnr = ".topnav-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex:none;color:rgba(255,255,255,.95)}"
_a(old_tnr in html, "TOPNAV-RIGHT 未找到")
html = html.replace(old_tnr, new_tnr)

old_planmini = """.plan-mini{display:inline-flex;flex-direction:column;padding:3px 10px;border-left:1px solid var(--border);gap:0;line-height:1.2;flex:none}
.plan-mini .p-name{font-weight:700;color:var(--primary);font-size:11.5px}
.plan-mini .p-exp{font-size:10.5px;color:var(--text-2)}
.plan-mini .p-exp.warn{color:var(--amber)}"""
new_planmini = """.plan-mini{display:inline-flex;flex-direction:column;padding:3px 12px;border-left:1px solid rgba(255,255,255,.22);gap:0;line-height:1.2;flex:none}
.plan-mini .p-name{font-weight:700;color:#fff;font-size:11.5px}
.plan-mini .p-exp{font-size:10.5px;color:rgba(255,255,255,.75)}
.plan-mini .p-exp.warn{color:#fff}"""
_a(old_planmini in html, "PLAN-MINI 未找到")
html = html.replace(old_planmini, new_planmini)

# 头像/通知按钮：改成白色适配
# 顶部右侧：notif-btn / avatar-btn / avatar-img 适配（青蓝顶栏，白底扁平）
old_notif = """.notif-btn{position:relative;padding:7px 10px;border-radius:8px;border:1px solid var(--border);background:#fff;color:var(--text-2);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.notif-btn:hover{border-color:var(--primary);color:var(--primary)}
.notif-btn svg{width:18px;height:18px;display:block}
.notif-dot{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;padding:0 4px;background:var(--red);color:#fff;border-radius:999px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:2px solid #fff;line-height:1}"""
new_notif = """.notif-btn{position:relative;padding:4px 7px;border-radius:4px;border:0;background:transparent;color:rgba(255,255,255,.92);cursor:pointer;display:inline-flex;align-items:center;justify-content:center}
.notif-btn:hover{background:rgba(0,0,0,.08);color:#fff}
.notif-btn svg{width:16px;height:16px;display:block}
.notif-dot{position:absolute;top:-2px;right:-2px;min-width:14px;height:14px;padding:0 4px;background:#ff4d4f;color:#fff;border-radius:999px;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;border:1px solid #23c1a0;line-height:1}"""
_a(old_notif in html, "NOTIF BTN 未找到")
html = html.replace(old_notif, new_notif)

old_avatarbtn = """.avatar-wrap{position:relative;display:inline-flex;align-items:center}
.avatar-btn{display:inline-flex;align-items:center;gap:8px;padding:5px 10px 5px 6px;border-radius:999px;border:1px solid var(--border);background:#fff;cursor:pointer;transition:all .15s}
.avatar-btn:hover{border-color:var(--primary);box-shadow:0 0 0 3px rgba(79,70,229,.08)}
.avatar-img,.avatar-big{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;color:#fff;font-weight:800;font-size:12.5px;background:var(--primary);letter-spacing:0;line-height:1;flex:none}
.avatar-big{width:40px;height:40px;font-size:16px}
.avatar-caret{width:14px;height:14px;color:var(--text-3)}"""
new_avatarbtn = """.avatar-wrap{position:relative;display:inline-flex;align-items:center}
.avatar-btn{display:inline-flex;align-items:center;gap:6px;padding:3px 9px 3px 3px;border-radius:3px;border:0;background:transparent;color:rgba(255,255,255,.95);cursor:pointer}
.avatar-btn:hover{background:rgba(0,0,0,.08);color:#fff}
.avatar-img,.avatar-big{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:3px;color:#23c1a0;font-weight:900;font-size:11.5px;background:#fff;letter-spacing:0;line-height:1;flex:none}
.avatar-big{width:40px;height:40px;font-size:16px;border-radius:6px;color:#fff;background:var(--primary)}
.avatar-caret{width:12px;height:12px;color:rgba(255,255,255,.85)}"""
_a(old_avatarbtn in html, "AVATAR BTN 未找到")
html = html.replace(old_avatarbtn, new_avatarbtn)

# ============================================================
# 3) Layout：.subnav 页面标题条改透明+大字；.main 区 grid: 左侧二级窄卡 (200px) + 右侧内容
# ============================================================
old_subnavgrid = """.subnav-tabs{background:#fff;border-bottom:1px solid var(--border);height:var(--tabs-h);display:flex;align-items:center;padding:0 18px;gap:2px;overflow-x:auto;scrollbar-width:none;flex:none}
.subnav-tabs::-webkit-scrollbar{display:none}
.subnav{background:transparent;border:none;height:var(--subnav-h);display:flex;align-items:center;padding:0 22px;flex:none}
.subnav .page-title{font-size:15.5px;font-weight:700;margin-right:auto;color:var(--text-1)}"""
new_subnavgrid = """.subnav{background:#fff;border-bottom:1px solid var(--border);height:44px;display:flex;align-items:center;padding:0 18px;flex:none}
.subnav .page-title{font-size:13.5px;font-weight:700;margin-right:auto;color:var(--text-1)}
/* 妙手风格：主区采用 左二级菜单卡(210px) + 右内容 */
.main{flex:1;display:grid;grid-template-columns:210px 1fr;gap:0;min-width:0;padding:12px;background:var(--bg)}
.side-submenu{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:10px 0;height:fit-content}
.side-submenu h4{margin:6px 12px 4px;padding:4px 0;font-size:11px;color:var(--text-3);font-weight:800;letter-spacing:.3px;text-transform:uppercase}
.side-submenu .nav-item{display:flex;width:calc(100% - 16px);margin:0 8px;border-radius:4px;padding:7px 10px;font-size:12.5px;line-height:1.35;border:0;color:var(--text-2);font-weight:500}
.side-submenu .nav-item:hover{background:var(--primary-light);color:var(--primary)}
.side-submenu .nav-item.on{background:var(--primary-light);color:var(--primary);font-weight:700}
.side-submenu .nav-item svg{width:13px;height:13px;flex:none}
.side-submenu .nav-item.badge-new em{font-size:9px;padding:1.2px 5px;margin-left:4px}
.content-wrap{background:#fff;border:1px solid var(--border);border-radius:var(--radius);padding:16px;min-width:0}
.content{padding:0;max-width:none;margin:0}"""
_a(old_subnavgrid in html, "SUBNAV+GRID 未找到")
html = html.replace(old_subnavgrid, new_subnavgrid)

# 旧 .main 定义（行 1l 中）覆盖
old_main_sb = "/* 旧双栏：彻底隐藏不留占位 */\n.sidebar, .app-body, .app-main-col{display:none!important}\n.main{flex:1;display:flex;flex-direction:column;min-width:0;padding:0 0 40px 0}"
new_main_sb = "/* 旧双栏：彻底隐藏不留占位 */\n.sidebar, .app-body, .app-main-col{display:none!important}"
# 若存在旧 sidebar/app-body/app-main-col 行，去掉（其 .main 定义已在上面 new_subnavgrid 写了新的 grid 版）
if old_main_sb in html:
    html = html.replace(old_main_sb, new_main_sb)
else:
    # 保险：找 7 字版
    old2 = ".sidebar, .app-body, .app-main-col{display:none!important}"
    _a(old2 in html, "旧 SIDEBAR NONE 行 未找到")
    # 它后面的 .main{...flex-direction...padding...} 也干掉，避免层叠
    pos = html.find(old2) + len(old2)
    # 向前看：若紧跟着 .main{...flex-direction:column;...} 就切
    tmp = html[pos:pos+150]
    import re
    m = re.match(r'\s*\.main\{[^}]*\}', tmp)
    if m:
        html = html[:pos] + html[pos + m.end():]

old_subnavuser = ".subnav .user-box{display:flex;align-items:center;gap:10px}\n.subnav .user-name{color:var(--text-2);font-size:12.5px}\n.content{padding:0 22px 0 22px;flex:1;width:100%;box-sizing:border-box;max-width:1600px;margin:0 auto}"
new_subnavuser = ".subnav .user-box{display:flex;align-items:center;gap:10px}\n.subnav .user-name{color:var(--text-2);font-size:12.5px}"
_a(old_subnavuser in html, "SUBNAV USER 未找到")
html = html.replace(old_subnavuser, new_subnavuser)

# ============================================================
# 4) HTML：.main 里改造成 side-submenu(左) + .content-wrap(右)，并删掉旧 subnav-tabs（display:none 已经保证了，保留占位也行）
# ============================================================
old_main_html = """    <div class="main">
      <div class="content" id="content"></div>
    </div>"""
new_main_html = """    <div class="main">
      <aside class="side-submenu" id="side-submenu"></aside>
      <div class="content-wrap">
        <div class="content" id="content"></div>
      </div>
    </div>"""
_a(old_main_html in html, "MAIN HTML 未找到")
html = html.replace(old_main_html, new_main_html)

# ============================================================
# 5) JS：refreshTabsAndHighlight → 改为妙手风格 refreshLeftSubmenu()
#    pickGroup → 跳分组首项不变
# ============================================================
# 5) JS：refreshTabsAndHighlight → 内部改为妙手风格（渲染 #side-submenu 左侧卡；同时兼容旧名不另起新函数）
old_refresh_func = """function refreshTabsAndHighlight() {
  var raw = String(location.hash || '').replace('#/', '').split('?')[0];
  var view = raw;
  var isDynamicProduct = false;
  if (raw.startsWith('product/edit/') || raw === 'product/new') { view = 'product/edit'; isDynamicProduct = true; }
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
        var on = (it.view === raw) || (isDynamicProduct && it.view === 'products');
        var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
        return '<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>';
      }).join('');
    }
  }
}"""
new_refresh_func = """/* 妙手风格：顶部分组高亮 + 主内容区左侧二级小卡渲染 */
function refreshTabsAndHighlight() {
  var raw = String(location.hash || '').replace('#/', '').split('?')[0];
  var view = raw;
  var isDynamicProduct = false;
  if (raw.startsWith('product/edit/') || raw === 'product/new') { view = 'product/edit'; isDynamicProduct = true; }
  var groupKey = VIEW_TO_GROUP[view] || VIEW_TO_GROUP[raw] || 'dashboard';
  if (!VIEW_TO_GROUP[view] && ERP_GROUPS.find(function(g){ return g.key === view; })) groupKey = view;
  document.querySelectorAll('.topnav-groups .nav-group-title').forEach(function(btn){
    btn.classList.toggle('on', btn.getAttribute('data-groupkey') === groupKey);
  });
  var side = document.getElementById('side-submenu');
  var g = ERP_GROUPS.find(function(x){ return x.key === groupKey; });
  if (side) {
    if (!g || !g.items || !g.items.length) { side.innerHTML = ''; side.style.display='none'; }
    else {
      side.style.display = '';
      side.innerHTML = '<h4>' + g.label + '</h4>' +
        g.items.map(function(it){
          var on = (it.view === raw) || (isDynamicProduct && it.view === 'products');
          var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
          return '<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>';
        }).join('');
    }
  }
}"""
_a(old_refresh_func in html, "旧 refreshTabsAndHighlight 函数正文 未找到")
html = html.replace(old_refresh_func, new_refresh_func)

with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[OK] 妙手风格 V3 主色+顶栏+左侧二级卡 完成")
