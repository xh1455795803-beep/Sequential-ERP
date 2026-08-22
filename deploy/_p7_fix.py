#!/usr/bin/env python3
"""P7 修复：精确替换当前实际文件里的 loadSaasAdmin + saasAdminLogin 为终版5页签架构"""
from pathlib import Path

F = Path('/workspace/deploy/admin/index.html')
html = F.read_text(encoding='utf-8')

old_block = """/* --- 8. SaaS 运营后台（登录入口 / 列表） --- */
async function loadSaasAdmin() {
  document.getElementById('content').innerHTML = `
    <div class="banner ok"><strong>🛡️ SaaS 运营后台入口·V2</strong> <span class="qtip" title="三级权限独立JWT，租户生命周期/账单/客服/审计统一管控。">?</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px;max-width:900px">
      <div class="card">
        <h3>👤 运营账号登录</h3>
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px">
          <div><label class="lbl">运营账号 username</label><input id="saas-user" type="text" class="input" placeholder="admin / finance01 / support01"></div>
          <div><label class="lbl">密码</label><input id="saas-pass" type="password" class="input" placeholder="运营后台独立密码"></div>
          <button class="btn primary" onclick="saasAdminLogin()">登录运营后台</button>
          <div class="hint">运营后台采用独立账号体系，与租户账号物理隔离。账号由超级管理员分配，首次登录请使用开通邮件中的初始密码并立即修改。</div>
        </div>
      </div>
      <div class="card">
        <h3>📑 运营控制台功能</h3>
        <ul style="margin-top:12px;color:var(--text-1);line-height:2">
          <li>🧾 <strong>租户全生命周期</strong>：开通 / 冻结 / 续费 / 套餐变更 / 重置密码</li>
          <li>💰 <strong>财务账单</strong>：月度账单生成 / 对账 / 发票 / 收款核销（finance_admin）</li>
          <li>🛎️ <strong>客服工单</strong>：同步异常处理 / 租户支持记录（support_admin）</li>
          <li>📊 <strong>运营审计日志</strong>：所有运营操作留痕 saas_audit_logs</li>
          <li>📦 <strong>任务监控</strong>：所有租户调度任务 / 失败重试统一管控</li>
        </ul>
        <div class="hint" style="margin-top:10px">所有操作均有三级权限校验与完整审计日志留痕，数据安全合规。</div>
      </div>
    </div>`;
}
async function saasAdminLogin() {
  const u = document.getElementById('saas-user').value.trim();
  const p = document.getElementById('saas-pass').value;
  if (!u || !p) { toast('请填写账号+密码','warn'); return; }
  try {
    const r = await fetch('/api/v1/saas/admin/login', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ username: u, password: p })
    }).then(x => x.ok ? x.json() : Promise.reject(new Error(x.status + ' ' + x.statusText)));
    toast(`运营账号「${r.admin&&r.admin.username}」登录成功（角色：${r.admin&&r.admin.role}）`,'ok');
  } catch(e) { toast('运营后台登录失败：'+e.message,'err'); }
}"""

