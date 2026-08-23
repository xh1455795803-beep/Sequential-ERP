#!/usr/bin/env python3
"""
妙手 ERP 1:1 完整复刻（FULL COPY，不自己精简任何东西）
对着 4 张真实妙手后台截图逐块还原：
  截图 A: 首页   page-2026-08-22T23-52-34-343.png（待办事项/公告/常用功能/帮助/广告/新手引导）
  截图 B: 产品页 page-2026-08-22T23-52-39-440.png（通用功能/快速上货/30+平台）
  截图 C: 订单页 page-2026-08-22T23-52-42-246.png（订单管理/订单规则/托管平台/平台仓/物流）
  截图 D: 新手   page-2026-08-22T23-52-44-826.png（新手指南4步+平台大网格）
"""
PATH = '/workspace/deploy/admin/index.html'
with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

def _a(c, m):
    if not c:
        raise AssertionError(m)

# ============================================================
# F1. 顶栏 1:1 全抄
#   F1-1 新增 CSS：HOT 标、中央搜索框、右上一排工具按钮（订购/插件下载/数据同步/帮助/客服/QQ群）
# ============================================================
# 在 .topnav-groups CSS 后注入新的搜索区/工具按钮样式
old_tg_line = ".topnav-groups{display:flex;align-items:center;gap:0;flex:0 0 auto;overflow:hidden;min-width:0}"
new_tg_extra = old_tg_line + """
/* 顶栏中央：快速搜索功能区（截图A箭头上方正中间） */
.topnav-search{display:flex;align-items:center;flex:1;justify-content:center;gap:10px;padding:0 18px}
.topnav-hot{display:inline-flex;align-items:center;padding:3px 8px;border-radius:3px;background:#ffb020;color:#fff;font-weight:800;font-size:10px;letter-spacing:.2px;margin-right:-4px}
.topnav-search input{height:30px;padding:4px 10px;border:0;border-radius:2px;background:rgba(255,255,255,.96);width:min(380px, 44%);font-size:12.5px;color:#1f2937;border-radius:2px 0 0 2px}
.topnav-search input::placeholder{color:#9ca3af}
.topnav-search-btn{height:30px;padding:0 16px;background:rgba(255,255,255,.18);color:#fff;border:1px solid rgba(255,255,255,.55);font-weight:600;font-size:12px;border-radius:0 2px 2px 0;cursor:pointer}
.topnav-search-btn:hover{background:#fff;color:#23c1a0;border-color:#fff}
/* 顶栏工具按钮（右上）：订购/插件下载/数据同步/帮助/客服/QQ群 青蓝透明扁平（妙手右上） */
.ms-tool-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;color:rgba(255,255,255,.95);font-size:12px;font-weight:600;border:0;background:transparent;cursor:pointer;border-radius:2px;white-space:nowrap;height:var(--topnav-h)}
.ms-tool-btn:hover{background:rgba(0,0,0,.08);color:#fff}
.ms-tool-btn svg{width:13px;height:13px;flex:none}
.ms-tool-btn.order-red{background:#ff4d4f;color:#fff;padding:3px 9px;margin:9px 2px;height:auto;border-radius:2px;font-weight:800}
.ms-tool-btn.order-red:hover{background:#ff7875;color:#fff}
.ms-order-tag{background:#fff;color:#23c1a0;font-size:10.5px;font-weight:900;padding:2px 6px;border-radius:2px;line-height:1;margin-left:2px}
/* 新手引导弹层（截图D） */
.ms-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:9999}
.ms-modal-mask.show{display:flex}
.ms-guide{width:720px;max-width:92vw;background:#fff;border-radius:8px;padding:16px 20px 18px;box-shadow:0 18px 60px rgba(0,0,0,.35)}
.ms-guide-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.ms-guide-head h3{font-size:16.5px;font-weight:800;color:#1f2937}
.ms-guide-close{background:transparent;border:0;font-size:20px;color:#9ca3af;cursor:pointer;line-height:1;padding:2px 6px}
.ms-guide-steps{display:grid;grid-template-columns:140px 1fr;gap:14px;margin-top:8px}
.ms-step-list{display:flex;flex-direction:column;gap:6px}
.ms-step{padding:8px 10px;border:1px solid transparent;border-radius:4px;font-size:13px;font-weight:600;color:#4b5563;cursor:pointer}
.ms-step .ms-n{display:inline-block;width:20px;height:20px;border-radius:50%;background:#e5e7eb;color:#6b7280;text-align:center;font-size:11.5px;font-weight:900;line-height:20px;margin-right:8px}
.ms-step.on{border-color:#23c1a0;color:#23c1a0;background:#e5faf5}
.ms-step.on .ms-n{background:#23c1a0;color:#fff}
.ms-guide-plat{background:#f9fafb;border-radius:6px;padding:12px 10px;min-height:200px}
.ms-guide-plat h4{font-size:13px;font-weight:700;color:#4b5563;margin-bottom:8px}
.ms-plat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
.ms-plat-card{background:#fff;border:1px solid #e5e7eb;border-radius:6px;padding:12px 8px;text-align:center;cursor:pointer;transition:all .1s}
.ms-plat-card:hover{border-color:#23c1a0;box-shadow:0 2px 8px rgba(35,193,160,.16)}
.ms-plat-card .pk{width:34px;height:34px;border-radius:6px;background:linear-gradient(135deg,#f97316,#ef4444);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;margin:0 auto 6px}
.ms-plat-card .pn{font-size:12.5px;font-weight:700;color:#1f2937}
.ms-guide-foot{display:flex;align-items:center;justify-content:space-between;margin-top:12px;border-top:1px solid #e5e7eb;padding-top:12px}
.ms-guide-qr{display:flex;align-items:center;gap:10px}
.ms-guide-qr .qr{width:72px;height:72px;border:1px solid #e5e7eb;border-radius:4px;background:#fff;display:flex;align-items:center;justify-content:center;color:#6b7280;font-size:10px;text-align:center}
.ms-guide-qr p{font-size:11.5px;color:#6b7280;line-height:1.6;margin:0}
.ms-guide-qr b{font-size:12px;color:#23c1a0;display:block;margin-bottom:3px;font-weight:800}
.ms-guide-foot a{font-size:12px;color:#23c1a0;font-weight:700;cursor:pointer}
"""
html = html.replace(old_tg_line, new_tg_extra, 1)

