#!/usr/bin/env python3
"""部署前端 + marketing landing"""
import socket, time, paramiko, tarfile, io, os, shutil, subprocess

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'

proxy = socket.socket()
proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
buf = b''
while b'\r\n\r\n' not in buf:
    chunk = proxy.recv(4096)
    if not chunk: break
    buf += chunk
time.sleep(0.6)
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

# 1. 打包 dist → 上传 → 部署
print('=== Step 1: 部署 ERP 前端 ===')
tar_path = '/tmp/wms-dist.tgz'
with tarfile.open(tar_path, 'w:gz') as tar:
    for root, dirs, files in os.walk('/workspace/wms-app/dist'):
        for f in files:
            full = os.path.join(root, f)
            tar.add(full, arcname=os.path.relpath(full, '/workspace/wms-app/dist'))
sftp = ssh.open_sftp()
sftp.put(tar_path, '/tmp/wms-dist.tgz')
sftp.close()
print('✅ uploaded')

cmd = "sudo rm -rf /var/www/wms && sudo mkdir -p /var/www/wms && " \
      "sudo tar -xzf /tmp/wms-dist.tgz -C /var/www/wms && " \
      "sudo chown -R www-data:www-data /var/www/wms && " \
      "rm /tmp/wms-dist.tgz && " \
      "echo '--- /var/www/wms ---' && sudo ls /var/www/wms/"
stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
out = stdout.read().decode()
err = stderr.read().decode()
print(out)
if err: print('ERR:', err[:200])

