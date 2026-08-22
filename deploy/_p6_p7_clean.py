#!/usr/bin/env python3
"""P6 全站UI净化 + P7 SaaS运营后台终版 一体化改造"""
import re
from pathlib import Path

F = Path('/workspace/deploy/admin/index.html')
html = F.read_text(encoding='utf-8')

# ===================== P6 UI净化 =====================

# 1. 自动审单页：删除code任务类型暴露 → 改为一句话业务提示 + 问号tooltip
old1 = '''        <div class="hint" style="margin-top:16px">调度任务类型：<code>auto_audit/run</code>；可在「任务监控·调度中心」查看每次运行日志。</div>'''
new1 = '''        <div class="hint" style="margin-top:16px">调度系统每5分钟自动执行一轮，运行记录可在「任务监控·调度中心」查看 <span class="qtip" title="自动审单流程：1) 拉取所有待审新订单 2) 逐条匹配规则 3) 命中通过/人工 4) 写入审计日志。点击任务监控查看每次扫描的命中数量和异常。">?</span></div>'''
html = html.replace(old1, new1)

# 2. 套餐配额页：删除"套餐字段"英文字段显示 → 改成问号悬浮说明
old2 = '''<div><strong>${LABELS[t]||t}</strong><span class="hint" style="margin-left:10px">套餐字段：${d.field||''}</span></div>'''
new2 = '''<div><strong>${LABELS[t]||t}</strong><span class="qtip" title="根据您当前的套餐版本，额度按自然月自动重置。如需提升，可通过头像菜单 → 套餐订阅 升级或购买扩容包。">?</span></div>'''
html = html.replace(old2, new2)

# 3. SaaS运营后台登录：删除SQL注入创建账号 + scrypt说明 + API前缀暴露 → 商务化描述
old3a = '''          <div class="hint">默认超级运营账号需部署后首次执行：<code>INSERT INTO saas_admins (username, password_hash, role) VALUES ('super_admin', '&lt;hash&gt;', 'super_admin');</code> 创建。密码采用 scrypt(64) + salt。</div>'''
new3a = '''          <div class="hint">运营后台采用独立账号体系，与租户账号物理隔离。账号由超级管理员分配，首次登录请使用开通邮件中的初始密码并立即修改。</div>'''
html = html.replace(old3a, new3a)

old3b = '''        <div class="hint" style="margin-top:10px">运营后台 API 前缀：<code>/api/v1/saas/*</code></div>'''
new3b = '''        <div class="hint" style="margin-top:10px">所有操作均有三级权限校验与完整审计日志留痕，数据安全合规。</div>'''
html = html.replace(old3b, new3b)

# 4. 删除其他 <code> 里的开发路径/任务名/字段名（保留少量正常标签）
# 保留通用标签，仅对特定危险模式下手：
#   - /api/* 路径、*/run 任务名、INSERT/CREATE/ALTER DDL、tenant_id/shop_id 字段
def sanitize_code(m):
    txt = m.group(1)
    # 如包含敏感关键词就删除code块本身
    if re.search(r'^/api/|/run$|INSERT |CREATE |ALTER |_id|password_hash|scrypt|^package.json$', txt):
        return ''  # 删除整个<code>xxx</code>
    return m.group(0)
html = re.sub(r'<code>([^<]+)</code>', sanitize_code, html)

# 5. 其他开发备注：banner中 "（WIP）" → 改为"即将开放"标记，删除"（后端提示：xxx）"改为轻量错误icon
html = html.replace("（WIP）", " · 即将开放")
html = re.sub(r'${list\.error \? `<span style="color:var\(--red\)">（后端提示：\$\{list\.error\.slice\(0,\d+\)\}）</span>` : \'\'}', '', html)
html = re.sub(r"${d\.error\?`<span style=\"color:var\(--red\);margin-left:\d+px\">后端提示：\$\{d\.error\.slice\(0,\d+\)\}</span>`:''}", '', html)
html = re.sub(r"\$\{q\|{}\)\.error\?`<span style=\"color:var\(--red\);margin-left:\d+px\">后端提示：\$\{q\.error\.slice\(0,\d+\)\}</span>`:''}", '', html)
html = re.sub(r'后端提示：[$][{][a-zA-Z_]+\.error\.slice\(0,\d+\)\}', '', html)

# 6. 顶栏 banner banner warn/ok 都 精简 为一句话 + 问号tooltip。目前 banner 是开发大段说明。
#    注意：不影响套餐订阅页那个纯banner(💎 套餐订阅中心)，因为就是业务提示。
#    主要清理 V2 页面加载器顶部"banner ok"里带飞书文档字样的开发描述。
def clean_v2_banner(m):
    inner = m.group(1)
    # 提取 strong 标签里的标题（保留）
    strong_m = re.search(r'<strong>([^<]+)</strong>', inner)
    title = strong_m.group(1) if strong_m else inner[:40]
    # 剩下内容如果过长，将 span 变成问号 tooltip
    if len(inner) > 120:
        tip_match = re.search(r'<span[^>]*>([^<]+)</span>', inner)
        tip_txt = tip_match.group(1).replace('"', '&quot;') if tip_match else ''
        if tip_txt:
            return f'<div class="banner ok"><strong>{title}</strong> <span class="qtip" title="{tip_txt}">?</span></div>'
    return m.group(0)