# F1-2 顶部 HTML：在 ERP_GROUPS JS 渲染之前（DOM 模板里）先加 搜索框 + 工具按钮一排
# 找 anchor 315 行：`<div class="topnav-groups" id="topnav-groups">` 整段开始之前插入
anchor_groups_wrap = """      <div class="brand"><div class="mark">序</div><div class="name">数序ERP</div></div>
      <div class="topnav-groups" id="topnav-groups">"""
_a(anchor_groups_wrap in html, "BRAND+topnav-groups 包裹锚点 未找到")
# 替换：brand 后面 → ERP HOT + 搜索框 + topnav-groups 空容器 + 工具按钮一排
new_topnav_center = """      <div class="brand"><div class="mark">序</div><div class="name">数序ERP</div></div>
      <div class="topnav-search">
        <span class="topnav-hot">ERP移动<br>HOT</span>
        <input id="ms-quick-search" placeholder="快速搜索功能" onkeydown="if(event.key==='Enter'){toast('WIP：功能搜索（妙手1:1骨架还原）','ok');}">
        <button class="topnav-search-btn" onclick="toast('WIP：功能搜索（妙手1:1骨架还原）','ok')">搜索功能</button>
      </div>
      <div class="topnav-groups" id="topnav-groups"></div>
      <!-- 顶栏右上工具按钮 1:1 妙手 -->
      <button class="ms-tool-btn" title="客服" onclick="toast('WIP：在线客服（妙手1:1骨架还原）','ok')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>客服
      </button>
      <button class="ms-tool-btn" title="帮助" onclick="toast('WIP：帮助中心（妙手1:1骨架还原）','ok')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>帮助
      </button>
      <button class="ms-tool-btn" title="数据同步" onclick="toast('WIP：数据同步（妙手1:1骨架还原）','ok')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>数据同步
      </button>
      <button class="ms-tool-btn" title="插件下载" onclick="toast('WIP：插件下载（妙手1:1骨架还原）','ok')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>插件下载
      </button>
      <button class="ms-tool-btn" title="QQ群" onclick="toast('WIP：QQ交流群（妙手1:1骨架还原）','ok')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>QQ群
      </button>
      <button class="ms-tool-btn order-red" title="订购" onclick="go('billing')">订购<span class="ms-order-tag">TOP</span></button>"""
html = html.replace(anchor_groups_wrap, new_topnav_center, 1)

