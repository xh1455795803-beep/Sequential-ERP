#!/usr/bin/env python3
"""
B5: 将商品编辑从弹窗改为独立完整页面
- 新增路由：#/product/new 新增商品，#/product/edit/:id 编辑商品
- 修改 productForm 函数为路由跳转（非弹窗）
- 新增 loadProductEdit 独立页面渲染函数（完整页面，非模板块）
- 修改 saveProduct 关闭弹窗逻辑为路由返回
- 修改 hashchange 和 go 函数支持动态路由匹配
"""
import re, sys, os

PATH = '/workspace/deploy/admin/index.html'

with open(PATH, 'r', encoding='utf-8') as f:
    html = f.read()

original = html

# ========= 1. VIEW_TITLES 补充 product 相关路由 =========
old_titles = "const VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置', billing:'套餐订阅' };"
new_titles = "const VIEW_TITLES = { dashboard:'概览', shops:'店铺授权', platforms:'平台接入', products:'商品管理', 'product/new':'新增商品', 'product/edit':'编辑商品', 'products-v2':'商品中心·V2完整版', inventory:'库存管理', 'inventory-ledger':'库存流水', orders:'订单管理', 'auto-audit':'自动审单配置', aftersales:'售后逆向中心', shipments:'发货记录', purchases:'采购单', suppliers:'供应商', carriers:'物流商', finance:'订单利润', 'finance-v2':'利润看板·V2', 'finance-report':'月度报表', 'exchange-rates':'多币种汇率看板', scheduler:'任务监控·调度中心', 'saas-admin':'SaaS运营后台', 'audit-logs':'审计日志', settings:'账户设置', billing:'套餐订阅' };"
assert old_titles in html, "VIEW_TITLES block not found"
html = html.replace(old_titles, new_titles)

# ========= 2. 扩展 go 函数支持动态路由 =========
# 旧 go 函数核心：精确匹配 view -> loaders[view]()
# 替换为：解析 product/edit/:id 等动态路由，再分派

old_go_router = """  document.getElementById('page-title').textContent = VIEW_TITLES[view];
  const loaders = { dashboard: loadDashboard, orders: loadOrders, products: loadProducts, 'products-v2': loadProductsV2, inventory: loadInventory, 'inventory-ledger': loadInventoryLedger, shops: loadShops, platforms: loadPlatforms, 'auto-audit': loadAutoAudit, aftersales: loadAftersales, shipments: loadShipments, purchases: loadPurchases, suppliers: loadSuppliers, carriers: loadCarriers, finance: loadFinance, 'finance-v2': loadFinanceV2, 'finance-report': loadFinanceReport, 'exchange-rates': loadExchangeRates, scheduler: loadScheduler, 'saas-admin': loadSaasAdmin, 'audit-logs': loadAuditLogs, settings: loadSettings, billing: loadBilling };
  loaders[view]();"""

new_go_router = """  // ===== 动态路由解析：product/edit/:id / product/new =====
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
  loaders[view]();"""

assert old_go_router in html, "go router block not found"
html = html.replace(old_go_router, new_go_router)

# 同时删除 go 函数里旧的重复的 nav-item on 切换（因为已经在上面改了）
old_dup_toggle = """  location.hash = '#/' + view + q;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('on', n.dataset.view === view));
  highlightNavGroup();"""
# 注意：旧的这一段需要替换掉，因为上面 new_go_router 已经包含 highlightNavGroup 和 nav-item 切换（放在 product-edit 逻辑里了）
new_dup_toggle = """  // location.hash 由调用方传入 view（动态路由先解析再写入）
  location.hash = '#/' + (titleKey && titleKey !== view ? titleKey : view) + q;"""
# 检查是否还是老样子
if old_dup_toggle in html:
    html = html.replace(old_dup_toggle, new_dup_toggle)
else:
    print("WARN: old_dup_toggle not found, check state")

# ========= 3. 修改 hashchange 监听器支持动态路由 =========
old_hashchange = """window.addEventListener('hashchange', () => {
  const v = String(location.hash.replace('#/', '')).split('?')[0];
  // 未登录时：shops/platforms 直接洗回登录页（避免手动改地址栏）
  if (!token && (v === 'shops' || v === 'platforms')) {
    location.replace(location.pathname + '#/');
    return;
  }
  if (token && VIEW_TITLES[v]) go(v);
});"""