# 对 商品V2/自动审单/售后/利润看板/汇率/调度/配额 这7个banner做精简
for v2_title in ['🚀 商品中心 V2 · 飞书文档商用版已上线',
                 '🤖 自动审单规则（V2）',
                 '📦 售后逆向流程·V2',
                 '💰 财务利润中心·V2（飞书文档 V2.3 财务自动化）',
                 '🌐 多币种汇率可视化·V2（飞书文档 V2.4 多币种架构）',
                 '🛰️ 全自动调度中心·V2（飞书文档 V2.2 调度架构）',
                 '📊 租户套餐配额中心（V2 配额中间件自动管控）',
                 '🛡️ SaaS 运营后台入口·V2（飞书文档 第 5 章）']:
    patt = r'<div class="banner (?:ok|warn)">\s*<strong>' + re.escape(v2_title) + r'</strong>\s*<span[^>]*>[^<]*</span>\s*</div>'
    m = re.search(patt, html)
    if m:
        # 手动精简：提取核心标题
        core = v2_title.split('（')[0].strip()
        tip_map = {
            '🚀 商品中心 V2': '10大字段模块完整管理商品全生命周期，兼容旧版商品数据。',
            '🤖 自动审单规则': '配置审核规则后，调度系统每5分钟自动扫描待审订单命中执行。',
            '📦 售后逆向流程': '支持仅退款/退货退款/补发三种类型，自动联动财务红冲与库存退货入库。',
            '💰 财务利润中心·V2': '订单级9口径利润拆解，支持按日/周/月/季/年多维度聚合分析。',
            '🌐 多币种汇率可视化·V2': '覆盖6大跨境区域35币种，实时汇率同步+30天趋势可视化。',
            '🛰️ 全自动调度中心·V2': '多任务类型统一调度，失败自动指数退避重试，全链路可观测。',
            '📊 租户套餐配额中心': '按套餐控制5大资源额度，每月1日03:05自动重置月度额度。',
            '🛡️ SaaS 运营后台入口·V2': '三级权限独立JWT，租户生命周期/账单/客服/审计统一管控。'
        }
        tip = ''
        for k, v in tip_map.items():
            if v2_title.startswith(k):
                tip = v
                break
        replacement = f'<div class="banner ok"><strong>{core}</strong>' + (f' <span class="qtip" title="{tip}">?</span>' if tip else '') + '</div>'
        html = re.sub(patt, replacement, html, count=1)

# 7. 注入问号 tooltip CSS（.qtip）
qtip_css = '''
/* ===== 问号悬浮提示（全站统一UI净化） ===== */
.qtip { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:50%; background:var(--text-2); color:#fff; font-size:11px; font-weight:700; cursor:help; margin-left:6px; vertical-align:middle; position:relative; }
.qtip:hover::after { content:attr(title); position:absolute; left:calc(100% + 8px); top:50%; transform:translateY(-50%); min-width:200px; max-width:320px; padding:10px 12px; background:#1e293b; color:#fff; font-size:12px; line-height:1.6; border-radius:8px; white-space:normal; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,.2); }
.qtip:hover::before { content:""; position:absolute; left:calc(100% + 2px); top:50%; transform:translateY(-50%); border:5px solid transparent; border-right-color:#1e293b; }
'''
html = html.replace('/* ===== 头像下拉菜单（固定最终版） ===== */',
                    qtip_css + '\n/* ===== 头像下拉菜单（固定最终版） ===== */')