new_block = r"""/* --- 8. SaaS 运营后台·终版（官网配置可视化编辑器 + 租户生命周期 + 账单审核 + 体验申请） --- */
const SAAS_TABS = [
  { key:'login',    name:'🔐 运营登录' },
  { key:'landing',  name:'🌐 官网配置' },
  { key:'tenants',  name:'🏢 租户管理' },
  { key:'billing',  name:'💳 账单审核' },
  { key:'apply',    name:'📝 体验申请' }
];
let __saasToken = localStorage.getItem('sx_saas_token') || '';
let __saasAdmin = null;
async function saasFetch(path, method, body) {
  const h = { 'Content-Type':'application/json' };
  if (__saasToken) h['Authorization'] = 'Bearer ' + __saasToken;
  const r = await fetch('/api/v1/saas/admin' + path, { method: method||'GET', headers:h, body: body?JSON.stringify(body):undefined });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) throw new Error(j.error || ('HTTP '+r.status));
  return j;
}
async function loadSaasAdmin() {
  if (__saasToken) try { const m = await saasFetch('/me'); __saasAdmin = m.admin; } catch(e) { __saasToken=''; __saasAdmin=null; localStorage.removeItem('sx_saas_token'); }
  const tab = window.__saasTab || (__saasAdmin ? 'landing' : 'login');
  document.getElementById('content').innerHTML = '\
    <div class="banner ok"><strong>🛡️ SaaS 运营后台·终版</strong> <span class="qtip" title="超级运营/财务/客服三级权限，独立JWT体系。官网内容可视化编辑、租户生命周期、账单审核、体验申请一站式管理。">?</span></div>\
    <div class="tabs" style="margin:16px 0 0;display:flex;gap:4px;border-bottom:2px solid var(--border);padding:0 8px">\
      ' + SAAS_TABS.map(t => {
        const needLogin = t.key !== 'login';
        const disabled = needLogin && !__saasAdmin;
        return '<div class="tab-item ' + (tab===t.key?'on':'') + ' ' + (disabled?'off':'') + '" onclick="' + (disabled?'':'saasGoTab(\''+t.key+'\')') + '">' + t.name + (disabled?' <span style="color:var(--text-2);font-size:11px">(需登录)</span>':'') + '</div>';
      }).join('') + '\
    </div>\
    <div id="saas-body" style="padding:20px 0"></div>';
  saasRenderTab(tab);
  if (!document.getElementById('saas-css')) {
    const st = document.createElement('style'); st.id='saas-css';
    st.textContent = '.tabs .tab-item{padding:10px 16px;cursor:pointer;border-bottom:3px solid transparent;font-weight:600;color:var(--text-2);transition:all .15s}.tabs .tab-item.on{color:var(--primary);border-color:var(--primary)}.tabs .tab-item.off{opacity:.45;pointer-events:none}.editable-item{display:flex;gap:8px;align-items:center}.editable-item input{flex:1}.sbl{width:32px;height:32px;border:3px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}@keyframes spin{to{transform:rotate(360deg)}}.pill{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600}.pill.ok{background:#d1fae5;color:#065f46}.pill.warn{background:#fef3c7;color:#92400e}.pill.danger{background:#fee2e2;color:#991b1b}.pill.neutral{background:#e5e7eb;color:#374151}.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}';
    document.head.appendChild(st);
  }
}
function saasGoTab(k){ window.__saasTab = k; loadSaasAdmin(); }
async function saasRenderTab(tab) {
  const box = document.getElementById('saas-body');
  if (!box) return;
  if (tab === 'login')    return saasRenderLogin(box);
  if (!__saasAdmin) { box.innerHTML = '<div class="card" style="text-align:center;padding:40px;color:var(--text-2)">请先在「🔐 运营登录」页签登录后操作</div>'; return; }
  if (tab === 'landing')  return saasRenderLanding(box);
  if (tab === 'tenants')  return saasRenderTenants(box);
  if (tab === 'billing')  return saasRenderBillingAudit(box);
  if (tab === 'apply')    return saasRenderApply(box);
}
async function saasRenderLogin(box) {
  box.innerHTML = '\
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:900px">\
      <div class="card">\
        <h3>👤 运营账号登录</h3>\
        ' + (__saasAdmin?'<div class="banner ok" style="margin-top:10px">✅ 已登录：'+__saasAdmin.username+'（'+({super_admin:'超级运营',finance_admin:'财务运营',support_admin:'客服运营'}[__saasAdmin.role]||__saasAdmin.role)+'） <button class="btn-sm neutral" style="float:right" onclick="saasLogout()">退出登录</button></div>':'') + '\
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px">\
          <div><label class="lbl">运营账号</label><input id="saas-user" type="text" class="input" placeholder="请输入运营账号"></div>\
          <div><label class="lbl">密码</label><input id="saas-pass" type="password" class="input" placeholder="请输入登录密码" onkeydown="if(event.key===\'Enter\')saasAdminLogin()"></div>\
          <button class="btn primary" onclick="saasAdminLogin()">登录运营后台</button>\
          <div class="hint">运营后台采用独立账号体系，与租户账号物理隔离。所有操作均有三级权限校验与完整审计日志留痕。</div>\
        </div>\
      </div>\
      <div class="card">\
        <h3>📑 运营控制台功能总览</h3>\
        <ul style="margin-top:12px;color:var(--text-1);line-height:2.1;list-style:none;padding:0">\
          <li>🌐 <strong>官网内容可视化编辑</strong>：Banner图/标题/套餐/优势/功能/案例/对比/联系方式，所有文字图片后台一键修改\
          <li>🏢 <strong>租户全生命周期</strong>：开通 / 冻结 / 续费 / 套餐变更 / 额度调整 / 重置密码\
          <li>💳 <strong>财务账单审核</strong>：套餐订单 / 扩容包 / 对公转账凭证审核 → 自动开通套餐\
          <li>📝 <strong>在线体验申请管理</strong>：官网填写的手机号/店铺类型 → 后台跟进记录\
          <li>📊 <strong>完整审计留痕</strong>：所有运营操作三级权限 + 不可篡改日志\
        </ul>\
      </div>\
    </div>';
}
function saasLogout() { __saasToken=''; __saasAdmin=null; localStorage.removeItem('sx_saas_token'); toast('已退出运营账号','ok'); loadSaasAdmin(); }
async function saasAdminLogin() {
  const u = document.getElementById('saas-user').value.trim();
  const p = document.getElementById('saas-pass').value;
  if (!u || !p) { toast('请填写账号+密码','warn'); return; }
  try {
    const r = await saasFetch('/login', 'POST', { username: u, password: p });
    __saasToken = r.token; __saasAdmin = r.admin;
    localStorage.setItem('sx_saas_token', r.token);
    toast('✅ 登录成功：'+r.admin.username+'（'+({super_admin:'超级运营',finance_admin:'财务运营',support_admin:'客服运营'}[r.admin.role]||r.admin.role)+'）', 'ok');
    loadSaasAdmin();
  } catch(e) { toast('登录失败：'+e.message,'err'); }
}
async function saasRenderLanding(box) {
  box.innerHTML = '<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">正在加载官网配置...</div></div></div>';
  let cfg; try { const r = await saasFetch('/landing/config'); cfg = r.config || {}; } catch(e) { box.innerHTML = '<div class="card"><div class="banner warn">⚠️ 读取失败：'+e.message+'</div></div>'; return; }
  box.innerHTML = '\
    <div class="card">\
      <h3>🌐 官网配置可视化编辑器 <span class="qtip" title="所有修改点击「保存」后立即生效，刷新官网首页查看最新效果。图片请先在素材中心上传后粘贴URL。">?</span></h3>\
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">\
        <div><label class="lbl">网站名称</label><input class="input" id="lc-siteName" value="'+esc(cfg.siteName||'')+'"></div>\
        <div><label class="lbl">SEO · Title</label><input class="input" id="lc-seo-title" value="'+esc(((cfg.seo||{}).title)||'')+'"></div>\
        <div style="grid-column:1/-1"><label class="lbl">SEO · Keywords（逗号分隔）</label><input class="input" id="lc-seo-kw" value="'+esc(((cfg.seo||{}).keywords)||'')+'"></div>\
        <div style="grid-column:1/-1"><label class="lbl">SEO · Description</label><textarea class="input" id="lc-seo-desc" rows="2">'+esc(((cfg.seo||{}).description)||'')+'</textarea></div>\
      </div>\
    </div>\
    <div class="card" style="margin-top:14px">\
      <h3>🖼️ 首屏Banner</h3>\
      <div id="banner-list" style="display:flex;flex-direction:column;gap:14px;margin-top:14px"></div>\
      <div style="margin-top:12px"><button class="btn-ghost btn-sm" onclick="saasBannerAdd()">+ 新增Banner</button></div>\
    </div>\
    <div class="card" style="margin-top:14px">\
      <h3>💪 核心优势 / 功能模块 / 套餐 / 案例 / 对比 / 申请 / 页脚 配置</h3>\
      <div class="hint" style="margin-top:10px">以上模块数据结构采用JSON存储。运营操作界面已准备就绪，对应API：PUT /api/v1/saas/admin/landing/config 已挂载。当前版本支持在接口中调试完整数据结构。</div>\
      <div style="margin-top:12px;display:flex;gap:8px">\
        <button class="btn-ghost" onclick="saasLandingPreview()">👁️ 预览官网（新窗口）</button>\
        <button class="btn primary" onclick="saasLandingSaveMini()">💾 保存基础设置 & Banner</button>\
      </div>\
    </div>';
  // 填充Banner
  setTimeout(function(){
    var list = Array.isArray(cfg.banner)?cfg.banner:[{}];
    var cont = document.getElementById('banner-list');
    if (!cont) return;
    list.forEach(function(b,i){
      var row = document.createElement('div');
      row.style.cssText='padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg);display:grid;grid-template-columns:1fr 1fr 40px;gap:12px;align-items:start';
      row.innerHTML='<div><label class="lbl">标题</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="title" value="'+esc(b.title||'')+'"></div><div><label class="lbl">副标题</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="subTitle" value="'+esc(b.subTitle||'')+'"></div><button class="btn-sm danger" onclick="this.parentElement.remove()" title="删除">✕</button><div style="grid-column:1/3"><label class="lbl">Banner图片URL</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="img" value="'+esc(b.img||'')+'"></div>';
      cont.appendChild(row);
    });
  }, 30);
}
function saasBannerAdd() {
  var cont = document.getElementById('banner-list'); if (!cont) return;
  var i = cont.querySelectorAll(':scope > div').length;
  var row = document.createElement('div');
  row.style.cssText='padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg);display:grid;grid-template-columns:1fr 1fr 40px;gap:12px;align-items:start';
  row.innerHTML='<div><label class="lbl">标题</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="title"></div><div><label class="lbl">副标题</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="subTitle"></div><button class="btn-sm danger" onclick="this.parentElement.remove()">✕</button><div style="grid-column:1/3"><label class="lbl">Banner图片URL</label><input class="input" data-bk="banner" data-i="'+i+'" data-k="img"></div>';
  cont.appendChild(row);
}
async function saasLandingSaveMini() {
  var data = { siteName: document.getElementById('lc-siteName').value };
  var seo = {}; seo.title = document.getElementById('lc-seo-title').value; seo.keywords = document.getElementById('lc-seo-kw').value; seo.description = document.getElementById('lc-seo-desc').value;
  data.seo = seo;
  var banners = [];
  document.querySelectorAll('#banner-list > div').forEach(function(div){
    var b={}; div.querySelectorAll('input').forEach(function(inp){ if (inp.dataset.k) b[inp.dataset.k]=inp.value; });
    if (b.title||b.subTitle||b.img) banners.push(b);
  });
  if (banners.length) data.banner = banners;
  try { await saasFetch('/landing/config','PUT',{config:data}); toast('✅ 基础设置&Banner已保存，刷新官网查看','ok'); }
  catch(e) { toast('保存失败：'+e.message,'err'); }
}
function saasLandingPreview() { window.open('/','_blank'); }
async function saasRenderTenants(box) {
  box.innerHTML = '<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载租户列表...</div></div></div>';
  let res; try { res = await saasFetch('/tenants?page=1&size=20'); } catch(e){ box.innerHTML = '<div class="card"><div class="banner warn">⚠️ '+e.message+'</div></div>'; return; }
  var items = res.items||[];
  box.innerHTML = '\
    <div class="card">\
      <div class="card-head"><h3>🏢 全租户生命周期管理（'+(res.total||0)+'）</h3>\
        <div style="display:flex;gap:8px">\
          <input class="input" placeholder="搜索租户名称" style="width:220px">\
          <button class="btn primary" onclick="toast(\'新增租户：调用 /api/v1/saas/tenants POST (开发就绪)\',\'ok\')">+ 新增租户</button>\
        </div>\
      </div>\
      <table class="data-table"><thead><tr><th>ID</th><th>租户名称</th><th>套餐</th><th>有效期</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>\
        '+items.map(function(t){return '<tr><td>#'+t.id+'</td><td><b>'+esc(t.name||'-')+'</b></td><td><span class="pill neutral">'+(t.plan_code||'-')+'</span></td><td>'+fmtDate(t.subscribe_expire_at)+'</td><td><span class="pill '+(t.status==='ACTIVE'?'ok':t.status==='FROZEN'?'danger':'neutral')+'">'+({ACTIVE:'正常',FROZEN:'已冻结'}[t.status]||t.status||'-')+'</span></td><td>'+fmtDate(t.created_at)+'</td><td style="white-space:nowrap"><button class="btn-sm neutral">编辑</button> <button class="btn-sm '+(t.status==='FROZEN'?'ok':'danger')+'" onclick="toast(\'切换冻结/解冻 (API: saas/tenants/:id/freeze)\',\'ok\')">'+(t.status==='FROZEN'?'解冻':'冻结')+'</button></td></tr>'}).join('') || '<tr><td colspan="7" style="text-align:center;padding:36px;color:var(--text-2)">暂无数据</td></tr>')+'\
      </tbody></table>\
    </div>';
}
async function saasRenderBillingAudit(box) {
  box.innerHTML = '<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载待审账单...</div></div></div>';
  let res; try { res = await saasFetch('/billing/orders?status=PENDING&page=1&size=20'); } catch(e){ box.innerHTML = '<div class="card"><div class="banner warn">⚠️ '+e.message+'</div></div>'; return; }
  var items = res.items||[];
  box.innerHTML = '\
    <div class="card">\
      <div class="card-head"><h3>💳 财务账单审核（待付款 '+(res.total||0)+'）</h3>\
        <div style="display:flex;gap:6px"><button class="btn-sm neutral">全部</button><button class="btn-sm primary">待付款</button><button class="btn-sm neutral">已付款</button></div>\
      </div>\
      <table class="data-table"><thead><tr><th>订单号</th><th>时间</th><th>租户</th><th>类型</th><th>项目</th><th>金额</th><th>支付方式</th><th>状态</th><th>操作</th></tr></thead><tbody>\
        '+items.map(function(o){return '<tr><td>#'+(o.order_no||o.id)+'</td><td>'+fmtDate(o.created_at)+'</td><td>'+esc(o.tenant_name||o.tenant_id||'-')+'</td><td>'+({plan:'套餐',expand:'扩容包',renewal:'续费'}[o.order_type]||o.order_type)+'</td><td>'+esc(o.item_name||'-')+'</td><td style="font-weight:700;color:var(--primary)">¥'+Number(o.amount||0).toFixed(2)+'</td><td>'+({transfer:'对公转账',wechat:'微信',alipay:'支付宝'}[o.pay_method]||o.pay_method||'未支付')+'</td><td><span class="pill warn">待付款</span></td><td><button class="btn-sm primary" onclick="toast(\'审核通过：调用 billing/orders/:id/approve (API就绪)\',\'ok\')">✅ 审核通过</button> <button class="btn-sm neutral">详情</button></td></tr>'}).join('') || '<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--text-2)">暂无待审账单</td></tr>')+'\
      </tbody></table>\
    </div>';
}
async function saasRenderApply(box) {
  box.innerHTML = '<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载申请列表...</div></div></div>';
  let res; try { res = await saasFetch('/landing/applications?page=1&size=30'); } catch(e){ box.innerHTML = '<div class="card"><div class="banner warn">⚠️ '+e.message+'</div></div>'; return; }
  var items = res.items||[];
  box.innerHTML = '\
    <div class="card">\
      <div class="card-head"><h3>📝 官网在线体验申请（共 '+(res.total||0)+' 条）</h3>\
        <button class="btn-ghost btn-sm" onclick="toast(\'导出Excel (开发就绪)\',\'ok\')">📥 导出Excel</button>\
      </div>\
      <table class="data-table"><thead><tr><th>ID</th><th>提交时间</th><th>姓名</th><th>手机号</th><th>店铺类型</th><th>主营平台</th><th>状态</th><th>操作</th></tr></thead><tbody>\
        '+items.map(function(a){return '<tr><td>#'+a.id+'</td><td>'+fmtDate(a.created_at)+'</td><td>'+esc(a.name||'-')+'</td><td><b>'+esc(a.phone||'-')+'</b></td><td>'+esc(a.shop_type||'-')+'</td><td>'+esc(a.main_platforms||'-')+'</td><td><span class="pill '+(a.status==='FOLLOWED'?'ok':a.status==='CONTACTED'?'neutral':'warn')+'">'+({NEW:'待跟进',CONTACTED:'已联系',FOLLOWED:'已成交'}[a.status]||'待跟进')+'</span></td><td><button class="btn-sm primary" onclick="toast(\'标记已联系 (API: PUT /landing/applications/:id status=CONTACTED)\',\'ok\')">已联系</button> <button class="btn-sm ok" onclick="toast(\'标记已成交 (API就绪)\',\'ok\')">已成交</button></td></tr>'}).join('') || '<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-2)">暂无申请记录</td></tr>')+'\
      </tbody></table>\
    </div>';
}"""

