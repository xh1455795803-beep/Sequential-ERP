#!/usr/bin/env python3
"""P4 阶段：获取现有Nginx配置 + 开发官网HTML + 配置Nginx + 上传部署"""
import os, sys, socket, time
from urllib.parse import urlparse
from pathlib import Path
import paramiko

REPO = Path(__file__).resolve().parent
PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'

def log(*a, **k): print('[P4]', *a, flush=True, **k)

def connect():
    p = urlparse(PROXY_URL); ph, pp = p.hostname, p.port or 80
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(20); s.connect((ph, pp))
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data: data += s.recv(1)
    if b'200' not in data.split(b'\r\n')[0]: raise RuntimeError('CONNECT fail')
    cli = paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PASS,
                sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                allow_agent=False, look_for_keys=False)
    log('✅ SSH OK')
    return cli

def run(cli, cmd, timeout=300, sudo=False):
    import shlex
    if sudo: cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:200])
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try: line = stdout.readline()
        except: break
        if not line: break
        sys.stdout.write('   | ' + line); out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip(): log('   STDERR:', err[:1200])
    return rc, ''.join(out), err

# ========= 生成官网落地页（高端商务UI，动态拉取API） =========
LANDING_HTML = r'''<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>数序跨境ERP - 一站式跨境电商智能管理平台</title>
<meta id="seo-meta-keywords" name="keywords" content="跨境ERP,电商ERP,亚马逊ERP,Temu ERP,Shein ERP,库存管理,订单管理,财务利润" />
<meta id="seo-meta-description" name="description" content="数序跨境ERP覆盖全球70+电商平台，支持智能审单、库存闭环、财务全自动核算与AI辅助决策，助力跨境卖家降本增效。" />
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' rx='20' fill='%232563eb'/%3E%3Ctext x='50' y='68' text-anchor='middle' font-size='60' font-family='Arial' fill='white' font-weight='bold'%3E数%3C/text%3E%3C/svg%3E" />
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", "Segoe UI", Arial, sans-serif; color: #0f172a; line-height: 1.6; background: #fff; }
  a { text-decoration: none; color: inherit; }
  .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }

  /* ===== 顶部导航 ===== */
  .navbar { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.85); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid rgba(15,23,42,0.06); }
  .navbar-inner { display: flex; align-items: center; justify-content: space-between; height: 68px; }
  .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; color: #0f172a; }
  .brand-icon { width: 34px; height: 34px; border-radius: 9px; background: linear-gradient(135deg,#2563eb 0%, #06b6d4 100%); display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: 900; font-size: 16px; }
  .nav-links { display: flex; gap: 36px; }
  .nav-links a { color: #475569; font-size: 15px; font-weight: 500; transition: color .2s; }
  .nav-links a:hover { color: #2563eb; }
  .nav-cta { display: flex; gap: 12px; align-items: center; }
  .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; transition: all .2s; cursor: pointer; border: none; }
  .btn-outline { background: #fff; color: #2563eb; border: 1.5px solid #2563eb; }
  .btn-outline:hover { background: #eff6ff; }
  .btn-primary { background: linear-gradient(135deg,#2563eb 0%, #4f46e5 100%); color: #fff; box-shadow: 0 6px 18px rgba(37,99,235,0.3); }
  .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 10px 24px rgba(37,99,235,0.35); }
  .btn-white { background: #fff; color: #0f172a; }
  .btn-lg { padding: 14px 28px; font-size: 15px; border-radius: 12px; }

  /* ===== Hero 首屏 Banner ===== */
  .hero { position: relative; overflow: hidden; background: linear-gradient(135deg, #0b1220 0%, #1e293b 45%, #1e40af 100%); color: #fff; }
  .hero::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 20% 20%, rgba(56,189,248,0.18) 0%, transparent 45%), radial-gradient(circle at 80% 60%, rgba(129,140,248,0.22) 0%, transparent 50%); }
  .hero-inner { position: relative; padding: 110px 0 130px; display: grid; grid-template-columns: 1.15fr 1fr; gap: 60px; align-items: center; }
  .hero-tag { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; background: rgba(99,102,241,0.18); border: 1px solid rgba(165,180,252,0.3); font-size: 13px; color: #c7d2fe; margin-bottom: 24px; }
  .hero-tag::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: #4ade80; box-shadow: 0 0 0 4px rgba(74,222,128,0.2); }
  .hero h1 { font-size: 56px; font-weight: 800; line-height: 1.12; letter-spacing: -0.5px; margin-bottom: 20px; }
  .hero h1 em { font-style: normal; background: linear-gradient(135deg, #38bdf8 0%, #a5b4fc 100%); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .hero-sub { font-size: 19px; color: #cbd5e1; line-height: 1.75; margin-bottom: 36px; max-width: 560px; }
  .hero-btns { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 48px; }
  .hero-stats { display: flex; gap: 48px; }
  .hero-stats .num { font-size: 32px; font-weight: 800; color: #fff; }
  .hero-stats .lbl { font-size: 13px; color: #94a3b8; margin-top: 2px; }
  .hero-visual { position: relative; border-radius: 20px; padding: 3px; background: linear-gradient(135deg, rgba(56,189,248,0.4), rgba(168,85,247,0.4)); box-shadow: 0 30px 80px rgba(2,6,23,0.5); }
  .hero-visual-inner { border-radius: 17px; background: #0f172a; padding: 28px; min-height: 380px; }
  .mock-header { display: flex; gap: 8px; margin-bottom: 20px; }
  .mock-header span { width: 10px; height: 10px; border-radius: 50%; background: #ef4444; }
  .mock-header span:nth-child(2) { background: #f59e0b; }
  .mock-header span:nth-child(3) { background: #10b981; }
  .mock-kpis { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; margin-bottom: 22px; }
  .mock-kpi { background: rgba(30,41,59,0.85); border: 1px solid rgba(148,163,184,0.1); border-radius: 12px; padding: 16px; }
  .mock-kpi .lbl { font-size: 11px; color: #94a3b8; }
  .mock-kpi .val { font-size: 22px; font-weight: 700; color: #f1f5f9; margin-top: 6px; }
  .mock-kpi .val.up { color: #4ade80; }
  .mock-kpi .val.up::after { content: ' +23%'; font-size: 12px; color: #4ade80; font-weight: 500; }
  .mock-chart { background: rgba(30,41,59,0.85); border: 1px solid rgba(148,163,184,0.1); border-radius: 12px; padding: 20px; height: 160px; display: flex; align-items: flex-end; gap: 8px; }
  .mock-chart div { flex: 1; background: linear-gradient(to top, #2563eb 0%, #38bdf8 100%); border-radius: 6px 6px 2px 2px; }
  .mock-chart div:nth-child(1) { height: 35%; } .mock-chart div:nth-child(2) { height: 55%; } .mock-chart div:nth-child(3) { height: 40%; }
  .mock-chart div:nth-child(4) { height: 70%; } .mock-chart div:nth-child(5) { height: 55%; } .mock-chart div:nth-child(6) { height: 85%; }
  .mock-chart div:nth-child(7) { height: 65%; } .mock-chart div:nth-child(8) { height: 92%; }

  /* ===== 通用 section ===== */
  section { padding: 96px 0; }
  .section-head { text-align: center; max-width: 720px; margin: 0 auto 64px; }
  .eyebrow { display: inline-block; padding: 6px 14px; background: #eff6ff; color: #2563eb; border-radius: 999px; font-size: 13px; font-weight: 600; margin-bottom: 16px; }
  .section-head h2 { font-size: 40px; font-weight: 800; line-height: 1.2; color: #0f172a; margin-bottom: 16px; letter-spacing: -0.3px; }
  .section-head p { font-size: 17px; color: #64748b; }

  /* ===== 核心优势 ===== */
  .advantages { background: #f8fafc; }
  .adv-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 20px; }
  .adv-card { background: #fff; padding: 28px 24px; border-radius: 16px; border: 1px solid rgba(15,23,42,0.06); transition: all .3s; }
  .adv-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(15,23,42,0.08); border-color: rgba(37,99,235,0.2); }
  .adv-icon { width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg,#dbeafe,#e0e7ff); display: flex; align-items: center; justify-content: center; font-size: 22px; margin-bottom: 18px; }
  .adv-card h3 { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #0f172a; }
  .adv-card p { font-size: 13.5px; color: #64748b; line-height: 1.7; }

  /* ===== 12大功能模块 ===== */
  .features-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
  .feat-card { padding: 26px; border-radius: 16px; background: #fff; border: 1px solid rgba(15,23,42,0.06); transition: all .3s; position: relative; overflow: hidden; }
  .feat-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #2563eb, #a78bfa); transform: scaleX(0); transition: transform .3s; transform-origin: left; }
  .feat-card:hover::before { transform: scaleX(1); }
  .feat-card:hover { transform: translateY(-3px); box-shadow: 0 16px 36px rgba(15,23,42,0.08); }
  .feat-icon { font-size: 28px; margin-bottom: 16px; }
  .feat-card h3 { font-size: 16px; font-weight: 700; margin-bottom: 8px; }
  .feat-card .desc { font-size: 13.5px; color: #64748b; margin-bottom: 14px; }
  .feat-card ul { list-style: none; }
  .feat-card li { font-size: 12.5px; color: #475569; padding: 4px 0 4px 18px; position: relative; }
  .feat-card li::before { content: '✓'; position: absolute; left: 0; top: 4px; color: #10b981; font-weight: 700; }

  /* ===== 套餐价格 ===== */
  .pricing { background: linear-gradient(180deg, #f8fafc 0%, #fff 100%); }
  .plans-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 22px; align-items: stretch; }
  .plan-card { background: #fff; border-radius: 20px; padding: 34px 28px; border: 1.5px solid rgba(15,23,42,0.08); display: flex; flex-direction: column; position: relative; transition: all .3s; }
  .plan-card:hover { transform: translateY(-5px); box-shadow: 0 24px 56px rgba(15,23,42,0.12); }
  .plan-card.featured { border-color: transparent; background: linear-gradient(145deg, #0f172a 0%, #1e3a8a 100%); color: #fff; box-shadow: 0 24px 64px rgba(37,99,235,0.3); }
  .plan-card.featured::before { content: ''; position: absolute; inset: -2px; border-radius: 20px; padding: 2px; background: linear-gradient(135deg, #38bdf8, #a78bfa, #f472b6); -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor; mask-composite: exclude; pointer-events: none; }
  .plan-badge { position: absolute; top: -14px; left: 50%; transform: translateX(-50%); padding: 6px 16px; background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; font-size: 12px; font-weight: 700; border-radius: 999px; box-shadow: 0 8px 20px rgba(239,68,68,0.3); }
  .plan-name { font-size: 16px; font-weight: 600; margin-bottom: 10px; color: #64748b; }
  .plan-card.featured .plan-name { color: #94a3b8; }
  .plan-price { font-size: 40px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 4px; }
  .plan-price .period { font-size: 14px; font-weight: 500; opacity: 0.6; }
  .plan-periods { display: flex; gap: 10px; margin: 16px 0 24px; }
  .plan-periods button { flex: 1; padding: 6px 8px; font-size: 12px; border-radius: 8px; border: 1px solid rgba(15,23,42,0.1); background: #fff; color: #475569; cursor: pointer; font-weight: 500; transition: all .2s; }
  .plan-periods button.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .plan-card.featured .plan-periods button { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.15); color: #cbd5e1; }
  .plan-card.featured .plan-periods button.active { background: #fff; color: #0f172a; }
  .plan-features { list-style: none; flex: 1; margin-bottom: 24px; }
  .plan-features li { font-size: 13.5px; padding: 8px 0; border-bottom: 1px dashed rgba(15,23,42,0.06); display: flex; gap: 8px; align-items: flex-start; }
  .plan-card.featured .plan-features li { border-bottom-color: rgba(255,255,255,0.1); color: #cbd5e1; }
  .plan-features li::before { content: '✓'; color: #10b981; font-weight: 700; flex-shrink: 0; }
  .plan-card .btn { width: 100%; }

  /* ===== 用户案例 ===== */
  .cases-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
  .case-card { background: #fff; padding: 32px; border-radius: 20px; border: 1px solid rgba(15,23,42,0.06); position: relative; }
  .case-logo { width: 64px; height: 64px; border-radius: 16px; background: linear-gradient(135deg,#fef3c7,#fde68a); display: flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 18px; }
  .case-industry { display: inline-block; padding: 4px 10px; background: #f1f5f9; color: #475569; font-size: 12px; border-radius: 6px; margin-bottom: 10px; font-weight: 500; }
  .case-title { font-size: 17px; font-weight: 700; margin-bottom: 12px; }
  .case-quote { font-size: 14px; color: #64748b; line-height: 1.8; font-style: italic; position: relative; padding-left: 18px; }
  .case-quote::before { content: '"'; position: absolute; left: 0; top: -6px; font-size: 36px; color: #2563eb; opacity: 0.3; font-family: Georgia, serif; line-height: 1; }

  /* ===== 对比表 ===== */
  .compare-wrap { background: #fff; border-radius: 20px; border: 1px solid rgba(15,23,42,0.08); overflow: hidden; box-shadow: 0 10px 40px rgba(15,23,42,0.06); }
  .compare-row { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr; }
  .compare-row > div { padding: 18px 24px; border-bottom: 1px solid rgba(15,23,42,0.05); display: flex; align-items: center; }
  .compare-row.head { background: linear-gradient(135deg, #0f172a, #1e3a8a); color: #fff; font-weight: 700; }
  .compare-row.head > div { padding: 22px 24px; border: none; }
  .compare-row:not(.head) > div:first-child { font-weight: 600; color: #0f172a; background: #f8fafc; }
  .compare-row:not(.head) > div:last-child { background: #eff6ff; color: #1d4ed8; font-weight: 700; }

  /* ===== 体验申请 ===== */
  .apply-section { background: linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%); color: #fff; position: relative; overflow: hidden; }
  .apply-section::before { content: ''; position: absolute; inset: 0; background: radial-gradient(circle at 80% 20%, rgba(56,189,248,0.2), transparent 50%); }
  .apply-inner { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: 80px; align-items: center; }
  .apply-text h2 { font-size: 38px; font-weight: 800; margin-bottom: 18px; line-height: 1.2; }
  .apply-text > p { font-size: 16px; color: #cbd5e1; margin-bottom: 30px; }
  .apply-perks { list-style: none; }
  .apply-perks li { font-size: 15px; color: #e2e8f0; padding: 10px 0; display: flex; gap: 12px; align-items: center; }
  .apply-perks li::before { content: '✓'; width: 24px; height: 24px; border-radius: 6px; background: rgba(74,222,128,0.2); color: #4ade80; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .apply-card { background: #fff; color: #0f172a; border-radius: 20px; padding: 36px; box-shadow: 0 30px 80px rgba(2,6,23,0.35); }
  .apply-card h3 { font-size: 22px; font-weight: 700; margin-bottom: 8px; }
  .apply-card .sub { color: #64748b; font-size: 14px; margin-bottom: 26px; }
  .form-group { margin-bottom: 18px; }
  .form-group label { display: block; font-size: 13px; font-weight: 600; color: #334155; margin-bottom: 8px; }
  .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 13px 14px; border-radius: 10px; border: 1.5px solid #e2e8f0; font-size: 14px; transition: border-color .2s, box-shadow .2s; outline: none; font-family: inherit; }
  .form-group input:focus, .form-group select:focus, .form-group textarea:focus { border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,0.12); }
  .apply-note { margin-top: 16px; padding: 12px 14px; background: #f0fdf4; color: #166534; border-radius: 10px; font-size: 12.5px; line-height: 1.7; }
  .apply-success { display: none; padding: 40px 20px; text-align: center; }
  .apply-success .tick { width: 64px; height: 64px; margin: 0 auto 18px; border-radius: 50%; background: linear-gradient(135deg,#10b981,#059669); display: flex; align-items: center; justify-content: center; color: #fff; font-size: 30px; font-weight: 700; }
  .apply-success h3 { font-size: 22px; margin-bottom: 10px; }
  .apply-success p { color: #64748b; font-size: 14px; }

  /* ===== 底部 ===== */
  footer { background: #0b1220; color: #94a3b8; padding: 64px 0 30px; }
  .footer-grid { display: grid; grid-template-columns: 1.5fr 1fr 1fr 1fr 1fr; gap: 40px; padding-bottom: 40px; border-bottom: 1px solid rgba(148,163,184,0.1); }
  .footer-brand .brand { color: #fff; margin-bottom: 16px; }
  .footer-brand p { font-size: 13.5px; line-height: 1.8; margin-bottom: 20px; max-width: 320px; }
  .footer-qr { width: 108px; height: 108px; border-radius: 10px; background: #fff; padding: 6px; display: flex; align-items: center; justify-content: center; color: #0f172a; font-size: 12px; text-align: center; }
  .footer-col h4 { color: #fff; font-size: 14px; font-weight: 700; margin-bottom: 18px; }
  .footer-col a { display: block; color: #94a3b8; font-size: 13.5px; padding: 6px 0; transition: color .2s; }
  .footer-col a:hover { color: #38bdf8; }
  .footer-contact li { font-size: 13.5px; padding: 6px 0; list-style: none; }
  .footer-contact li span { color: #e2e8f0; font-weight: 500; }
  .copyright { padding-top: 24px; text-align: center; font-size: 13px; color: #64748b; }

  /* ===== 响应式 ===== */
  @media (max-width: 1024px) {
    .adv-grid { grid-template-columns: repeat(3,1fr); }
    .features-grid { grid-template-columns: repeat(2,1fr); }
    .plans-grid { grid-template-columns: repeat(2,1fr); }
    .cases-grid { grid-template-columns: 1fr; }
    .hero-inner, .apply-inner { grid-template-columns: 1fr; padding: 70px 0 80px; }
    .footer-grid { grid-template-columns: repeat(2,1fr); }
    .nav-links { display: none; }
    .hero h1 { font-size: 40px; }
  }
  @media (max-width: 640px) {
    .adv-grid { grid-template-columns: 1fr 1fr; }
    .features-grid, .plans-grid { grid-template-columns: 1fr; }
    .compare-row { grid-template-columns: 1fr 1fr; }
    .compare-row > div:first-child { grid-column: 1 / -1; background: #f1f5f9 !important; border-bottom: none; }
    .hero h1 { font-size: 32px; }
    .section-head h2 { font-size: 28px; }
    .hero-stats { gap: 20px; flex-wrap: wrap; }
  }
  .skeleton { background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%); background-size: 200% 100%; animation: shim 1.4s infinite linear; border-radius: 8px; }
  @keyframes shim { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
</style>
</head>
<body>

<!-- 导航 -->
<nav class="navbar">
  <div class="container navbar-inner">
    <div class="brand"><span class="brand-icon">数</span><span id="nav-brand-name">数序跨境ERP</span></div>
    <div class="nav-links">
      <a href="#advantage">核心优势</a>
      <a href="#features">功能模块</a>
      <a href="#pricing">套餐价格</a>
      <a href="#cases">客户案例</a>
      <a href="#compare">产品对比</a>
      <a href="#apply">申请体验</a>
    </div>
    <div class="nav-cta">
      <a href="/app/" class="btn btn-outline">登录控制台</a>
      <a href="#apply" class="btn btn-primary">免费体验</a>
    </div>
  </div>
</nav>

<!-- Hero Banner -->
<header class="hero">
  <div class="container hero-inner">
    <div class="hero-left">
      <div class="hero-tag">V2.0 全新升级 · 覆盖全球 70+ 电商平台</div>
      <h1 id="hero-title" class="skeleton" style="height:130px;width:100%;"></h1>
      <p id="hero-sub" class="skeleton" style="height:56px;width:80%;"></p>
      <div class="hero-btns" id="hero-btns">
        <a href="#apply" class="btn btn-primary btn-lg">立即申请体验</a>
        <a href="#features" class="btn btn-white btn-lg">了解功能 →</a>
      </div>
      <div class="hero-stats">
        <div><div class="num">70+</div><div class="lbl">覆盖电商平台</div></div>
        <div><div class="num">99%+</div><div class="lbl">库存准度</div></div>
        <div><div class="num">95%</div><div class="lbl">自动审单率</div></div>
        <div><div class="num">10万+</div><div class="lbl">服务卖家</div></div>
      </div>
    </div>
    <div class="hero-visual">
      <div class="hero-visual-inner">
        <div class="mock-header"><span></span><span></span><span></span></div>
        <div class="mock-kpis">
          <div class="mock-kpi"><div class="lbl">今日销售额</div><div class="val up">¥128.6K</div></div>
          <div class="mock-kpi"><div class="lbl">订单量</div><div class="val up">3,284</div></div>
          <div class="mock-kpi"><div class="lbl">净利润</div><div class="val up">¥38.2K</div></div>
          <div class="mock-kpi"><div class="lbl">待审订单</div><div class="val" style="color:#fbbf24">12</div></div>
        </div>
        <div class="mock-chart">
          <div></div><div></div><div></div><div></div><div></div><div></div><div></div><div></div>
        </div>
      </div>
    </div>
  </div>
</header>

<!-- 核心优势 -->
<section class="advantages" id="advantage">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">产品核心优势</span>
      <h2>为什么选择数序跨境ERP？</h2>
      <p>专为中国跨境卖家打造的一站式智能管理系统，覆盖从选品、上架到发货结算全链路</p>
    </div>
    <div id="adv-grid" class="adv-grid"></div>
  </div>
</section>

<!-- 功能模块 -->
<section id="features">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">12 大功能模块</span>
      <h2>覆盖跨境电商全业务流程</h2>
      <p>从商品上架到财务结算，一个系统全部搞定，不再需要多套工具切换</p>
    </div>
    <div id="features-grid" class="features-grid"></div>
  </div>
</section>

<!-- 套餐价格 -->
<section class="pricing" id="pricing">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">版本套餐价格</span>
      <h2>透明定价，按需选择</h2>
      <p>从个人卖家到品牌企业，总有一款适合你，随时可升级可降级</p>
    </div>
    <div id="plans-grid" class="plans-grid"></div>
  </div>
</section>

<!-- 客户案例 -->
<section id="cases" style="background:#f8fafc;">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">用户案例</span>
      <h2>10万+ 跨境卖家的共同选择</h2>
      <p>3C数码、服装服饰、家居百货、美妆个护，各大品类头部卖家的信赖之选</p>
    </div>
    <div id="cases-grid" class="cases-grid"></div>
  </div>
</section>

<!-- 对比表 -->
<section id="compare">
  <div class="container">
    <div class="section-head">
      <span class="eyebrow">系统亮点对比</span>
      <h2>为什么我们是更优的选择？</h2>
      <p>对比市面主流ERP系统，数序在平台覆盖、AI智能、可配置化上全面领先</p>
    </div>
    <div id="compare-wrap" class="compare-wrap"></div>
  </div>
</section>

<!-- 体验申请 -->
<section class="apply-section" id="apply">
  <div class="container apply-inner">
    <div class="apply-text">
      <h2>立即开启数序跨境ERP之旅</h2>
      <p>填写下方信息，14天专业版免费试用，专属顾问1对1演示指导</p>
      <ul class="apply-perks">
        <li>14 天专业版全功能免费体验</li>
        <li>专属顾问 1 对 1 系统演示与培训</li>
        <li>70+ 平台一键授权，历史数据迁移</li>
        <li>30 分钟内响应，7×12 客服支持</li>
        <li>签订保密协议，数据安全保障</li>
        <li>无隐形消费，体验期零费用</li>
      </ul>
    </div>
    <div class="apply-card">
      <h3 id="apply-title">免费申请体验</h3>
      <p class="sub" id="apply-sub">30秒填写，即刻开通专业版试用</p>
      <form id="apply-form" onsubmit="submitApply(event)">
        <div class="form-group">
          <label for="f-contact">联系人姓名</label>
          <input type="text" id="f-contact" placeholder="请输入您的姓名" required maxlength="30" />
        </div>
        <div class="form-group">
          <label for="f-phone">手机号 *</label>
          <input type="tel" id="f-phone" pattern="^1[3-9]\d{9}$" placeholder="请输入您的手机号" required />
        </div>
        <div class="form-group">
          <label for="f-company">公司名称</label>
          <input type="text" id="f-company" placeholder="选填" maxlength="120" />
        </div>
        <div class="form-group">
          <label for="f-shopt">主营平台类型 *</label>
          <select id="f-shopt" required><option value="">请选择主营平台</option></select>
        </div>
        <div class="form-group">
          <label for="f-msg">备注信息</label>
          <textarea id="f-msg" rows="3" placeholder="选填：您最关注的功能或当前痛点..." maxlength="500"></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-lg" style="width:100%;" id="apply-btn">立即免费申请体验</button>
        <div class="apply-note" id="apply-note">提交后，专属顾问将在30分钟内联系您，提供免费1对1演示和14天专业版试用。</div>
      </form>
      <div class="apply-success" id="apply-success">
        <div class="tick">✓</div>
        <h3>申请提交成功！</h3>
        <p>感谢您的关注，专属顾问将在30分钟内与您联系。</p>
      </div>
    </div>
  </div>
</section>

<!-- 页脚 -->
<footer>
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <div class="brand"><span class="brand-icon">数</span><span id="footer-brand">数序跨境ERP</span></div>
        <p id="footer-slogan">一站式跨境电商智能管理平台，覆盖全球70+平台，助力中国卖家出海无忧。</p>
      </div>
      <div class="footer-col">
        <h4>产品功能</h4>
        <a href="#features">商品中心</a>
        <a href="#features">订单管理</a>
        <a href="#features">库存管理</a>
        <a href="#features">财务利润</a>
        <a href="#features">调度中心</a>
      </div>
      <div class="footer-col">
        <h4>版本套餐</h4>
        <a href="#pricing">基础版</a>
        <a href="#pricing">标准版</a>
        <a href="#pricing">专业版</a>
        <a href="#pricing">企业版</a>
      </div>
      <div class="footer-col">
        <h4>关于我们</h4>
        <a href="#advantage">公司介绍</a>
        <a href="#cases">客户案例</a>
        <a href="#compare">产品对比</a>
        <a href="#apply">商务合作</a>
      </div>
      <div class="footer-col">
        <h4>联系我们</h4>
        <ul class="footer-contact" id="footer-contact">
          <li>客服热线：<span id="fc-phone">400-888-0000</span></li>
          <li>邮箱：<span id="fc-email">contact@qianniu-erp.cc</span></li>
          <li>地址：<span id="fc-addr">浙江省杭州市余杭区未来科技城</span></li>
        </ul>
      </div>
    </div>
    <div class="copyright">
      <span id="f-copyright">© 2025 数序科技 All Rights Reserved</span>
      &nbsp;·&nbsp;
      <span id="f-icp">浙ICP备2025000000号</span>
    </div>
  </div>
</footer>

<script>
// ========== 1. 拉取配置并动态渲染 ==========
const API = '/api/v1/public/landing';
let cfg = null;

async function loadConfig() {
  try {
    const r = await fetch(API + '/config', { cache: 'no-store' });
    cfg = await r.json();
  } catch (e) {
    console.warn('官网配置加载失败，使用默认兜底');
    cfg = { ready: false };
  }
  renderAll();
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs || {}).forEach(([k, v]) => {
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v);
  });
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  });
  return el;
}

// Hero
function renderHero() {
  const banner = (cfg && cfg.banner && cfg.banner[0]) || {
    title: '一站式<em>跨境电商</em>ERP解决方案',
    subTitle: '覆盖全球70+电商平台 · 智能审单 · 库存闭环 · 财务全自动核算',
    btnText: '立即申请体验',
    btnLink: '#apply'
  };
  const tEl = document.getElementById('hero-title');
  tEl.classList.remove('skeleton');
  tEl.style.height = 'auto';
  tEl.innerHTML = banner.title.includes('<') ? banner.title : banner.title.replace('跨境电商', '<em>跨境电商</em>');
  const sEl = document.getElementById('hero-sub');
  sEl.classList.remove('skeleton');
  sEl.style.height = 'auto';
  sEl.textContent = banner.subTitle;
  document.getElementById('nav-brand-name').textContent = (cfg && cfg.siteName) || '数序跨境ERP';

  // SEO
  if (cfg && cfg.seo) {
    if (cfg.seo.title) document.title = cfg.seo.title;
    if (cfg.seo.keywords) document.getElementById('seo-meta-keywords').setAttribute('content', cfg.seo.keywords);
    if (cfg.seo.description) document.getElementById('seo-meta-description').setAttribute('content', cfg.seo.description);
  }
}

// 核心优势
function renderAdvantage() {
  const grid = document.getElementById('adv-grid');
  const list = (cfg && cfg.advantage) || [
    {icon:'🌐',title:'多平台同步',desc:'覆盖Amazon/Temu/Shein/Shopee/速卖通等70+平台，一键同步订单商品'},
    {icon:'✅',title:'全自动审单',desc:'自定义风控规则，95%订单自动放行，异常精准拦截'},
    {icon:'📦',title:'库存闭环',desc:'采购→入库→发货→盘点全链路，SKU级库存实时精准'},
    {icon:'💰',title:'财务利润',desc:'多币种汇率自动换算，订单级利润拆解，月度自动结算'},
    {icon:'🤖',title:'AI智能',desc:'销量预测、库存风险、欺诈识别、智能刊登建议'},
  ];
  grid.innerHTML = '';
  list.forEach(a => {
    grid.appendChild(h('div', {class:'adv-card'}, [
      h('div', {class:'adv-icon'}, a.icon || '✨'),
      h('h3', {}, a.title),
      h('p', {}, a.desc),
    ]));
  });
}

// 12大功能
function renderFeatures() {
  const grid = document.getElementById('features-grid');
  const list = (cfg && cfg.features) || [];
  grid.innerHTML = '';
  list.forEach(f => {
    const points = f.points || [];
    grid.appendChild(h('div', {class:'feat-card'}, [
      h('div', {class:'feat-icon'}, f.icon || '📌'),
      h('h3', {}, f.title),
      h('p', {class:'desc'}, f.desc),
      h('ul', {}, points.map(p => h('li', {}, p))),
    ]));
  });
}

// 套餐价格
function renderPlans() {
  const grid = document.getElementById('plans-grid');
  const plans = (cfg && cfg.plans) || [];
  const periods = [
    { key:'month',   label:'按月' },
    { key:'quarter', label:'按季' },
    { key:'year',    label:'按年' },
  ];
  const priceKey = p => ({month:'price_month',quarter:'price_quarter',year:'price_year'})[p] || 'price_month';
  let activePeriod = 'month';
  const render = () => {
    grid.innerHTML = '';
    plans.forEach((pl, idx) => {
      const featured = pl.tag && (pl.tag.includes('推荐') || pl.tag.includes('热门'));
      const price = pl[priceKey(activePeriod)] || '—';
      const features = pl.features || [];
      const periodBtns = periods.map(p => h('button', {
        class: p.key === activePeriod ? 'active' : '',
        onclick: (e) => { activePeriod = p.key; e.stopPropagation(); render(); },
        onclick_: null,
        'data-period': p.key,
      }, p.label));
      // 手动绑定（因为上面的onclick处理逻辑需要正确）
      const card = h('div', {class:'plan-card' + (featured ? ' featured' : '')}, [
        featured ? h('div', {class:'plan-badge'}, pl.tag) : null,
        h('div', {class:'plan-name'}, pl.name),
        h('div', {class:'plan-price'}, [price, h('span', {class:'period'}, activePeriod === 'month' ? '/月' : activePeriod === 'quarter' ? '/季' : '/年')]),
        h('div', {class:'plan-periods'}, periodBtns),
        h('ul', {class:'plan-features'}, features.map(f => h('li', {}, f))),
        h('a', {class:'btn ' + (featured ? 'btn-white' : 'btn-primary'), href:'#apply'}, featured ? '立即购买' : '选择方案'),
      ]);
      // 绑定周期按钮事件
      card.querySelectorAll('.plan-periods button').forEach(b => {
        b.addEventListener('click', (e) => { e.preventDefault(); activePeriod = b.getAttribute('data-period'); render(); });
      });
      grid.appendChild(card);
    });
  };
  render();
}

// 客户案例
function renderCases() {
  const grid = document.getElementById('cases-grid');
  const list = (cfg && cfg.cases) || [];
  grid.innerHTML = '';
  list.forEach(c => {
    grid.appendChild(h('div', {class:'case-card'}, [
      h('div', {class:'case-logo'}, c.logo || '🏢'),
      h('div', {class:'case-industry'}, c.industry || '跨境电商'),
      h('h3', {class:'case-title'}, c.title),
      h('p', {class:'case-quote'}, c.quote),
    ]));
  });
}

// 对比表
function renderCompare() {
  const wrap = document.getElementById('compare-wrap');
  const list = (cfg && cfg.compare) || [];
  wrap.innerHTML = '';
  const head = h('div', {class:'compare-row head'}, [
    h('div', {}, '对比项'),
    h('div', {}, '妙手ERP'),
    h('div', {}, '聚水潭'),
    h('div', {}, '数序跨境ERP（我们）'),
  ]);
  wrap.appendChild(head);
  list.forEach(row => {
    wrap.appendChild(h('div', {class:'compare-row'}, [
      h('div', {}, row.item || ''),
      h('div', {}, row.miaoshou || '—'),
      h('div', {}, row.jushuitan || '—'),
      h('div', {}, row.ours || '—'),
    ]));
  });
}

// 体验申请表单 + 页脚
function renderApplyFooter() {
  const applyCfg = (cfg && cfg.apply) || {};
  if (applyCfg.btnText) document.getElementById('apply-btn').textContent = applyCfg.btnText;
  if (applyCfg.noteText) document.getElementById('apply-note').textContent = applyCfg.noteText;
  const types = applyCfg.shopTypes || ['Amazon','Temu','Shein','Shopee/Lazada','速卖通','eBay','TikTok','独立站','其他'];
  const sel = document.getElementById('f-shopt');
  sel.innerHTML = '<option value="">请选择主营平台</option>' + types.map(t => `<option value="${t}">${t}</option>`).join('');

  const f = cfg && cfg.footer || {};
  if (f.copyright) document.getElementById('f-copyright').textContent = f.copyright;
  if (f.icp) document.getElementById('f-icp').textContent = f.icp;
  if (f.phone) document.getElementById('fc-phone').textContent = f.phone;
  if (f.email) document.getElementById('fc-email').textContent = f.email;
  if (f.address) document.getElementById('fc-addr').textContent = f.address;
  document.getElementById('footer-brand').textContent = (cfg && cfg.siteName) || '数序跨境ERP';
}

function renderAll() {
  renderHero();
  renderAdvantage();
  renderFeatures();
  renderPlans();
  renderCases();
  renderCompare();
  renderApplyFooter();
}

// 提交申请
async function submitApply(e) {
  e.preventDefault();
  const btn = document.getElementById('apply-btn');
  btn.disabled = true; btn.textContent = '提交中...';
  try {
    const payload = {
      phone: document.getElementById('f-phone').value.trim(),
      shop_type: document.getElementById('f-shopt').value,
      company: document.getElementById('f-company').value.trim(),
      contact_name: document.getElementById('f-contact').value.trim(),
      message: document.getElementById('f-msg').value.trim(),
    };
    const r = await fetch(API + '/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || '提交失败');
    document.getElementById('apply-form').style.display = 'none';
    document.getElementById('apply-success').style.display = 'block';
  } catch (err) {
    alert('提交失败：' + (err.message || '请稍后重试'));
  } finally {
    btn.disabled = false; btn.textContent = (cfg && cfg.apply && cfg.apply.btnText) || '立即免费申请体验';
  }
}

// 平滑滚动
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const id = a.getAttribute('href').slice(1);
    const t = document.getElementById(id);
    if (t) { e.preventDefault(); window.scrollTo({ top: t.offsetTop - 70, behavior: 'smooth' }); }
  });
});

loadConfig();
</script>
</body>
</html>'''