new_hashchange = """window.addEventListener('hashchange', () => {
  const v = String(location.hash.replace('#/', '')).split('?')[0];
  // 未登录时：shops/platforms 直接洗回登录页（避免手动改地址栏）
  if (!token && (v === 'shops' || v === 'platforms')) {
    location.replace(location.pathname + '#/');
    return;
  }
  if (!token) return;
  // 动态路由匹配：product/edit/:id / product/new
  let routed = v;
  if (v.startsWith('product/edit/') || v === 'product/new' || VIEW_TITLES[v]) {
    go(routed);
  } else {
    // 未匹配，跳回概览
    go('dashboard');
  }
});"""
assert old_hashchange in html, "hashchange not found"
html = html.replace(old_hashchange, new_hashchange)

# ========= 4. 修改商品管理中的「新增/编辑」按钮：从弹窗 → 路由跳转 =========
old_add_btn = """          <button class="btn-primary btn-sm" onclick="productForm()">+ 新增商品</button>"""
new_add_btn = """          <button class="btn-primary btn-sm" onclick="go('product/new')">+ 新增商品</button>"""
assert old_add_btn in html, "add product button not found"
html = html.replace(old_add_btn, new_add_btn)

old_edit_btn = """              <button class="btn-sm primary" onclick="productForm(${p.id})">编辑</button>"""
new_edit_btn = """              <button class="btn-sm primary" onclick="go('product/edit/' + ${p.id})">编辑</button>"""
assert old_edit_btn in html, "edit product button not found"
html = html.replace(old_edit_btn, new_edit_btn)

# ========= 5. 替换 productForm 函数（弹窗→跳转）+ 新增 loadProductEdit 完整独立页面 =========
old_product_block = """function productForm(id) {
  const p = id ? productsCache.find(x => x.id === id) : null;
  openModal(p ? '编辑商品' : '新增商品', `
    <div class="form-grid">
      <div class="form-row"><label>SKU *</label><input id="pf-sku" value="${esc(p ? p.sku : '')}" placeholder="唯一编码"></div>
      <div class="form-row"><label>类目</label><input id="pf-cat" value="${esc(p ? p.category : '')}" placeholder="如：Home & Kitchen"></div>
    </div>
    <div class="form-row"><label>商品名称 *</label><input id="pf-name" value="${esc(p ? p.name : '')}" placeholder="商品标题"></div>
    <div class="form-grid">
      <div class="form-row"><label>售价（¥）</label><input id="pf-price" type="number" step="0.01" min="0" value="${p ? p.price : ''}"></div>
      <div class="form-row"><label>成本（¥）</label><input id="pf-cost" type="number" step="0.01" min="0" value="${p ? p.cost : ''}"></div>
    </div>`,
    `<button class="btn-ghost" onclick="closeModal()">取消</button>
     <button class="btn-primary" onclick="saveProduct(${id || 0})">保存</button>`);
}

async function saveProduct(id) {
  try {
    const body = {
      sku: document.getElementById('pf-sku').value.trim(),
      name: document.getElementById('pf-name').value.trim(),
      category: document.getElementById('pf-cat').value.trim() || null,
      price: Number(document.getElementById('pf-price').value) || 0,
      cost: Number(document.getElementById('pf-cost').value) || 0
    };
    if (!body.sku || !body.name) return toast('SKU 与名称必填', 'err');
    await api('/products' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
    closeModal(); toast(id ? '商品已更新' : '商品已创建', 'ok');
    loadProducts();
  } catch (e) { toast(e.message, 'err'); }
}

async function delProduct(id, sku) {
  if (!confirm(`确定删除商品「${sku}」？仅可删除无库存商品。`)) return;
  try { await api('/products/' + id, 'DELETE'); toast('已删除', 'ok'); loadProducts(); }
  catch (e) { toast(e.message, 'err'); }
}"""