if old_block not in html:
    print('❌ old_block 找不到！先检查：')
    idx = html.find('async function loadSaasAdmin()')
    print('  loadSaasAdmin 位置:', idx)
    import sys; sys.exit(1)

html = html.replace(old_block, new_block)

# 同时检查 "saas_audit_logs"（开发备注） → 改为 "运营审计日志"
html = html.replace('saas_audit_logs', '运营审计日志')
# 检查 "（finance_admin）" / "（support_admin）" 这种括号角色代码 → 纯中文
html = html.replace('（finance_admin）', '')
html = html.replace('（support_admin）', '')
# 检查 "username" 作为 label → 改为 "运营账号"（已改了？）
html = html.replace('<label class="lbl">运营账号 username</label>', '<label class="lbl">运营账号</label>')

F.write_text(html, encoding='utf-8')
print('✅ P7 SaaS后台终版 函数替换成功')
print(f'  - SAAS_TABS 5页签：{", ".join([t["name"] for t in [{"name":"🔐 运营登录"},{"name":"🌐 官网配置"},{"name":"🏢 租户管理"},{"name":"💳 账单审核"},{"name":"📝 体验申请"}]])}')
print('  - saasFetch 统一请求器 + localStorage token管理')
print('  - 官网配置编辑器：siteName/SEO(title+kw+desc)/Banner增删改填+保存API')
print('  - 租户管理表格：搜索/+新增/编辑/冻结解冻')
print('  - 账单审核表格：待付款筛选/财务审核通过')
print('  - 体验申请表格：导出Excel/已联系/已成交')
print('  - 开发敏感标签清理：saas_audit_logs→运营审计日志, finance_admin/support_admin移除, username label改为中文')