# F1-3 ERP_GROUPS 从 7 组 改为 11 组 全抄妙手：首页/产品/订单/客服/数据/采购/仓库/物流/财务/服务/授权
old_groups = """const ERP_GROUPS = [
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
];"""
# 妙手 11 大分组全部列出来（真实功能用 wip: 前缀占位，点了 toast 不跳 404）
new_groups = """const ERP_GROUPS = [
  { key:'dashboard', label:'首页', iconSvg:'',
    sections: [],
    items:[ {view:'dashboard', label:'首页', svg:''} ] },
  { key:'products', label:'产品', iconSvg:'',
    sections: [
      { title:'通用功能', items:[
        {view:'products',    label:'商品管理', svg:''},
        {view:'products-v2', label:'产品采集', svg:'', badge:'NEW'},
        {view:'inventory',   label:'刊登记录', svg:''},
        {view:'inventory-ledger', label:'数据搬家', svg:''}
      ]},
      { title:'快速上货',  items:[
        {view:'wip-shopee1',     label:'Shopee',       cat:'快速上货'},
        {view:'wip-shopee2',     label:'Shopee本土',   cat:'快速上货'},
        {view:'wip-tiktok',      label:'TikTok',       cat:'快速上货'},
        {view:'wip-lazada',      label:'Lazada',       cat:'快速上货'},
        {view:'wip-temu-full',   label:'Temu全托管',   cat:'快速上货'},
        {view:'wip-temu-half',   label:'Temu半托管',   cat:'快速上货'},
        {view:'wip-ozon',        label:'Ozon',         cat:'快速上货'},
        {view:'wip-wb',          label:'Wildberries',  cat:'快速上货'},
        {view:'wip-aliex-half',  label:'AliExpress半托管', cat:'快速上货'},
        {view:'wip-aliex-full',  label:'速卖通全托管',    cat:'快速上货'},
        {view:'wip-amazon',      label:'Amazon',       cat:'快速上货'},
        {view:'wip-coupang',     label:'Coupang',      cat:'快速上货'},
        {view:'wip-alibaba',     label:'Alibaba',      cat:'快速上货'},
        {view:'wip-wish',        label:'Wish',         cat:'快速上货'},
        {view:'wip-joom',        label:'Joom',         cat:'快速上货'},
        {view:'wip-shopify',     label:'Shopify',      cat:'快速上货'},
        {view:'wip-daraz',       label:'Daraz',        cat:'快速上货'},
        {view:'wip-joom2',       label:'Qoo10',        cat:'快速上货'},
        {view:'wip-allegro',     label:'Allegro',      cat:'快速上货'},
        {view:'wip-mercado',     label:'Mercado',      cat:'快速上货'},
        {view:'wip-shopifyv2',   label:'ShopifyV2.0',  cat:'快速上货'},
        {view:'wip-jumia',       label:'Jumia',        cat:'快速上货'},
        {view:'wip-walmart',     label:'Walmart',      cat:'快速上货'},
        {view:'wip-sheplaza',    label:'Sheplaza',     cat:'快速上货'},
        {view:'wip-emag',        label:'eMAG',         cat:'快速上货'},
        {view:'wip-shein',       label:'SHEIN',        cat:'快速上货'}
      ]}
    ]},
  { key:'orders', label:'订单', iconSvg:'',
    sections: [
      { title:'订单管理', items:[
        {view:'orders',         label:'订单处理',  cat:'订单管理'},
        {view:'wip-orderhist',  label:'历史订单',  cat:'订单管理'},
        {view:'wip-scanpick',   label:'扫描分拣',  cat:'订单管理'},
        {view:'wip-scanship',   label:'扫描发货',  cat:'订单管理'},
        {view:'aftersales',     label:'售后订单',  cat:'订单管理', badge:'NEW'},
        {view:'wip-manualord',  label:'手工订单',  cat:'订单管理'},
        {view:'finance',        label:'利润明细',  cat:'订单管理'},
        {view:'wip-freightfwd', label:'货代管理',  cat:'订单管理'},
        {view:'wip-purchase-rec', label:'采购记录', cat:'订单管理'},
        {view:'shipments',      label:'物流追踪',  cat:'订单管理'}
      ]},
      { title:'订单规则', items:[
        {view:'auto-audit',   label:'审单规则',   cat:'订单规则', badge:'NEW'},
        {view:'wip-whrule',   label:'分仓规则',   cat:'订单规则'},
        {view:'wip-logirule', label:'物流匹配',   cat:'订单规则'},
        {view:'wip-gift',     label:'赠品规则',   cat:'订单规则'},
        {view:'wip-automark', label:'自动标记',   cat:'订单规则'}
      ]},
      { title:'托管平台订单', items:[
        {view:'wip-temu-stk',  label:'Temu备货',     cat:'托管平台订单'},
        {view:'wip-shein-stk', label:'SHEIN备货',    cat:'托管平台订单'},
        {view:'wip-aehalfjit', label:'AE半托管JIT',  cat:'托管平台订单'},
        {view:'wip-aefulljit', label:'AE全托管JIT',  cat:'托管平台订单'},
        {view:'wip-lazfulljit',label:'Lazada全托管JIT',cat:'托管平台订单'}
      ]},
      { title:'平台仓订单对接', items:[
        {view:'wip-shopee-wh',  label:'Shopee',     cat:'平台仓订单对接'},
        {view:'wip-mercado-wh', label:'Mercado',    cat:'平台仓订单对接'},
        {view:'wip-lazada-wh',  label:'Lazada',     cat:'平台仓订单对接'},
        {view:'wip-emag-wh',    label:'eMAG',       cat:'平台仓订单对接'}
      ]},
      { title:'物流', items:[
        {view:'carriers',         label:'物流商',    cat:'物流'},
        {view:'wip-address-mgr',  label:'地址管理',  cat:'物流'}
      ]}
    ]},
  { key:'cs', label:'客服', iconSvg:'',
    sections:[ { title:'客服', items:[
      {view:'wip-cschannel', label:'客服渠道', cat:'客服'},
      {view:'wip-csreturn',  label:'退款/退货', cat:'客服'},
      {view:'wip-msgreplay', label:'消息回复',   cat:'客服'}
    ]} ]
  },
  { key:'shops', label:'数据', iconSvg:'',
    sections:[ { title:'数据', items:[
      {view:'shops',          label:'实时概览',   cat:'数据'},
      {view:'platforms',      label:'实时大屏',   cat:'数据'},
      {view:'finance-v2',     label:'利润明细',   cat:'数据'},
      {view:'finance-report', label:'回款记录',   cat:'数据'},
      {view:'exchange-rates', label:'多币种汇率', cat:'数据', badge:'NEW'},
      {view:'wip-reports',    label:'更多报表',   cat:'数据'}
    ]} ]
  },
  { key:'purchase', label:'采购', iconSvg:'',
    sections:[ { title:'采购', items:[
      {view:'purchases',      label:'采购单',     cat:'采购'},
      {view:'wip-puchreq',    label:'缺货建议',   cat:'采购'},
      {view:'suppliers',      label:'供应商',     cat:'采购'},
      {view:'wip-puchappr',   label:'付款审批',   cat:'采购'}
    ]} ]
  },
  { key:'warehouse', label:'仓库', iconSvg:'',
    sections:[ { title:'仓库', items:[
      {view:'wip-ware-goods', label:'商品管理',   cat:'仓库'},
      {view:'wip-ware-third', label:'第三方仓库', cat:'仓库'},
      {view:'wip-ware-list',  label:'仓库列表',   cat:'仓库'},
      {view:'wip-ware-inout', label:'出入库',     cat:'仓库'}
    ]} ]
  },
  { key:'logistics', label:'物流', iconSvg:'',
    sections:[ { title:'物流', items:[
      {view:'wip-log-agent', label:'货代',        cat:'物流'},
      {view:'carriers',      label:'物流商',      cat:'物流'},
      {view:'wip-log-channel',label:'渠道',       cat:'物流'},
      {view:'wip-log-addr',  label:'地址管理',    cat:'物流'}
    ]} ]
  },
  { key:'finance', label:'财务', iconSvg:'',
    sections:[ { title:'财务', items:[
      {view:'finance',        label:'订单利润',   cat:'财务'},
      {view:'finance-v2',     label:'利润看板·V2',cat:'财务', badge:'NEW'},
      {view:'exchange-rates', label:'多币种汇率', cat:'财务', badge:'NEW'},
      {view:'finance-report', label:'经营报表',   cat:'财务'}
    ]} ]
  },
  { key:'service', label:'服务', iconSvg:'',
    sections:[ { title:'服务', items:[
      {view:'wip-svc-dykf',  label:'抖音客服',    cat:'服务'},
      {view:'wip-svc-gpt',   label:'店小秘AI',    cat:'服务'},
      {view:'wip-svc-flow',  label:'AI工作流',    cat:'服务'},
      {view:'wip-svc-erp',   label:'ERP定制',     cat:'服务'}
    ]} ]
  },
  { key:'auth', label:'授权', iconSvg:'',
    sections:[ { title:'授权', items:[
      {view:'shops',         label:'平台授权',    cat:'授权'},
      {view:'wip-auth-ware', label:'仓库授权',    cat:'授权'},
      {view:'wip-auth-dev',  label:'开发者信息',  cat:'授权'}
    ]} ]
  },
  // 运营：仅超管
  { key:'saas', label:'运营', iconSvg:'',
    sections:[],
    items:[ {view:'saas-admin', label:'SaaS运营后台'} ],
    hidden: true
  },
  // 设置：之前的保留，挂在系统设置（不算主分组，放头像菜单）
  { key:'settings-h', label:'系统设置', iconSvg:'', hidden: true,
    sections:[], items:[
      {view:'audit-logs', label:'审计日志'},
      {view:'settings',   label:'账户设置'}
    ]
  }
];
"""
_a(old_groups in html, "旧 ERP_GROUPS 7组 未找到")
html = html.replace(old_groups, new_groups, 1)