new_product_block = """function productForm(id) {
  // 兼容调用（从弹窗改为独立页面路由）
  if (id) go('product/edit/' + id);
  else go('product/new');
}

/** 独立完整页面：新增 / 编辑商品 */
async function loadProductEdit(args) {
  const action = (args && args.action) || 'new';
  const id = (args && args.id) || null;
  let p = null;
  if (action === 'edit' && id) {
    try {
      // 优先从缓存取，否则单独 GET
      const fromCache = productsCache && productsCache.find(x => String(x.id) === String(id));
      p = fromCache || (await api('/products/' + id));
    } catch (e) {
      toast('商品不存在或已删除', 'err');
      go('products');
      return;
    }
  }
  const pageTitle = action === 'edit' ? '编辑商品' : '新增商品';
  document.getElementById('content').innerHTML = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">
      <button class="btn-ghost btn-sm" onclick="go('products')">← 返回商品列表</button>
      <div style="flex:1">
        <h2 style="margin:0;font-size:18px;color:var(--text-1)">${pageTitle}</h2>
        <p style="margin:4px 0 0;font-size:13px;color:var(--text-3)">${action === 'edit' ? '修改商品基础信息、价格与成本。保存后立即生效。' : '填写商品基础信息、价格与成本，创建后可继续管理库存与刊登。'}</p>
      </div>
      ${action === 'edit' ? `<button class="btn-danger btn-sm" onclick="delProduct(${p.id}, '${esc(p && p.sku || '')}', true)">删除商品</button>` : ''}
    </div>

    <div class="card" style="padding:28px">
      <div style="max-width:780px;margin:0 auto">

        <div class="section-block">
          <div class="section-title">基础信息</div>
          <div class="form-grid">
            <div class="form-row">
              <label>SKU 编码 <span class="req">*</span></label>
              <input id="pf-sku" value="${esc(p ? p.sku : '')}" placeholder="唯一识别编码，如 SKU-0001" style="width:100%">
              <p class="field-hint">建议使用稳定且唯一的编码，创建后建议不要频繁修改。</p>
            </div>
            <div class="form-row">
              <label>所属类目</label>
              <input id="pf-cat" value="${esc(p ? p.category : '')}" placeholder="如：Home & Kitchen / 电子产品 / 服饰" style="width:100%">
            </div>
          </div>
          <div class="form-row">
            <label>商品名称 <span class="req">*</span></label>
            <input id="pf-name" value="${esc(p ? p.name : '')}" placeholder="商品标题，建议包含核心关键词" style="width:100%">
          </div>
        </div>

        <div class="section-block">
          <div class="section-title">价格与成本</div>
          <div class="form-grid">
            <div class="form-row">
              <label>售价（¥）</label>
              <input id="pf-price" type="number" step="0.01" min="0" value="${p ? p.price : ''}" placeholder="商品销售价" style="width:100%">
              <p class="field-hint">订单金额将以此单价为基础计算。</p>
            </div>
            <div class="form-row">
              <label>成本（¥）</label>
              <input id="pf-cost" type="number" step="0.01" min="0" value="${p ? p.cost : ''}" placeholder="商品采购/生产成本" style="width:100%">
              <p class="field-hint">用于利润看板统计毛利率，建议准确填写。</p>
            </div>
          </div>
        </div>

        <div class="section-block">
          <div class="section-title">当前状态 <span style="font-weight:400;font-size:12px;color:var(--text-3);margin-left:8px">（仅编辑模式可见）</span></div>
          ${action === 'edit' ? `
          <div class="form-grid">
            <div class="stat-mini"><div class="s-label">在库数量</div><div class="s-value">${p && p.qty_on_hand != null ? p.qty_on_hand : 0}</div></div>
            <div class="stat-mini"><div class="s-label">订单占用</div><div class="s-value">${p && p.qty_reserved != null ? p.qty_reserved : 0}</div></div>
            <div class="stat-mini"><div class="s-label">可用库存</div><div class="s-value"><b>${p && p.qty_available != null ? p.qty_available : 0}</b></div></div>
            <div class="stat-mini"><div class="s-label">最近更新</div><div class="s-value" style="font-size:13px">${p && p.updated_at ? fmtDate(p.updated_at) : '-'}</div></div>
          </div>` : `
          <div class="hint-box">新建后可在「库存管理」中对该商品进行入库 / 出库操作。</div>
          `}
        </div>

        <div style="margin-top:28px;display:flex;justify-content:flex-end;gap:10px">
          <button class="btn-ghost" onclick="go('products')">取消并返回</button>
          <button id="pf-save-btn" class="btn-primary" onclick="saveProduct(${action === 'edit' && id ? id : 0})">${action === 'edit' ? '保存修改' : '创建商品'}</button>
        </div>

      </div>
    </div>

    <style>
    .section-block{margin-bottom:28px;padding-bottom:20px;border-bottom:1px dashed var(--border)}
    .section-block:last-of-type{border-bottom:none;margin-bottom:0;padding-bottom:0}
    .section-title{font-size:14px;font-weight:600;color:var(--text-1);margin-bottom:14px;padding-left:10px;border-left:3px solid var(--primary)}
    .field-hint{font-size:12px;color:var(--text-3);margin:6px 2px 0}
    .req{color:#ef4444}
    .stat-mini{padding:14px 16px;border-radius:12px;background:linear-gradient(180deg, #f8fafc, #f1f5f9);border:1px solid var(--border)}
    .stat-mini .s-label{font-size:12px;color:var(--text-3);margin-bottom:4px}
    .stat-mini .s-value{font-size:18px;font-weight:600;color:var(--text-1)}
    .hint-box{padding:14px 16px;background:#eff6ff;border-radius:10px;color:#1d4ed8;font-size:13px;border:1px solid #bfdbfe}
    .form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
    @media (max-width:640px){.form-grid{grid-template-columns:1fr}}
    .form-row label{display:block;font-size:13px;color:var(--text-2);margin-bottom:6px;font-weight:500}
    .form-row input,.form-row select,.form-row textarea{padding:10px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;background:#fff;transition:all .15s}
    .form-row input:focus,.form-row select:focus,.form-row textarea:focus{outline:none;border-color:var(--primary);box-shadow:0 0 0 3px rgba(59,130,246,.12)}
    </style>`;
  // 编辑模式自动聚焦 SKU 字段
  setTimeout(() => {
    const f = document.getElementById('pf-sku');
    if (f && action === 'new') f.focus();
  }, 50);
}

async function saveProduct(id) {
  try {
    const body = {
      sku: document.getElementById('pf-sku').value.trim(),
      name: document.getElementById('pf-name').value.trim(),
      category: document.getElementById('pf-cat').value.trim() || null,
      price: Number(document.getElementById('pf-price').value) || 0,
      cost: Number(document.getElementById('pf-cost').value) || 0
    };
    if (!body.sku || !body.name) return toast('SKU 与名称必填', 'err');
    const btn = document.getElementById('pf-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = id ? '保存中…' : '创建中…'; }
    await api('/products' + (id ? '/' + id : ''), id ? 'PATCH' : 'POST', body);
    toast(id ? '商品已更新' : '商品已创建', 'ok');
    // 独立页面保存后返回商品列表
    go('products');
  } catch (e) {
    const btn = document.getElementById('pf-save-btn');
    if (btn) { btn.disabled = false; btn.textContent = id ? '保存修改' : '创建商品'; }
    toast(e.message, 'err');
  }
}

async function delProduct(id, sku, fromEditPage) {
  if (!confirm(`确定删除商品「${sku}」？仅可删除无库存商品。`)) return;
  try {
    await api('/products/' + id, 'DELETE');
    toast('已删除', 'ok');
    if (fromEditPage) go('products');
    else loadProducts();
  } catch (e) { toast(e.message, 'err'); }
}"""

assert old_product_block in html, "product block not found (productForm/saveProduct/delProduct)"
html = html.replace(old_product_block, new_product_block)

# ========= 6. 确保 goods/products-v2 里的编辑按钮也跳转独立页（如有） =========
# 搜索 products-v2 页中的「编辑」按钮（如有调用 productForm 的一并改）
if "productForm(p" in html:
    # 替换所有 productForm(p.id) → go('product/edit/' + p.id) 等
    html = re.sub(r"productForm\(([^)]+)\)", lambda m: f"go('product/edit/' + {m.group(1)})", html)
    # 但上面 productForm 函数本身调用要保留，手动改回：
    html = html.replace("  // 兼容调用（从弹窗改为独立页面路由）\n  if (id) go('product/edit/' + id);\n  else go('product/new');",
                        "  // 兼容调用（从弹窗改为独立页面路由）\n  if (id) go('product/edit/' + id);\n  else go('product/new');")

# 写回
if html != original:
    with open(PATH, 'w', encoding='utf-8') as f:
        f.write(html)
    print(f"[OK] B5 applied: {PATH}")
else:
    print("[NOCHANGE] B5: no modifications applied")
    sys.exit(1)