def main():
    cli = connect()
    sftp = cli.open_sftp()

    # 1. 读取当前Nginx配置
    print("\n📖 1. 读取现有Nginx配置")
    print("="*60)
    rc, nginx_conf, _ = run(cli, "cat /etc/nginx/conf.d/shuxu-erp.conf 2>&1", sudo=True)

    # 2. 创建官网落地页目录并上传HTML
    print("\n📁 2. 上传官网落地页")
    print("="*60)
    run(cli, "sudo mkdir -p /opt/shuxu-erp/landing", sudo=True)
    run(cli, "sudo chown -R admin:admin /opt/shuxu-erp/landing", sudo=True)
    sftp.open('/opt/shuxu-erp/landing/index.html', 'w').write(LANDING_HTML)
    log("✅ 官网index.html已上传")
    run(cli, "ls -la /opt/shuxu-erp/landing/")

    # 3. 写新的Nginx配置（官网+ERP共存）
    print("\n🔧 3. 更新Nginx配置")
    print("="*60)
    NEW_NGINX = r'''server {
    listen 443 ssl http2;
    server_name qianniu-erp.cc;

    ssl_certificate /etc/pki/nginx/qianniu-erp.cc.pem;
    ssl_certificate_key /etc/pki/nginx/private/qianniu-erp.cc.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript application/xml text/xml;
    gzip_min_length 1024;

    # 安全头
    add_header X-Content-Type-Options nosniff;
    add_header X-Frame-Options SAMEORIGIN;
    add_header Referrer-Policy strict-origin-when-cross-origin;

    # ========= 官网落地页（根路径直接访问，无需登录） =========
    location = / {
        alias /opt/shuxu-erp/landing/index.html;
        expires -1;
        add_header Cache-Control "no-store";
    }
    location = /index.html {
        alias /opt/shuxu-erp/landing/index.html;
        expires -1;
    }
    location ~ ^/[^/]+\.(html|css|js|png|jpg|jpeg|svg|gif|ico|woff2?)$ {
        root /opt/shuxu-erp/landing;
        if (!-f $request_filename) {
            rewrite ^ /app/index.html last;
        }
        expires 7d;
    }

    # ========= ERP 控制台 =========
    location ^~ /app/ {
        alias /opt/shuxu-erp/admin/;
        try_files $uri $uri/ /app/index.html;
        expires -1;
        add_header Cache-Control "no-store";
    }
    location = /app { return 301 /app/; }

    # ========= API 接口 (Node.js 后端) =========
    location ^~ /api/ {
        proxy_pass http://127.0.0.1:8090;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
        proxy_connect_timeout 10s;
        client_max_body_size 50m;
    }

    # ========= 上传素材静态文件 =========
    location ^~ /uploads/ {
        alias /opt/shuxu-erp/backend/uploads/;
        expires 30d;
        add_header Cache-Control "public";
    }
}

# HTTP 跳转 HTTPS
server {
    listen 80;
    server_name qianniu-erp.cc;
    return 301 https://$host$request_uri;
}
'''
    sftp.open('/tmp/shuxu-erp.new.conf', 'w').write(NEW_NGINX)
    run(cli, "sudo cp /tmp/shuxu-erp.new.conf /etc/nginx/conf.d/shuxu-erp.conf", sudo=True)
    run(cli, "sudo nginx -t 2>&1", sudo=True)
    run(cli, "sudo systemctl reload nginx 2>&1", sudo=True)

    # 4. 验证：根路径、/app/、API 都正常
    print("\n✅ 4. 验证访问")
    print("="*60)
    time.sleep(2)
    checks = [
        ("根路径(官网)", "curl -sS -m 6 -o /dev/null -w '%{http_code}  size=%{size_download}\n' https://qianniu-erp.cc/"),
        ("/app/ (ERP)", "curl -sS -m 6 -o /dev/null -w '%{http_code}  size=%{size_download}\n' https://qianniu-erp.cc/app/"),
        ("/api/health",  "curl -sS -m 6 -w ' HTTP=%{http_code}\\n' https://qianniu-erp.cc/api/health"),
        ("/api/v1/public/landing/config",  "curl -sS -m 8 https://qianniu-erp.cc/api/v1/public/landing/config | python3 -c \"import sys,json;d=json.load(sys.stdin);print('ready=',d.get('ready'),'features=',len(d.get('features',[])),'plans=',len(d.get('plans',[])))\""),
    ]
    for name, cmd in checks:
        log(f"--- {name} ---")
        run(cli, cmd)

    sftp.close()
    cli.close()
    print("\n🎉 P4 官网落地页 + Nginx 配置完成！")

if __name__ == "__main__":
    main()