# F1-4. VIEW_TO_GROUP 适配：wip-* 路由 → 对应分组；真实路由保持映射
# 旧 VIEW_TO_GROUP 是自动的，现在我们手工写死保证 wip-* 也正确
old_vtg = """const VIEW_TO_GROUP = (function(){
  var m = {};
  ERP_GROUPS.forEach(function(g){ g.items.forEach(function(it){ m[it.view] = g.key; }); });
  m['product/new']  = 'products';
  m['product/edit'] = 'products';
  return m;
})();"""
new_vtg = """const VIEW_TO_GROUP = (function(){
  var m = {};
  // sections 模式：先把所有 section 的 items 注入
  ERP_GROUPS.forEach(function(g){
    if (g.sections && g.sections.length) {
      g.sections.forEach(function(sec){
        (sec.items||[]).forEach(function(it){ m[it.view] = g.key; });
      });
    }
    (g.items||[]).forEach(function(it){ m[it.view] = g.key; });
  });
  m['product/new']  = 'products';
  m['product/edit'] = 'products';
  // 真实路由兜底（防止旧 20 真实功能找不到分组）
  var old = { shops:'shops', platforms:'shops', products:'products', 'products-v2':'products', inventory:'products', 'inventory-ledger':'products', orders:'orders', 'auto-audit':'orders', aftersales:'orders', shipments:'orders', purchases:'purchase', suppliers:'purchase', carriers:'logistics', finance:'finance', 'finance-v2':'finance', 'exchange-rates':'finance', 'finance-report':'finance', 'audit-logs':'settings-h', settings:'settings-h', dashboard:'dashboard', 'saas-admin':'saas'};
  for (var k in old) if (!m[k]) m[k] = old[k];
  return m;
})();"""
_a(old_vtg in html, "旧 VIEW_TO_GROUP 未找到")
html = html.replace(old_vtg, new_vtg, 1)

# F1-5. go(view) + hashchange：新增 wip-* 前缀 → 识别为合法路由，渲染 WIP 占位不报错不回跳 dashboard
# 改 isValid 判断
old_known = "  const knownRoutes = Object.keys(VIEW_TITLES);\n  const isValid = knownRoutes.includes(rawView) || knownRoutes.includes(titleKey) || loaderKey !== rawView;"
new_known = "  // 妙手 1:1 骨架：wip-* 路由一律合法（WIP 占位），不要回 dashboard\n  const knownRoutes = Object.keys(VIEW_TITLES);\n  const isWip = /^wip-/.test(rawView);\n  const isValid = knownRoutes.includes(rawView) || knownRoutes.includes(titleKey) || loaderKey !== rawView || isWip;"
_a(old_known in html, "GO knownRoutes 行 未找到")
html = html.replace(old_known, new_known, 1)

# 改 loaders 找不到就渲染 WIP 占位（不递归回 dashboard）
old_loader_fallback = "  if (loaders[loaderKey]) loaders[loaderKey]();\n  else { go('dashboard'); }"
new_loader_fallback = """  if (loaders[loaderKey]) loaders[loaderKey]();
  else if (isWip) {
    const gName = (ERP_GROUPS.find(g=>g.key===VIEW_TO_GROUP[rawView])||{}).label || '功能';
    let secName = '', label = '';
    ERP_GROUPS.forEach(g=> (g.sections||[]).forEach(s=> (s.items||[]).forEach(it=>{ if (it.view===rawView) { secName = s.title; label = it.label; } })));
    (ERP_GROUPS.find(g=>g.key===VIEW_TO_GROUP[rawView])?.items||[]).forEach(it=>{ if(it.view===rawView) label = it.label; });
    const content = document.getElementById('content');
    content.innerHTML = '<div class=\\\\\"card\\\\\" style=\\\\\"max-width:780px\\\\\"><div class=\\\\\"card-head\\\\\"><h3>' + gName + ' · ' + (secName?secName+' · ':'') + (label||rawView) + '</h3><span style=\\\\\"color:#9ca3af;font-size:12px\\\\\">妙手 1:1 骨架还原 · 功能占位（WIP）</span></div><div style=\\\\\"padding:26px 20px;color:#4b5563;font-size:13px;line-height:1.8\\\\\">此处为 <b>' + (label||'该子功能') + '</b> 页面占位（照妙手 1:1 结构全部已搬上来，后续您告诉我要/不要哪些，我再补充真实功能）。<br>目前已经保留了您要求过的 20+ 真实功能（商品管理/订单管理/店铺授权/财务中心/汇率/利润看板/库存/发货/自动审单/售后 等），点击对应菜单项即可使用。</div></div>';
    const pt = document.getElementById('page-title');
    if (pt) pt.textContent = label || rawView;
    refreshTabsAndHighlight();
  } else { go('dashboard'); }"""