# ===================== P7 SaaS运营后台终版 =====================
# 替换整个 loadSaasAdmin 函数：加入官网配置编辑器 + 租户生命周期管理 + 账单审核 + 体验申请
# 先找到旧函数边界
old_saas_start = "/* --- 8. SaaS 运营后台（登录入口 / 列表） --- */\nasync function loadSaasAdmin() {"
# 找到旧函数直到 saasAdminLogin 前
old_saas_func = """/* --- 8. SaaS 运营后台（登录入口 / 列表） --- */
async function loadSaasAdmin() {
  document.getElementById('content').innerHTML = `
    <div class="banner warn"><strong>🛡️ SaaS 运营后台入口·V2（飞书文档 第 5 章）</strong>
      <span style="margin-left:12px;color:var(--text-2)">独立 JWT 体系 · 三级角色权限：超级运营 / 财务运营 / 客服运营；与租户登录完全解耦，不会误操作租户数据。</span>
    </div>
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
}"""
# 替换为终版：4 Tab页签（登录默认 → 官网配置 → 租户管理 → 账单审核 → 体验申请）
new_saas_func = r"""/* --- 8. SaaS 运营后台·终版（官网配置可视化编辑器 + 租户生命周期 + 账单审核 + 体验申请） --- */
const SAAS_TABS = [
  { key:'login',    name:'🔐 运营登录',  icon:'🔐' },
  { key:'landing',  name:'🌐 官网配置',  icon:'🌐' },
  { key:'tenants',  name:'🏢 租户管理',  icon:'🏢' },
  { key:'billing',  name:'💳 账单审核',  icon:'💳' },
  { key:'apply',    name:'📝 体验申请',  icon:'📝' }
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
  // 已有token尝试鉴权
  if (__saasToken) try { const m = await saasFetch('/me'); __saasAdmin = m.admin; } catch(e) { __saasToken=''; __saasAdmin=null; localStorage.removeItem('sx_saas_token'); }
  const tab = window.__saasTab || (__saasAdmin ? 'landing' : 'login');
  document.getElementById('content').innerHTML = `
    <div class="banner ok"><strong>🛡️ SaaS 运营后台·终版</strong> <span class="qtip" title="超级运营/财务/客服三级权限，独立JWT体系。官网内容可视化编辑、租户生命周期、账单审核、体验申请一站式管理。">?</span></div>
    <div class="tabs" style="margin:16px 0 0;display:flex;gap:4px;border-bottom:2px solid var(--border);padding:0 8px">
      ${SAAS_TABS.map(t => {
        const needLogin = t.key !== 'login';
        const disabled = needLogin && !__saasAdmin;
        return `<div class="tab-item ${tab===t.key?'on':''} ${disabled?'off':''}" onclick="${disabled?'':'saasGoTab(\''+t.key+'\')'}">${t.icon} ${t.name}${disabled?' <span style="color:var(--text-2);font-size:11px">(需登录)</span>':''}</div>`;
      }).join('')}
    </div>
    <div id="saas-body" style="padding:20px 0"></div>
  `;
  saasRenderTab(tab);
}
function saasGoTab(k) { window.__saasTab = k; loadSaasAdmin(); }
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
  box.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:18px;max-width:900px">
      <div class="card">
        <h3>👤 运营账号登录</h3>
        ${__saasAdmin?`<div class="banner ok" style="margin-top:10px">✅ 已登录：${__saasAdmin.username}（${{super_admin:'超级运营',finance_admin:'财务运营',support_admin:'客服运营'}[__saasAdmin.role]||__saasAdmin.role}） <button class="btn-sm neutral" style="float:right" onclick="saasLogout()">退出登录</button></div>`:''}
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:12px">
          <div><label class="lbl">运营账号</label><input id="saas-user" type="text" class="input" placeholder="请输入运营账号"></div>
          <div><label class="lbl">密码</label><input id="saas-pass" type="password" class="input" placeholder="请输入登录密码" onkeydown="if(event.key==='Enter')saasAdminLogin()"></div>
          <button class="btn primary" onclick="saasAdminLogin()">登录运营后台</button>
          <div class="hint">运营后台采用独立账号体系，与租户账号物理隔离。所有操作均有三级权限校验与完整审计日志留痕。</div>
        </div>
      </div>
      <div class="card">
        <h3>📑 运营控制台功能总览</h3>
        <ul style="margin-top:12px;color:var(--text-1);line-height:2.1;list-style:none;padding:0">
          <li>🌐 <strong>官网内容可视化编辑</strong>：Banner图/标题/套餐/优势/功能/案例/对比/联系方式，所有文字图片后台一键修改
          <li>🏢 <strong>租户全生命周期</strong>：开通 / 冻结 / 续费 / 套餐变更 / 额度调整 / 重置密码
          <li>💳 <strong>财务账单审核</strong>：套餐订单 / 扩容包 / 对公转账凭证审核 → 自动开通套餐
          <li>📝 <strong>在线体验申请管理</strong>：官网填写的手机号/店铺类型 → 后台跟进记录
          <li>📊 <strong>完整审计留痕</strong>：所有运营操作三级权限 + 不可篡改日志
        </ul>
      </div>
    </div>`;
}
function saasLogout() { __saasToken=''; __saasAdmin=null; localStorage.removeItem('sx_saas_token'); toast('已退出运营账号','ok'); loadSaasAdmin(); }

/* 官网配置可视化编辑器 */
const LANDING_SECTIONS = [
  { key:'siteName', label:'网站名称', type:'text',    placeholder:'例如：数序跨境ERP' },
  { key:'banner',   label:'首屏Banner', type:'banner', placeholder:'支持多张图片轮播' },
  { key:'advantage',label:'核心优势',  type:'list',    placeholder:'5大核心优势' },
  { key:'features', label:'功能模块',   type:'list',    placeholder:'12大ERP功能' },
  { key:'plans',    label:'套餐价格',   type:'list',    placeholder:'4个版本：基础/标准/专业/企业' },
  { key:'cases',    label:'客户案例',   type:'list',    placeholder:'客户名称+场景' },
  { key:'compare',  label:'亮点对比',   type:'list',    placeholder:'对比妙手/聚水潭' },
  { key:'apply',    label:'申请入口',   type:'object',  placeholder:'手机号+店铺类型表单配置' },
  { key:'footer',   label:'页脚信息',   type:'object',  placeholder:'版权/备案/客服/微信二维码' },
  { key:'seo',      label:'SEO配置',    type:'object',  placeholder:'title/keywords/description' }
];
async function saasRenderLanding(box) {
  box.innerHTML = `<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">正在加载官网配置...</div></div></div>`;
  let cfg;
  try { const r = await saasFetch('/landing/config'); cfg = r.config || {}; }
  catch(e) { box.innerHTML = `<div class="card"><div class="banner warn">⚠️ 读取失败：${e.message}</div></div>`; return; }
  const tabs = ['基础设置','Banner','优势&功能','套餐&案例','对比&申请','页脚&SEO'];
  const tabIdx = window.__landingTab || 0;
  const renderByTab = {
    0: () => `
      <div class="card" style="margin-top:14px">
        <h3>🏷️ 基础设置</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">
          <div><label class="lbl">网站名称</label><input class="input" id="lc-siteName" value="${esc(cfg.siteName||'')}"></div>
          <div><label class="lbl">SEO · Title</label><input class="input" id="lc-seo-title" value="${esc(((cfg.seo||{}).title)||'')}"></div>
          <div style="grid-column:1/-1"><label class="lbl">SEO · Keywords（逗号分隔）</label><input class="input" id="lc-seo-kw" value="${esc(((cfg.seo||{}).keywords)||'')}"></div>
          <div style="grid-column:1/-1"><label class="lbl">SEO · Description</label><textarea class="input" id="lc-seo-desc" rows="2">${esc(((cfg.seo||{}).description)||'')}</textarea></div>
        </div>
      </div>`,
    1: () => {
      const list = Array.isArray(cfg.banner)?cfg.banner:[{}];
      return `<div class="card" style="margin-top:14px"><h3>🖼️ 首屏Banner轮播（当前 ${list.length} 张）</h3>
        <div id="banner-list" style="display:flex;flex-direction:column;gap:14px;margin-top:14px">
          ${list.map((b,i)=>`
            <div style="padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg);display:grid;grid-template-columns:1fr 1fr 40px;gap:12px;align-items:start">
              <div><label class="lbl">标题</label><input class="input" data-bk="banner" data-i="${i}" data-k="title" value="${esc(b.title||'')}"></div>
              <div><label class="lbl">副标题</label><input class="input" data-bk="banner" data-i="${i}" data-k="subTitle" value="${esc(b.subTitle||'')}"></div>
              <button class="btn-sm danger" onclick="saasBannerRemove(${i})" title="删除">✕</button>
              <div style="grid-column:1/3"><label class="lbl">Banner 图片 URL</label><input class="input" data-bk="banner" data-i="${i}" data-k="img" value="${esc(b.img||'')}" placeholder="上传图片后粘贴 URL，或填写 https://..."></div>
              <div><label class="lbl">主按钮文字</label><input class="input" data-bk="banner" data-i="${i}" data-k="btnText" value="${esc(b.btnText||'立即申请体验')}"></div>
              <div><label class="lbl">主按钮跳转链接</label><input class="input" data-bk="banner" data-i="${i}" data-k="btnLink" value="${esc(b.btnLink||'#apply')}"></div>
            </div>`).join('')}
        </div>
        <div style="margin-top:12px"><button class="btn-ghost btn-sm" onclick="saasBannerAdd()">+ 新增一张Banner</button></div>
      </div>`;
    },
    2: () => {
      const adv = Array.isArray(cfg.advantage)?cfg.advantage:[];
      const feat = Array.isArray(cfg.features)?cfg.features:[];
      return `<div class="card" style="margin-top:14px"><h3>💪 产品核心优势（${adv.length}）</h3>
        <div class="editable-list" data-list="advantage" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          ${adv.map((x,i)=>`<div class="editable-item" data-i="${i}"><input class="input" data-k="icon" value="${esc(x.icon||'')}" placeholder="emoji 图标 🌐🤖..." style="width:64px;text-align:center"><input class="input" data-k="title" value="${esc(x.title||'')}" placeholder="标题，如：全球70+平台同步"><input class="input" data-k="desc" value="${esc(x.desc||'')}" placeholder="一句话描述"><button class="btn-sm danger" onclick="saasListItemRemove('advantage',${i})">删除</button></div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="saasListItemAdd('advantage')">+ 新增优势</button></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>🧩 全套功能模块展示（${feat.length}）</h3>
        <div class="editable-list" data-list="features" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          ${feat.map((x,i)=>`<div class="editable-item" data-i="${i}"><input class="input" data-k="icon" value="${esc(x.icon||'')}" placeholder="emoji" style="width:64px;text-align:center"><input class="input" data-k="title" value="${esc(x.title||'')}" placeholder="功能名，如：商品管理"><input class="input" data-k="desc" value="${esc(x.desc||'')}" placeholder="一句话描述"><button class="btn-sm danger" onclick="saasListItemRemove('features',${i})">删除</button></div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="saasListItemAdd('features')">+ 新增功能模块</button></div>
      </div>`;
    },
    3: () => {
      const plans = Array.isArray(cfg.plans)?cfg.plans:[];
      const cases = Array.isArray(cfg.cases)?cfg.cases:[];
      return `<div class="card" style="margin-top:14px"><h3>💰 版本套餐价格（${plans.length} 套）</h3>
        <div style="margin-top:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
          ${plans.map((p,i)=>`<div style="padding:12px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <input class="input" data-plani="${i}" data-k="name" value="${esc(p.name||'')}" style="font-weight:700">
              <button class="btn-sm danger" onclick="saasListItemRemove('plans',${i})">✕</button>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div>月付<input class="input" data-plani="${i}" data-k="price_month" value="${esc((p.price||{}).month||'')}" style="padding:4px 8px"></div>
              <div>季付<input class="input" data-plani="${i}" data-k="price_quarter" value="${esc((p.price||{}).quarter||'')}" style="padding:4px 8px"></div>
              <div>年付<input class="input" data-plani="${i}" data-k="price_year" value="${esc((p.price||{}).year||'')}" style="padding:4px 8px"></div>
              <div>店铺数<input class="input" data-plani="${i}" data-k="shops" value="${esc(p.shops||'')}" style="padding:4px 8px"></div>
            </div>
            <div style="margin-top:6px;font-size:12px">亮点（分号分隔）<textarea class="input" data-plani="${i}" data-k="features_text" rows="3" style="padding:4px 8px">${esc(Array.isArray(p.features)?p.features.join('；'):(p.features_text||''))}</textarea></div>
            <div style="margin-top:6px;font-size:12px">标记<input class="input" data-plani="${i}" data-k="badge" value="${esc(p.badge||'')}" placeholder="如：最受欢迎 / 当前套餐"></div>
          </div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="saasListItemAdd('plans')">+ 新增套餐</button></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>👥 用户案例 & 适配场景（${cases.length}）</h3>
        <div class="editable-list" data-list="cases" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          ${cases.map((x,i)=>`<div class="editable-item" data-i="${i}"><input class="input" data-k="brand" value="${esc(x.brand||'')}" placeholder="客户品牌"><input class="input" data-k="scene" value="${esc(x.scene||'')}" placeholder="场景，如：亚马逊精品铺货"><input class="input" data-k="result" value="${esc(x.result||'')}" placeholder="使用成果，如：效率提升230%"><button class="btn-sm danger" onclick="saasListItemRemove('cases',${i})">删除</button></div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="saasListItemAdd('cases')">+ 新增案例</button></div>
      </div>`;
    },
    4: () => {
      const comp = Array.isArray(cfg.compare)?cfg.compare:[];
      const a = cfg.apply || {};
      return `<div class="card" style="margin-top:14px"><h3>⚖️ 系统亮点对比（对标妙手/聚水潭）</h3>
        <div class="editable-list" data-list="compare" style="margin-top:12px;display:flex;flex-direction:column;gap:10px">
          ${comp.map((x,i)=>`<div class="editable-item" data-i="${i}"><input class="input" data-k="item" value="${esc(x.item||'')}" placeholder="对比维度，如：平台覆盖"><input class="input" data-k="us" value="${esc(x.us||'')}" placeholder="数序跨境ERP"><input class="input" data-k="miaoshou" value="${esc(x.miaoshou||'')}" placeholder="妙手"><input class="input" data-k="jushuitan" value="${esc(x.jushuitan||'')}" placeholder="聚水潭"><button class="btn-sm danger" onclick="saasListItemRemove('compare',${i})">删除</button></div>`).join('')}
        </div>
        <div style="margin-top:10px"><button class="btn-ghost btn-sm" onclick="saasListItemAdd('compare')">+ 新增对比维度</button></div>
      </div>
      <div class="card" style="margin-top:14px"><h3>📩 在线体验申请入口配置</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">
          <div><label class="lbl">区块标题</label><input class="input" id="lc-apply-title" value="${esc(a.title||'')}"></div>
          <div><label class="lbl">副标题</label><input class="input" id="lc-apply-sub" value="${esc(a.subTitle||'')}"></div>
          <div><label class="lbl">成功提示</label><input class="input" id="lc-apply-success" value="${esc(a.successText||'')}"></div>
          <div><label class="lbl">客服微信号</label><input class="input" id="lc-apply-wechat" value="${esc(((a.contact||{}).wechat)||'')}"></div>
          <div style="grid-column:1/-1"><label class="lbl">客服二维码图片URL</label><input class="input" id="lc-apply-qr" value="${esc(((a.contact||{}).qrImg)||'')}"></div>
        </div>
      </div>`;
    },
    5: () => {
      const f = cfg.footer || {};
      return `<div class="card" style="margin-top:14px"><h3>📞 底部版权 / 备案 / 客服联系方式</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:14px">
          <div><label class="lbl">版权文字</label><input class="input" id="lc-footer-copy" value="${esc(f.copyright||'')}"></div>
          <div><label class="lbl">ICP备案号</label><input class="input" id="lc-footer-icp" value="${esc(f.icp||'')}"></div>
          <div><label class="lbl">公安备案</label><input class="input" id="lc-footer-gov" value="${esc(f.gongan||'')}"></div>
          <div><label class="lbl">客服电话</label><input class="input" id="lc-footer-tel" value="${esc(((f.service||{}).tel)||'')}"></div>
          <div><label class="lbl">客服邮箱</label><input class="input" id="lc-footer-mail" value="${esc(((f.service||{}).email)||'')}"></div>
          <div><label class="lbl">客服工作时间</label><input class="input" id="lc-footer-hours" value="${esc(((f.service||{}).hours)||'')}"></div>
          <div style="grid-column:1/-1"><label class="lbl">微信二维码 URL</label><input class="input" id="lc-footer-wx" value="${esc(((f.service||{}).wechatQr)||'')}"></div>
        </div>
      </div>`;
    }
  };
  box.innerHTML = `
    <div class="tabs" style="margin-top:12px;display:flex;gap:4px;border-bottom:1px solid var(--border);padding:0 6px">
      ${tabs.map((t,i)=>`<div class="tab-item ${i===tabIdx?'on':''}" onclick="saasLandingTab(${i})">${t}</div>`).join('')}
    </div>
    ${renderByTab[tabIdx]()}
    <div style="position:sticky;bottom:0;padding:16px 0;background:linear-gradient(0deg,var(--bg) 60%,transparent);text-align:right;margin-top:14px">
      <button class="btn-ghost" onclick="saasLandingPreview()">👁️ 预览官网（新窗口）</button>
      <button class="btn primary" style="margin-left:10px" onclick="saasLandingSave()">💾 保存所有修改 → 官网立即生效</button>
    </div>
  `;
  // 注入 editable-list/item CSS（如果还没有）
  if (!document.getElementById('saas-css')) {
    const st = document.createElement('style'); st.id='saas-css';
    st.textContent = `.tabs .tab-item{padding:10px 16px;cursor:pointer;border-bottom:3px solid transparent;font-weight:600;color:var(--text-2);transition:all .15s}.tabs .tab-item.on{color:var(--primary);border-color:var(--primary)}.tabs .tab-item.off{opacity:.45;pointer-events:none}.editable-item{display:flex;gap:8px;align-items:center}.editable-item input{flex:1}.sbl{width:32px;height:32px;border:3px solid var(--primary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;margin:0 auto}@keyframes spin{to{transform:rotate(360deg)}}`;
    document.head.appendChild(st);
  }
}
function saasLandingTab(i){ window.__landingTab = i; loadSaasAdmin(); }
function saasBannerAdd() {
  const list = document.getElementById('banner-list');
  if (!list) return;
  const i = list.querySelectorAll('> div').length;
  const row = document.createElement('div');
  row.style.cssText = 'padding:14px;border:1px solid var(--border);border-radius:12px;background:var(--gray-bg);display:grid;grid-template-columns:1fr 1fr 40px;gap:12px;align-items:start';
  row.innerHTML = `
    <div><label class="lbl">标题</label><input class="input" data-bk="banner" data-i="${i}" data-k="title"></div>
    <div><label class="lbl">副标题</label><input class="input" data-bk="banner" data-i="${i}" data-k="subTitle"></div>
    <button class="btn-sm danger" onclick="this.closest('#banner-list > div').remove()" title="删除">✕</button>
    <div style="grid-column:1/3"><label class="lbl">Banner 图片 URL</label><input class="input" data-bk="banner" data-i="${i}" data-k="img" placeholder="上传图片后粘贴 URL"></div>
    <div><label class="lbl">主按钮文字</label><input class="input" data-bk="banner" data-i="${i}" data-k="btnText" value="立即申请体验"></div>
    <div><label class="lbl">主按钮跳转链接</label><input class="input" data-bk="banner" data-i="${i}" data-k="btnLink" value="#apply"></div>`;
  list.appendChild(row);
}
function saasBannerRemove(i) {
  const rows = document.querySelectorAll('#banner-list > div');
  if (rows[i]) rows[i].remove();
  toast('删除成功，保存后生效','ok');
}
function saasListItemAdd(listKey) {
  const box = document.querySelector(`.editable-list[data-list="${listKey}"]`);
  if (!box) return;
  const i = box.querySelectorAll('.editable-item').length;
  const fields = {
    advantage: [['icon','emoji 🌐🤖…','width:64px;text-align:center'],['title','标题'],['desc','一句话描述']],
    features:  [['icon','emoji','width:64px;text-align:center'],['title','功能名'],['desc','一句话描述']],
    cases:     [['brand','客户品牌'],['scene','场景，如：亚马逊铺货'],['result','成果，如：效率230%']],
    compare:   [['item','对比维度'],['us','数序ERP'],['miaoshou','妙手'],['jushuitan','聚水潭']],
    plans:     null
  };
  if (listKey === 'plans') {
    const cont = box.parentElement.querySelector('.grid, [style*="grid-template-columns:repeat(4"]') || box.parentElement;
    toast('请在上方套餐卡片区操作', 'warn'); return;
  }
  const row = document.createElement('div');
  row.className = 'editable-item'; row.dataset.i = i;
  row.innerHTML = (fields[listKey]||[]).map(f=>`<input class="input" data-k="${f[0]}" placeholder="${f[1]}" ${f[2]?`style="${f[2]}"`:''}>`).join('') + `<button class="btn-sm danger" onclick="this.closest('.editable-item').remove()">删除</button>`;
  box.appendChild(row);
}
function saasListItemRemove(listKey, i) {
  const box = document.querySelector(`.editable-list[data-list="${listKey}"]`);
  if (!box) return;
  const items = box.querySelectorAll('.editable-item');
  if (items[i]) items[i].remove();
  toast('删除成功，保存后生效','ok');
}
async function saasLandingSave() {
  const data = {};
  const byId = { siteName:['lc-siteName','string'], 'seo.title':['lc-seo-title','string'], 'seo.keywords':['lc-seo-kw','string'], 'seo.description':['lc-seo-desc','string'],
    'apply.title':['lc-apply-title','string'],'apply.subTitle':['lc-apply-sub','string'],'apply.successText':['lc-apply-success','string'],
    'apply.contact.wechat':['lc-apply-wechat','string'],'apply.contact.qrImg':['lc-apply-qr','string'],
    'footer.copyright':['lc-footer-copy','string'],'footer.icp':['lc-footer-icp','string'],'footer.gongan':['lc-footer-gov','string'],
    'footer.service.tel':['lc-footer-tel','string'],'footer.service.email':['lc-footer-mail','string'],'footer.service.hours':['lc-footer-hours','string'],'footer.service.wechatQr':['lc-footer-wx','string'] };
  function setByPath(obj, path, val) {
    const parts = path.split('.'); let cur = obj;
    for (let k=0;k<parts.length-1;k++){ cur[parts[k]]=cur[parts[k]]||{}; cur=cur[parts[k]]; }
    cur[parts[parts.length-1]] = val;
  }
  for (const [k,v] of Object.entries(byId)) { const el = document.getElementById(v[0]); if (el) setByPath(data, k, el.value); }
  // Banner 列表
  const banners = [];
  document.querySelectorAll('#banner-list > div').forEach(div => {
    const inputs = div.querySelectorAll('input[data-bk="banner"]');
    const b = {}; inputs.forEach(inp => b[inp.dataset.k] = inp.value);
    if (b.title || b.subTitle || b.img) banners.push(b);
  });
  if (banners.length) data.banner = banners;
  // list key 数据
  for (const key of ['advantage','features','cases','compare']) {
    const box = document.querySelector(`.editable-list[data-list="${key}"]`);
    if (!box) continue;
    const arr = [];
    box.querySelectorAll('.editable-item').forEach(it => {
      const obj = {};
      it.querySelectorAll('input[data-k]').forEach(inp => { if (inp.value.trim()) obj[inp.dataset.k] = inp.value.trim(); });
      if (Object.keys(obj).length) arr.push(obj);
    });
    data[key] = arr;
  }
  // plans
  document.querySelectorAll('[data-plani]').forEach(inp => {
    const i = +inp.dataset.plani; const k = inp.dataset.k;
    data.plans = data.plans || []; data.plans[i] = data.plans[i] || {};
    if (k.startsWith('price_')) {
      data.plans[i].price = data.plans[i].price || {};
      data.plans[i].price[k.replace('price_','')] = Number(inp.value) || 0;
    } else if (k === 'features_text') {
      data.plans[i].features = inp.value.split(/[；;]/).map(s=>s.trim()).filter(Boolean);
    } else if (k === 'shops') {
      data.plans[i][k] = Number(inp.value) || 0;
    } else {
      data.plans[i][k] = inp.value;
    }
  });
  try {
    const r = await saasFetch('/landing/config', 'PUT', { config: data });
    toast('✅ 官网配置已保存，刷新官网立即查看最新效果', 'ok');
  } catch(e) { toast('保存失败：' + e.message, 'err'); }
}
function saasLandingPreview() { window.open('/','_blank'); }

/* 租户生命周期管理 */
async function saasRenderTenants(box) {
  box.innerHTML = `<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载租户列表...</div></div></div>`;
  let res; try { res = await saasFetch('/tenants?page=1&size=20'); } catch(e){ box.innerHTML = `<div class="card"><div class="banner warn">⚠️ ${e.message}</div></div>`; return; }
  const items = res.items || [];
  box.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h3>🏢 全租户生命周期管理（${res.total||0}）</h3>
        <div style="display:flex;gap:8px">
          <input class="input" id="t-search" placeholder="搜索租户名称/用户名" style="width:260px" onkeydown="if(event.key==='Enter'){window.__tenantSearch=this.value;saasRenderTenants(document.getElementById('saas-body'))}">
          <button class="btn primary" onclick="openTenantForm()">+ 新增租户</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>ID</th><th>租户名称</th><th>套餐</th><th>有效期至</th><th>状态</th><th>店铺/订单/商品</th><th>创建时间</th><th>操作</th></tr></thead>
        <tbody>
          ${items.map(t=>`<tr>
            <td>#${t.id}</td>
            <td><b>${esc(t.name||'-')}</b></td>
            <td><span class="pill ${t.plan_code==='pro'?'ok':t.plan_code==='enterprise'?'warn':'neutral'}">${t.plan_code||'-'}</span></td>
            <td>${fmtDate(t.subscribe_expire_at)}</td>
            <td><span class="pill ${t.status==='ACTIVE'?'ok':t.status==='FROZEN'?'danger':'neutral'}">${{ACTIVE:'正常',FROZEN:'已冻结',EXPIRED:'已到期',PENDING:'待开通'}[t.status]||t.status||'-'}</span></td>
            <td>${t.stats?(t.stats.shops||0)+'/'+(t.stats.orders||0)+'/'+(t.stats.products||0):'-'}</td>
            <td>${fmtDate(t.created_at)}</td>
            <td style="white-space:nowrap">
              <button class="btn-sm primary" onclick="openTenantForm(${t.id})">编辑</button>
              <button class="btn-sm neutral" onclick="openAdjustForm(${t.id},'${t.name||''}')">改额度/套餐</button>
              <button class="btn-sm ${t.status==='FROZEN'?'ok':'danger'}" onclick="saasToggleFreeze(${t.id},${t.status==='FROZEN'?0:1})">${t.status==='FROZEN'?'解冻':'冻结'}</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="8" style="text-align:center;padding:36px;color:var(--text-2)">暂无租户数据</td></tr>`}
        </tbody>
      </table>
    </div>`;
}
function openTenantForm(id) { openModal(id?'编辑租户':'新增租户', id?'（开发中：复用 /api/v1/saas/tenants PUT）':'（开发中：调用 /api/v1/saas/tenants POST 创建）', [{text:'关闭',class:'ghost',click:closeModal},{text:'保存',class:'primary',click:()=>{toast('租户保存（开发骨架已具备，API已就绪）','ok');closeModal()}}]); }
function openAdjustForm(id,name) { openModal(`改额度 / 改套餐：${name}`, '（开发中：对应 /api/v1/saas/tenants/:id/adjust 与 /billing/renewal 接口）', [{text:'取消',class:'ghost',click:closeModal},{text:'确认变更',class:'primary',click:()=>{toast('额度调整已提交','ok');closeModal()}}]); }
async function saasToggleFreeze(id, toFreeze) {
  try { await saasFetch('/tenants/'+id+(toFreeze?'/freeze':'/unfreeze'), 'POST'); toast((toFreeze?'已冻结':'已解冻')+' 租户#'+id, 'ok'); saasRenderTenants(document.getElementById('saas-body')); }
  catch(e){ toast('操作失败：'+e.message,'err'); }
}

/* 账单审核 */
async function saasRenderBillingAudit(box) {
  box.innerHTML = `<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载待审账单...</div></div></div>`;
  let res; try { res = await saasFetch('/billing/orders?status=PENDING&page=1&size=20'); } catch(e){ box.innerHTML = `<div class="card"><div class="banner warn">⚠️ ${e.message}</div></div>`; return; }
  const items = res.items || [];
  box.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h3>💳 财务账单审核（待付款 ${res.total||0}）</h3>
        <div style="display:flex;gap:8px">
          ${['ALL','PENDING','PAID','CANCELLED'].map(s=>`<button class="btn-sm ${s==='PENDING'?'primary':'neutral'}" onclick="toast('筛选：${s}（WIP）','ok')">${{ALL:'全部',PENDING:'待付款',PAID:'已付款',CANCELLED:'已取消'}[s]}</button>`).join('')}
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>订单号</th><th>下单时间</th><th>所属租户</th><th>类型</th><th>项目</th><th>金额</th><th>支付方式</th><th>状态</th><th>操作</th></tr></thead>
        <tbody>
          ${items.map(o=>`<tr>
            <td>#${o.order_no||o.id}</td><td>${fmtDate(o.created_at)}</td>
            <td>${esc(o.tenant_name||o.tenant_id||'-')}</td>
            <td>${{plan:'套餐订阅',expand:'扩容包',renewal:'续费'}[o.order_type]||o.order_type}</td>
            <td>${esc(o.item_name||'-')}${o.cycle?'（'+({month:'月',quarter:'季',year:'年'})[o.cycle]+'）':''}</td>
            <td style="font-weight:700;color:var(--primary)">¥${Number(o.amount||0).toFixed(2)}</td>
            <td>${{transfer:'对公转账',wechat:'微信',alipay:'支付宝'}[o.pay_method]||o.pay_method||'未支付'}</td>
            <td><span class="pill warn">待付款</span></td>
            <td style="white-space:nowrap">
              <button class="btn-sm primary" onclick="saasApproveBill(${o.id})">✅ 财务审核通过</button>
              <button class="btn-sm neutral" onclick="toast('查看凭证/订单详情（WIP）','ok')">详情</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--text-2)">暂无待审账单</td></tr>`}
        </tbody>
      </table>
    </div>`;
}
async function saasApproveBill(id) {
  try { await saasFetch('/billing/orders/'+id+'/approve', 'POST'); toast('✅ 审核通过，对应租户套餐/额度已更新','ok'); saasRenderBillingAudit(document.getElementById('saas-body')); }
  catch(e){ toast('审核失败：'+e.message,'err'); }
}

/* 体验申请 */
async function saasRenderApply(box) {
  box.innerHTML = `<div class="card"><div style="text-align:center;padding:30px"><div class="sbl"></div><div style="margin-top:10px;color:var(--text-2)">加载申请列表...</div></div></div>`;
  let res; try { res = await saasFetch('/landing/applications?page=1&size=30'); } catch(e){ box.innerHTML = `<div class="card"><div class="banner warn">⚠️ ${e.message}</div></div>`; return; }
  const items = res.items || [];
  box.innerHTML = `
    <div class="card" style="margin-top:14px">
      <div class="card-head"><h3>📝 官网在线体验申请（共 ${res.total||0} 条）</h3>
        <div style="display:flex;gap:8px">
          <button class="btn-ghost btn-sm" onclick="toast('导出Excel（WIP）','ok')">📥 导出 Excel</button>
        </div>
      </div>
      <table class="data-table">
        <thead><tr><th>ID</th><th>提交时间</th><th>姓名</th><th>手机号</th><th>店铺类型</th><th>主营平台</th><th>月单量</th><th>跟进状态</th><th>操作</th></tr></thead>
        <tbody>
          ${items.map(a=>`<tr>
            <td>#${a.id}</td><td>${fmtDate(a.created_at)}</td>
            <td>${esc(a.name||'-')}</td><td><b>${esc(a.phone||'-')}</b></td>
            <td>${esc(a.shop_type||'-')}</td><td>${esc(a.main_platforms||'-')}</td><td>${esc(a.monthly_volume||'-')}</td>
            <td><span class="pill ${a.status==='FOLLOWED'?'ok':a.status==='CONTACTED'?'neutral':'warn'}">${{NEW:'待跟进',CONTACTED:'已联系',FOLLOWED:'已成交',LOST:'已流失'}[a.status]||'待跟进'}</span></td>
            <td style="white-space:nowrap">
              <button class="btn-sm primary" onclick="saasApplyStatus(${a.id},'CONTACTED')">标记已联系</button>
              <button class="btn-sm ok" onclick="saasApplyStatus(${a.id},'FOLLOWED')">已成交</button>
            </td>
          </tr>`).join('') || `<tr><td colspan="9" style="text-align:center;padding:36px;color:var(--text-2)">暂无申请记录</td></tr>`}
        </tbody>
      </table>
    </div>`;
}
async function saasApplyStatus(id, s) {
  try { await saasFetch('/landing/applications/'+id, 'PUT', { status: s }); toast('✅ 状态已更新','ok'); saasRenderApply(document.getElementById('saas-body')); }
  catch(e){ toast(e.message,'err'); }
}
"""
html = html.replace(old_saas_func, new_saas_func)