# 2. 改 marketing landing — 把根路径 / 的 SEO landing 也换成柔和渐变风
print('\n=== Step 2: marketing landing — 统一风格 ===')
landing_html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Thalvior 跨境 ERP · 把中国货卖向全球</title>
<meta name="description" content="Thalvior 是为中国跨境电商卖家打造的一站式代打包管理 SaaS。多平台订单自动同步、智能代打包、自动扣费结算。" />
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23f0f7ff'/%3E%3Cpath d='M9 11.6h14' stroke='%231f8ae2' stroke-width='2.4' stroke-linecap='round'/%3E%3Cpath d='M16 11.6v10' stroke='%2338a9f6' stroke-width='2.4' stroke-linecap='round'/%3E%3Cpath d='M10.2 24.8q2.9-2.4 5.8 0t5.8 0' fill='none' stroke='%2322c55e' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E" />
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Segoe UI", sans-serif;
  -webkit-font-smoothing: antialiased;
  background:
    radial-gradient(1200px 800px at 10% -10%, rgba(186, 224, 253, 0.5) 0%, transparent 60%),
    radial-gradient(1000px 700px at 110% 10%, rgba(252, 231, 243, 0.4) 0%, transparent 55%),
    radial-gradient(900px 600px at 50% 120%, rgba(220, 252, 231, 0.4) 0%, transparent 50%),
    #fafbfc;
  min-height: 100vh;
  padding: 40px 20px;
}
.blob { position: fixed; border-radius: 9999px; filter: blur(60px); opacity: 0.5; pointer-events: none; z-index: 0; }
.container { max-width: 960px; margin: 0 auto; position: relative; z-index: 1; }
.hero { text-align: center; padding: 60px 20px 50px; }
.logo-wrap { display: inline-block; margin-bottom: 20px; animation: float 4s ease-in-out infinite; }
.logo { width: 64px; height: 64px; border-radius: 18px;
  background: linear-gradient(135deg, #bae0fd, #dcfce7, #fce7f3);
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8px 24px -8px rgba(30, 41, 59, 0.15);
}
.logo svg { width: 36px; height: 36px; }
@keyframes float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800;
  background: linear-gradient(135deg, #185a97, #334155, #22c55e);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  line-height: 1.2; margin-bottom: 12px; }
.sub { font-size: 1rem; color: #64748b; max-width: 520px; margin: 0 auto 36px; line-height: 1.6; }

.portals { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 40px; }
.portal { background: rgba(255,255,255,0.72); backdrop-filter: blur(14px);
  border: 1px solid rgba(255,255,255,0.9); border-radius: 16px;
  box-shadow: 0 2px 16px -6px rgba(30,41,59,0.08);
  padding: 24px; text-align: center; text-decoration: none; color: inherit;
  transition: all .2s ease; }
.portal:hover { transform: translateY(-3px);
  box-shadow: 0 12px 32px -8px rgba(30,41,59,0.15); }
.portal-icon { width: 44px; height: 44px; border-radius: 14px; margin: 0 auto 14px;
  display: flex; align-items: center; justify-content: center; font-size: 22px; }
.portal-sky .portal-icon { background: linear-gradient(135deg, #bae0fd, #e0f2fe); }
.portal-mint .portal-icon { background: linear-gradient(135deg, #bbf7d0, #dcfce7); }
.portal-lilac .portal-icon { background: linear-gradient(135deg, #f3e8ff, #e0e7ff); }
.portal-title { font-weight: 700; font-size: 15px; color: #1e293b; margin-bottom: 2px; }
.portal-sub { font-size: 11px; color: #94a3b8; }

.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
.feature { background: rgba(255,255,255,0.6); border: 1px solid rgba(255,255,255,0.8);
  border-radius: 14px; padding: 18px; backdrop-filter: blur(10px); }
.feature-title { font-weight: 600; font-size: 14px; color: #334155; margin-bottom: 4px; }
.feature-desc { font-size: 12px; color: #94a3b8; line-height: 1.5; }
.feature-emoji { font-size: 18px; margin-bottom: 6px; }

footer { text-align: center; margin-top: 60px; font-size: 11px; color: #cbd5e1; }
</style>
</head>
<body>
  <div class="blob" style="width:480px;height:480px;top:-120px;left:-120px;background:#bae0fd;"></div>
  <div class="blob" style="width:420px;height:420px;bottom:-100px;right:-100px;background:#fce7f3;"></div>
  <div class="blob" style="width:360px;height:360px;top:40%;left:40%;background:#dcfce7;"></div>

  <div class="container">
    <div class="hero">
      <div class="logo-wrap">
        <div class="logo">
          <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect width="32" height="32" rx="7" fill="white" opacity="0.5"/>
            <path d="M9 11.6h14" stroke="#1f8ae2" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M16 11.6v10" stroke="#38a9f6" stroke-width="2.4" stroke-linecap="round"/>
            <path d="M10.2 24.8q2.9-2.4 5.8 0t5.8 0" fill="none" stroke="#22c55e" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
        </div>
      </div>
      <h1>把中国货卖向全球<br/>一站式代打包 SaaS</h1>
      <p class="sub">为跨境电商卖家打造的多平台订单管理系统 · 自动同步 · 智能代打包 · 自动扣费结算</p>

      <div class="portals">
        <a href="/merchant/login" class="portal portal-sky">
          <div class="portal-icon">🛍️</div>
          <div class="portal-title">商家工作台</div>
          <div class="portal-sub">Seller Portal</div>
        </a>
        <a href="/wms/login" class="portal portal-mint">
          <div class="portal-icon">🏭</div>
          <div class="portal-title">仓库后台</div>
          <div class="portal-sub">WMS</div>
        </a>
        <a href="/admin/login" class="portal portal-lilac">
          <div class="portal-icon">⚙️</div>
          <div class="portal-title">平台管理</div>
          <div class="portal-sub">Platform Admin</div>
        </a>
      </div>
    </div>

    <div class="features">
      <div class="feature"><div class="feature-emoji">📦</div><div class="feature-title">60+ 平台订单自动同步</div><div class="feature-desc">TikTok / Shopee / Lazada / Ozon / Mercado 等主流跨境平台一键拉单</div></div>
      <div class="feature"><div class="feature-emoji">🧠</div><div class="feature-title">智能代打包</div><div class="feature-desc">多单合包、SKU 智能识别、条码面单自动生成</div></div>
      <div class="feature"><div class="feature-emoji">💳</div><div class="feature-title">自动扣费结算</div><div class="feature-desc">按重量自动计费、商家钱包实时同步、COD 一键结算</div></div>
      <div class="feature"><div class="feature-emoji">📊</div><div class="feature-title">实时利润看板</div><div class="feature-desc">毛利计算、物流成本、平台佣金全链路可视</div></div>
    </div>

    <footer>© Thalvior Cross-Border SaaS · v6.0</footer>
  </div>
</body>
</html>"""

# 写入到 nginx 根目录
stdin, stdout, stderr = ssh.exec_command(
    "echo " + repr(landing_html) + " | sudo tee /var/www/landing/index.html > /dev/null && "
    "sudo cat /var/www/landing/index.html | head -5",
    timeout=15)
print(stdout.read().decode())

# 验证
import requests
try:
    r = requests.get('https://thalvior.icu/', timeout=15, allow_redirects=True)
    print(f'\n✅ marketing landing: HTTP {r.status_code}, len={len(r.text)}, has glassmorphism={".portal" in r.text}')
except Exception as e:
    print(f'⚠️ marketing: {e}')

ssh.close()
print('\n✅ 全部部署完成')