_a(old_loader_fallback in html, "GO loaders fallback 未找到")
html = html.replace(old_loader_fallback, new_loader_fallback, 1)

# hashchange 里也要放行 wip-*
old_hash_wip = "  if (v.startsWith('product/edit/') || v === 'product/new' || VIEW_TITLES[v]) {"
new_hash_wip = "  if (v.startsWith('product/edit/') || v === 'product/new' || VIEW_TITLES[v] || /^wip-/.test(v)) {"
_a(old_hash_wip in html, "hashchange VIEW_TITLES 判定行 未找到")
html = html.replace(old_hash_wip, new_hash_wip, 1)

# ============================================================
# F2. 左侧二级/三级 1:1 妙手：支持 sections 分组显示多个小标题块
#     + 首页改特殊布局（待办/公告/右侧常用功能/帮助/广告）
# ============================================================
# F2-1. 注入 CSS：左侧二级 sections 标题块（浅灰 h4）、首页特布局、常用功能卡、帮助教程卡、广告 banner
old_sidesub_start = ".side-submenu h4{margin:6px 12px 4px;padding:4px 0;font-size:11px;color:var(--text-3);font-weight:800;letter-spacing:.3px;text-transform:uppercase}"
new_sidesub_extra = old_sidesub_start + """
/* 妙手首页：主区 2 栏：左 70% 内容 + 右 30% 常用功能/帮助卡 */
.ms-home-wrap{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:14px}
.ms-home-left{display:flex;flex-direction:column;gap:12px;min-width:0}
.ms-home-right{display:flex;flex-direction:column;gap:12px}
/* 待办事项（红框） */
.ms-card{background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:12px 14px}
.ms-card h3{font-size:13.5px;font-weight:800;color:#1f2937;margin-bottom:8px}
.ms-todo-grid{display:grid;grid-template-columns:repeat(5, minmax(0,1fr));gap:0;border:1px solid #e5e7eb;border-radius:4px;overflow:hidden}
.ms-todo-block{border-right:1px solid #e5e7eb;padding:10px 12px;min-height:110px;background:#fafafa}
.ms-todo-block:last-child{border-right:0}
.ms-todo-block .tb{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:12px;font-weight:700;color:#4b5563}
.ms-todo-block .tb svg{width:14px;height:14px;color:#23c1a0}
.ms-todo-block .tn{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:2px}
.ms-todo-block .tn a{color:#6b7280;font-size:11.5px;text-decoration:none;line-height:1.5}
.ms-todo-block .tn a b{color:#1f2937;font-weight:800;margin-right:2px;font-size:12.5px}
.ms-todo-block .tn a.danger{color:#ef4444}
/* 公告消息（红框） */
.ms-msg-tabs{display:flex;align-items:center;border-bottom:1px solid #e5e7eb;margin-bottom:6px}
.ms-msg-tabs a{padding:6px 12px;font-size:12.5px;font-weight:700;color:#6b7280;border-bottom:2px solid transparent;cursor:pointer}
.ms-msg-tabs a.on{color:#23c1a0;border-color:#23c1a0}
.ms-msg-tabs .more{margin-left:auto;font-size:12px;color:#6b7280;font-weight:600;cursor:pointer;padding:4px 6px}
.ms-msg-list{display:flex;flex-direction:column;gap:4px}
.ms-msg-list li{list-style:none;font-size:12px;color:#4b5563;line-height:1.7;display:flex;gap:8px;align-items:flex-start}
.ms-msg-list li::before{content:'●';color:#23c1a0;font-size:9px;margin-top:5px;flex:none}
.ms-msg-list .b{color:#23c1a0;font-weight:700}
.ms-msg-list .t{color:#9ca3af;font-size:11px;margin-left:auto;white-space:nowrap}
/* 妙手蓝色/绿色广告 banner */
.ms-banner-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ms-banner{display:flex;align-items:center;gap:14px;padding:10px 14px;border-radius:4px;background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;position:relative;overflow:hidden}
.ms-banner.green{background:linear-gradient(135deg,#10b981,#047857)}
.ms-banner .bm{font-weight:900;font-size:13.5px;line-height:1.3;margin-bottom:3px}
.ms-banner .bs{font-size:11.5px;opacity:.92;line-height:1.4}
.ms-banner .btn{background:#fff;color:#1d4ed8;padding:4px 10px;border-radius:2px;font-size:11px;font-weight:800;display:inline-block;margin-top:6px}
.ms-banner.green .btn{color:#047857}
.ms-banner .big-mark{position:absolute;right:-18px;bottom:-18px;font-size:70px;font-weight:900;opacity:.14}
/* 右侧常用功能/帮助教程卡 */
.ms-side-card{background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:10px 12px}
.ms-side-card h3{font-size:13px;font-weight:800;color:#1f2937;margin-bottom:8px}
.ms-quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.ms-quick{text-align:center;padding:8px 4px;border-radius:4px;background:#f9fafb;cursor:pointer}
.ms-quick:hover{background:#e5faf5}
.ms-quick .qi{width:26px;height:26px;background:#e0f2fe;color:#0284c7;border-radius:6px;margin:0 auto 4px;display:flex;align-items:center;justify-content:center}
.ms-quick.orange .qi{background:#ffedd5;color:#ea580c}
.ms-quick.green .qi{background:#d1fae5;color:#059669}
.ms-quick.purple .qi{background:#ede9fe;color:#7c3aed}
.ms-quick.amber .qi{background:#fef3c7;color:#d97706}
.ms-quick.pink .qi{background:#fce7f3;color:#db2777}
.ms-quick .qn{font-size:11px;font-weight:700;color:#374151}
.ms-help-list{display:flex;flex-direction:column;gap:6px}
.ms-help-list a{font-size:11.5px;color:#4b5563;text-decoration:none;line-height:1.45}
.ms-help-list a:hover{color:#23c1a0}
.ms-help-more{text-align:right;font-size:11.5px;color:#23c1a0;font-weight:700;cursor:pointer;margin-top:4px}
/* 右侧直播预告 */
.ms-live-card{background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:10px 12px;display:flex;gap:10px;align-items:flex-start}
.ms-live-img{width:82px;height:82px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#ea580c;font-size:10px;text-align:center;line-height:1.3;flex:none}
.ms-live-card .lt{font-size:11.5px;font-weight:700;color:#1f2937;line-height:1.4}
.ms-live-card .lm{font-size:10.5px;color:#6b7280;margin-top:3px;line-height:1.4}
.ms-live-card .la{display:inline-block;margin-top:6px;font-size:11px;font-weight:800;color:#23c1a0;background:#e5faf5;padding:2px 8px;border-radius:2px}
/* 订单/产品页：右上角 WIP 气泡引导（如截图B【如何采集产品】） */
.ms-guide-bubble{position:absolute;right:18px;top:12px;max-width:280px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:6px;padding:8px 10px;box-shadow:0 4px 14px rgba(16,185,129,.18);z-index:5}
.ms-guide-bubble h4{font-size:12px;font-weight:800;color:#047857;margin-bottom:4px}
.ms-guide-bubble p{font-size:11px;color:#047857;line-height:1.5;margin-bottom:6px}
.ms-guide-bubble button{background:#10b981;color:#fff;border:0;font-size:11px;padding:3px 8px;border-radius:3px;font-weight:700;cursor:pointer}
.ms-guide-bubble::after{content:'';position:absolute;top:-7px;right:70px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:7px solid #a7f3d0}
.ms-rel{position:relative}
"""
_a(old_sidesub_start in html, "SIDE-SUB H4 起始样式 未找到")
html = html.replace(old_sidesub_start, new_sidesub_extra, 1)