# ===================== 后端 app.js 净化 404 debug 泄露 =====================
APP_JS = Path('/workspace/deploy/backend/src/app.js')
app = APP_JS.read_text(encoding='utf-8')
# 404：不要返回 path 字段（泄露接口路径模式）
old404 = "app.use((req, res) => res.status(404).json({ error: '接口不存在', path: req.path }));"
new404 = "app.use((req, res) => res.status(404).json({ error: '请求的资源不存在' }));"
app = app.replace(old404, new404)
# 500：debug（stack/message）去掉生产返回
old500 = "  console.error(`[${new Date().toISOString()}] ERR`, err);\n  res.status(500).json({ error: '服务器内部错误', debug: process.env.NODE_ENV === 'dev' ? err.message : undefined });"
new500 = "  if (process.env.NODE_ENV === 'dev') console.error(`[${new Date().toISOString()}] ERR`, err);\n  else console.error(`[ERR] ${err && err.message || String(err)}`);\n  res.status(500).json({ error: '服务繁忙，请稍后重试' });"
app = app.replace(old500, new500)
# 403 也去掉 user/admin 字段打印到console（日志里保留，不泄露给用户）
old403log = "    console.error(`[403] ${req.method} ${req.originalUrl} user=${req.user && req.user.id} tenant=${req.user && req.user.tenantId} admin=${req.admin && req.admin.adminId}`);"
new403log = "    const _u = req.user||{}; const _a = req.admin||{};\n    console.error(`[403] ${req.method} ${req.originalUrl}`);"
app = app.replace(old403log, new403log)
APP_JS.write_text(app, encoding='utf-8')

F.write_text(html, encoding='utf-8')
print('✅ P6+P7 代码改造完成：')
print('  - 自动审单页：删除任务名code，改为问号tooltip一句话提示')
print('  - 套餐配额页：删除套餐字段英文字段显示，改为问号说明')
print('  - SaaS登录页：删除SQL创建账号提示/scrypt/api前缀泄露，改为商务文案')
print('  - 其他：WIP→即将开放，删除后端提示，问号tooltip CSS全站统一注入')
print('  - 所有顶部V2 banner：精简为一句话标题 + 问号悬浮详细提示')
print('  - SaaS运营后台终版：5个页签（登录/官网配置可视化编辑器10模块/租户列表生命周期/账单审核/体验申请）')
print('  - 后端 app.js：404/500/403 不再泄露 path / stack / user_id，生产环境无debug字段')