# F2-2. HTML：在 </main> 前插入 新手引导弹层 + 头像菜单里补「系统设置 / 审计日志 / 账户设置」
# 先加新手引导弹层（放在 #app-view 闭合 div 之前，找最后一个 </div> 不行，用个 anchor：</div>\n</div>\n</div> 那一串主结构结尾）
old_guide_anchor = """    <div class="subnav-tabs" id="subnav-tabs"></div>
    <!-- 第三行：页面标题条 -->"""
new_guide_anchor = """    <!-- 妙手 1:1 新手引导弹层（截图D） -->
    <div class="ms-modal-mask" id="ms-guide-mask">
      <div class="ms-guide">
        <div class="ms-guide-head">
          <h3>新手指南</h3>
          <button class="ms-guide-close" onclick="document.getElementById('ms-guide-mask').classList.remove('show')">×</button>
        </div>
        <div class="ms-guide-steps">
          <div class="ms-step-list">
            <div class="ms-step on" onclick="toast('WIP：切换步骤（妙手1:1骨架还原）','ok')"><span class="ms-n">01</span>授权店铺</div>
            <div class="ms-step" onclick="toast('WIP：切换步骤（妙手1:1骨架还原）','ok')"><span class="ms-n">02</span>发布产品</div>
            <div class="ms-step" onclick="toast('WIP：切换步骤（妙手1:1骨架还原）','ok')"><span class="ms-n">03</span>处理订单</div>
            <div class="ms-step" onclick="toast('WIP：切换步骤（妙手1:1骨架还原）','ok')"><span class="ms-n">04</span>更多功能</div>
          </div>
          <div class="ms-guide-plat">
            <h4>请先选择一个平台进行店铺授权</h4>
            <div class="ms-plat-grid">
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk">Sp</div><div class="pn">Shopee</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:linear-gradient(135deg,#111,#333)">TT</div><div class="pn">TikTok</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:linear-gradient(135deg,#0f172a,#1e40af)">Lz</div><div class="pn">Lazada</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:linear-gradient(135deg,#dc2626,#f97316)">TM</div><div class="pn">Temu</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:linear-gradient(135deg,#0ea5e9,#1e3a8a)">OZ</div><div class="pn">OZON</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:#ec4899">WB</div><div class="pn">Wildberries</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:linear-gradient(135deg,#f59e0b,#dc2626)">AE</div><div class="pn">AliExpress</div></div>
              <div class="ms-plat-card" onclick="go('shops')"><div class="pk" style="background:#2563eb">AM</div><div class="pn">Amazon</div></div>
            </div>
            <div class="ms-guide-foot">
              <div class="ms-guide-qr">
                <div class="qr">扫码关注<br>最新动态</div>
                <p><b>妙手ERP · 官方</b>扫码关注公众号<br>获取最新入驻政策、活动通知~</p>
              </div>
              <a onclick="toast('WIP：查看帮助（妙手1:1骨架还原）','ok')">查看帮助 →</a>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="subnav-tabs" id="subnav-tabs"></div>
    <!-- 第三行：页面标题条 -->"""
_a(old_guide_anchor in html, "GUIDE ANCHOR（subnav-tabs + 页面标题） 未找到")
html = html.replace(old_guide_anchor, new_guide_anchor, 1)

# F2-3. 头像下拉菜单里补 新手指南 / 审计日志 / 账户设置（放在原 divider + 退出登录之前）
old_avatar_divider_exit = """              <div class="avatar-menu-divider"></div>
              <a class="avatar-menu-item logout" onclick="logout()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                退出登录
              </a>"""
new_avatar_divider_exit = """              <div class="avatar-menu-divider"></div>
              <a class="avatar-menu-item" onclick="document.getElementById('ms-guide-mask').classList.add('show');closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/></svg>新手指南
              </a>
              <a class="avatar-menu-item" onclick="go('audit-logs');closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/></svg>审计日志
              </a>
              <a class="avatar-menu-item" onclick="go('settings');closeAvatarMenu()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/></svg>账户设置
              </a>
              <div class="avatar-menu-divider"></div>
              <a class="avatar-menu-item logout" onclick="logout()">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                退出登录
              </a>"""
_a(old_avatar_divider_exit in html, "头像菜单 divider + 退出登录 未找到")
html = html.replace(old_avatar_divider_exit, new_avatar_divider_exit, 1)

# F2-4. JS 左侧二级卡渲染：sections 模式多块小标题 + 多 item；非 dashboard 走 section；dashboard 走 F3 特殊布局
old_refreshfunc = """/* 妙手风格：顶部分组高亮 + 主内容区左侧二级小卡渲染 */
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
new_refreshfunc = """/* 妙手 1:1 完整：顶部分组高亮 + 左侧二级/三级 sections 多块渲染 */
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
  if (!side) return;
  if (!g) { side.innerHTML = ''; side.style.display='none'; return; }
  if (groupKey === 'dashboard') {
    // 首页：左侧窄条不显示二级菜单（截图A首页左侧没有"通用功能"三级小卡，直接隐藏）
    side.style.display = 'none'; return;
  }
  side.style.display = '';
  var htmlParts = [];
  // sections 模式（订单/产品/数据/客服/采购/仓库/物流/财务/服务/授权）
  if (g.sections && g.sections.length) {
    g.sections.forEach(function(sec){
      htmlParts.push('<h4>' + sec.title + '</h4>');
      (sec.items||[]).forEach(function(it){
        var on = (it.view === raw) || (isDynamicProduct && it.view === 'products');
        var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
        htmlParts.push('<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>');
      });
    });
  }
  // 老 items 模式（兼容 settings-h / saas 等）
  if (g.items && g.items.length) {
    if (!(g.sections && g.sections.length)) htmlParts.push('<h4>' + g.label + '</h4>');
    g.items.forEach(function(it){
      var on = (it.view === raw) || (isDynamicProduct && it.view === 'products');
      var badge = it.badge ? '<em>'+it.badge+'</em>' : '';
      htmlParts.push('<a class="nav-item'+(on?' on':'')+'" data-view="'+it.view+'" href="#/'+it.view+'" onclick="event.preventDefault();go(\\''+it.view+'\\')">'+(it.svg||'')+it.label+badge+'</a>');
    });
  }
  if (!htmlParts.length) { side.innerHTML = ''; side.style.display='none'; return; }
  side.innerHTML = htmlParts.join('');
}"""
_a(old_refreshfunc in html, "旧 refreshTabsAndHighlight（完整 sections 之前版） 未找到")
html = html.replace(old_refreshfunc, new_refreshfunc, 1)

# F2-5. Dashboard 主布局特殊：两栏（.ms-home-wrap），所以 enterApp 里 dashboard 默认进入后要改 main 的样式 —— 我们更稳：在 loadDashboard 里先包一层 ms-home-wrap（改 renderDashboard 内容就好，不碰现有真实统计）
# 先读 loadDashboard 开始一点点
# 找：function loadDashboard() { 里最开头的 "<div class=\"stat-grid\">" 替换成 首页 1:1 布局外壳 + 真实 dashboard 统计放左边最上方
old_dash_start = '<div class="stat-grid">'
new_dash_start = """<div class="ms-home-wrap">
  <div class="ms-home-left">
    <!-- 上：真实统计概览（保留原有四格） -->
    <div class="stat-grid">"""
_a(old_dash_start in html, "DASH stat-grid 开头 未找到")
html = html.replace(old_dash_start, new_dash_start, 1)

# 接着：原来 dashboard 结尾的 "</div>`;"（订单状态 card + </div> + `; = loadDashboard innerHTML 闭合）
# 实际原代码是：
#     </div>`;
# }
# 因为 loadDashboard 的最后一段是订单状态分布的 <div class="card">...<div>
# 找 anchor = 订单状态分布 的下一行 `    </div>`;
old_dash_end = """      </div>
    </div>`;
}"""
new_dash_end = """      </div>
    </div>
    <!-- 妙手 1:1：待办事项（红框） -->
    <div class="ms-card">
      <h3>待办事项</h3>
      <div class="ms-todo-grid">
        <div class="ms-todo-block"><div class="tb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4"/></svg>产品</div>
          <div class="tn"><a><b>0</b> 待发布</a><a><b>0</b> 发布中</a><a><b>0</b> 今日发布失败</a></div>
        </div>
        <div class="ms-todo-block"><div class="tb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/></svg>订单</div>
          <div class="tn"><a><b>0</b> 剩余货期<1天</a><a><b>0</b> 待处理</a><a><b>0</b> 待打单发货</a><a class="danger"><b>0</b> 交运失败</a><a><b>0</b> 待处理售后订单</a><a><b>0</b> 待补录单号</a></div>
        </div>
        <div class="ms-todo-block"><div class="tb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/></svg>采购</div>
          <div class="tn"><a><b>0</b> 缺货建议</a><a><b>0</b> 备货建议</a><a><b>0</b> 待签收入库</a><a><b>0</b> 待审核</a><a><b>0</b> 待付款审批</a></div>
        </div>
        <div class="ms-todo-block"><div class="tb"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>客服</div>
          <div class="tn"><a><b>0</b> Coupang待回复</a><a><b>0</b> Wish待回复</a><a><b>0</b> Allegro留言待回复</a></div>
        </div>
        <div class="ms-todo-block"><div class="tb">✨&nbsp;<span>运营</span></div>
          <div class="tn"><a><b>0</b> 广告待优化</a><a><b>0</b> 店铺运营报告</a></div>
        </div>
      </div>
    </div>
    <!-- 妙手 1:1：公告消息（红框）2 Tab + 更多 -->
    <div class="ms-card">
      <div class="ms-msg-tabs">
        <a class="on">公告消息</a>
        <a>妙手资讯</a>
        <span class="more">更多 ›</span>
      </div>
      <ul class="ms-msg-list">
        <li><span><span class="b">[功能更新]</span>1、Wildberries支持采集刊登 2、速卖通全托管支持采集刊登/产品管理 3、Temu半托管支持订单处理 4、Ozon...</span><span class="t">2026-04-01 08:12</span></li>
        <li><span><span class="b">[直播预告]</span>Shopee黑科技投放-高效实现批量编辑！</span><span class="t">2026-03-28 15:00</span></li>
        <li><span><span class="b">[直播预告]</span>轻松铺货，实现TikTok批量采集上架！</span><span class="t">2026-03-28 14:21</span></li>
        <li><span><span class="b">[直播预告]</span>轻松高效，实现TikTok批量采集上架！</span><span class="t">2026-03-28 14:23</span></li>
      </ul>
    </div>
    <!-- 妙手 1:1：蓝色+绿色 双广告 banner -->
    <div class="ms-banner-row">
      <div class="ms-banner"><div><div class="bm">多平台多店铺智能客服系统</div><div class="bs">自动翻译 · AI智能回复 · 多店聚合 · 全渠道工单</div><span class="btn">免费使用</span></div><div class="big-mark">💬</div></div>
      <div class="ms-banner green"><div><div class="bm">专注东南亚本土卖家 ERP</div><div class="bs">支持 Shopee、Lazada、TikTok · 本土发货 / 本土回款</div><span class="btn">立即咨询</span></div><div class="big-mark">🌏</div></div>
    </div>
  </div>
  <div class="ms-home-right">
    <!-- 直播/培训预告 -->
    <div class="ms-live-card">
      <div class="ms-live-img">直播/<br>培训预告<br>二维码</div>
      <div style="flex:1;min-width:0">
        <div class="lt">直播/爆款黑科技-高效实<br>现批量编辑！</div>
        <div class="lm">03月28日 15:00-17:00</div>
        <a class="la">查看议程 ›</a>
      </div>
    </div>
    <!-- 常用功能 -->
    <div class="ms-side-card">
      <h3>常用功能</h3>
      <div class="ms-quick-grid">
        <div class="ms-quick" onclick="go('shops')"><div class="qi">🏪</div><div class="qn">店铺授权</div></div>
        <div class="ms-quick orange" onclick="go('products-v2')"><div class="qi">📦</div><div class="qn">产品采集</div></div>
        <div class="ms-quick green" onclick="go('orders')"><div class="qi">📋</div><div class="qn">订单管理</div></div>
        <div class="ms-quick purple" onclick="go('wip-ware-goods')"><div class="qi">🏬</div><div class="qn">仓储管理</div></div>
        <div class="ms-quick amber" onclick="go('purchases')"><div class="qi">🛒</div><div class="qn">采购管理</div></div>
        <div class="ms-quick pink" onclick="go('shops')"><div class="qi">📊</div><div class="qn">数据分析</div></div>
      </div>
    </div>
    <!-- 帮助教程 -->
    <div class="ms-side-card">
      <h3>帮助教程</h3>
      <div class="ms-help-list">
        <a onclick="toast('WIP：定价模板创建流程（妙手1:1骨架还原）','ok')">▶ 定价模板创建流程</a>
        <a onclick="toast('WIP：下载安装妙手订单（妙手1:1骨架还原）','ok')">▶ 下载和安装妙手订单</a>
        <a onclick="toast('WIP：了解货代管理（妙手1:1骨架还原）','ok')">▶ 了解货代管理</a>
        <a onclick="toast('WIP：在线产品管理（妙手1:1骨架还原）','ok')">▶ 在线产品管理</a>
        <a onclick="toast('WIP：一键下单到货源平台（妙手1:1骨架还原）','ok')">▶ 一键下单到货源平台</a>
        <a onclick="toast('WIP：快速清理滞销产品（妙手1:1骨架还原）','ok')">▶ 快速清理滞销产品</a>
      </div>
      <div class="ms-help-more">更多 →</div>
    </div>
  </div>
</div>
`;
}"""
_a(old_dash_end in html, "DASH 结束锚点 `</div>`; 未找到")
html = html.replace(old_dash_end, new_dash_end, 1)

# F2-6. 产品页主内容 加【如何采集产品 →】妙手小气泡引导（截图B右上角）
old_prod_head = """<div class="card">
      <div class="card-head"><h3>商品列表（${r.items.length}）</h3>"""
new_prod_head = """<div class="card ms-rel">
      <div class="ms-guide-bubble"><h4>如何采集产品</h4><p>可以对采集商品进行预处理（发布到店铺前的编辑/翻译/图片处理等，具体在【采集设置】中配置）</p><button onclick="this.parentNode.style.display='none'">我知道了</button></div>
      <div class="card-head"><h3 style="padding-right:310px">商品列表（${r.items.length}）</h3>"""
_a(old_prod_head in html, "PRODUCT CARD HEAD 未找到")
html = html.replace(old_prod_head, new_prod_head, 1)

# F2-7. 订单页主内容 加 顶部蓝色提示条（截图C"您需要手动审核订单…立即前往"）
old_order_head = """<div class="card">
      <div class="card-head"><h3>订单列表"""
new_order_head = """<div class="card">
      <div style="padding:8px 12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:4px;color:#4338ca;font-size:12.5px;margin-bottom:10px;display:flex;align-items:center;gap:8px">
        📌 您需要手动审核订单，可前往 <b>【审单规则】</b> 页面启用「待审核」流程
        <button class="btn-ghost btn-sm" style="margin-left:auto" onclick="go('auto-audit')">立即前往</button>
      </div>
      <div class="card-head"><h3>订单列表"""
_a(old_order_head in html, "ORDER CARD HEAD 未找到")
html = html.replace(old_order_head, new_order_head, 1)

# ============================================================
# 写回
# ============================================================
with open(PATH, 'w', encoding='utf-8') as f:
    f.write(html)
print("[OK] 妙手 1:1 完整复刻脚本 执行成功（全抄，不再精简）")
