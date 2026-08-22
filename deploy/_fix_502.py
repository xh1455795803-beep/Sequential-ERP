#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""修复502问题：用 deploy-runner 同方式 SSH 诊断 + 修复 + 重启"""
import os, sys, socket, time
from urllib.parse import urlparse
import paramiko

PROXY_URL = (os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
             or os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy'))
HOSTS = ['120.55.6.75']
USER = 'admin'
PASS = 'yuan340364'

def log(*a, **k):
    print('[DIAG]', *a, flush=True, **k)

def connect():
    assert PROXY_URL, 'HTTPS_PROXY 环境变量不存在'
    p = urlparse(PROXY_URL)
    ph, pp = p.hostname, p.port or 80
    last_err = None
    for host in HOSTS:
        try:
            port = 22
            log(f'CONNECT 代理 {ph}:{pp} → {host}:{port} ...')
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(20)
            s.connect((ph, pp))
            s.sendall(f'CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n\r\n'.encode())
            data = b''
            while b'\r\n\r\n' not in data:
                data += s.recv(1)
                if len(data) > 4096: break
            first = data.split(b'\r\n')[0].decode(errors='ignore')
            log('   ', first)
            if '200' not in first:
                s.close(); raise RuntimeError('CONNECT 非 200: ' + first)
            cli = paramiko.SSHClient()
            cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            cli.connect(hostname=host, port=22, username=USER, password=PASS,
                        sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
                        allow_agent=False, look_for_keys=False)
            log('✅ SSH OK →', host)
            return cli
        except Exception as e:
            last_err = e
            log('   失败', type(e).__name__, str(e)[:200])
            try: s.close()
            except: pass
    raise RuntimeError(f'SSH连接失败：{last_err}')

def run(cli, cmd, timeout=300, sudo=False):
    import shlex
    if sudo:
        cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:240] + ('...' if len(cmd) > 240 else ''))
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try:
            line = stdout.readline()
        except Exception:
            break
        if not line:
            break
        sys.stdout.write('   | ' + line)
        out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   👉 exit={rc}')
        if err.strip():
            log('   STDERR:', err[:1200])
    return rc, ''.join(out), err

def main():
    cli = connect()
    try:
        # ===== 1. 查日志 =====
        print("\n" + "="*60)
        print("🔍 1. 服务日志 (最近80行)")
        print("="*60)
        run(cli, "sudo journalctl -u shuxu-erp --no-pager -n 80 --no-hostname 2>&1 | tail -80", sudo=True)

        # ===== 2. 进程 + 端口 =====
        print("\n" + "="*60)
        print("🔍 2. 进程与端口")
        print("="*60)
        run(cli, "ps aux | grep -E 'node|nodemon' | grep -v grep; echo '---'; ss -tlnp | grep -E ':8090|:3000'")

        # ===== 3. 语法检查 =====
        print("\n" + "="*60)
        print("🔍 3. 核心文件语法检查")
        print("="*60)
        files = [
            "src/app.js", "src/scheduler.js",
            "src/routes/billing.js", "src/routes/media.js",
            "src/routes/public-landing.js", "src/routes/saas-admin.js",
            "src/routes/saas-tenants.js", "src/routes/finance-v2.js",
            "src/routes/auto-audit.js", "src/routes/aftersales.js",
            "src/routes/products-v2.js", "src/routes/exchange-rates.js",
            "src/routes/scheduler-routes.js",
            "src/middleware/quota.js", "src/middleware/auth.js", "src/middleware/audit.js",
            "src/inventory-ledger.js", "src/db.js", "src/config.js", "src/util.js",
        ]
        for f in files:
            rc, out, err = run(cli, f"cd /opt/shuxu-erp/backend && node --check {f} 2>&1")
            if rc != 0:
                log(f"❌ 语法错误: {f}")
                return

        # ===== 4. 依赖检查 =====
        print("\n" + "="*60)
        print("🔍 4. 依赖检查")
        print("="*60)
        run(cli, "cd /opt/shuxu-erp/backend && ls node_modules/ 2>/dev/null | wc -l; echo '---检查关键包---'; for p in multer dotenv express jsonwebtoken mysql2; do if [ -d node_modules/$p ]; then echo OK $p; else echo MISS $p; fi; done")

        # ===== 5. 手动启动看错误 =====
        print("\n" + "="*60)
        print("🔍 5. 手动启动看错误（6秒超时）")
        print("="*60)
        run(cli, "cd /opt/shuxu-erp/backend && timeout 8 node src/app.js 2>&1; echo EXIT_CODE=$?", timeout=15)

        # ===== 6. 修复：安装缺失依赖，重启服务 =====
        print("\n" + "="*60)
        print("🔧 6. 修复：安装缺失依赖 + 重启服务")
        print("="*60)
        run(cli, "cd /opt/shuxu-erp/backend && if [ ! -f package.json ]; then echo '生成package.json...'; cat > package.json << 'EOF'\n{\n  \"name\": \"shuxu-erp\",\n  \"version\": \"2.0.0\",\n  \"main\": \"src/app.js\",\n  \"dependencies\": {\n    \"express\": \"^4.18.0\",\n    \"mysql2\": \"^3.6.0\",\n    \"jsonwebtoken\": \"^9.0.0\",\n    \"bcryptjs\": \"^2.4.3\",\n    \"dotenv\": \"^16.3.0\",\n    \"multer\": \"^1.4.5-lts.1\",\n    \"cors\": \"^2.8.5\",\n    \"axios\": \"^1.6.0\"\n  }\n}\nEOF\nfi")
        run(cli, "cd /opt/shuxu-erp/backend && for p in multer dotenv cors axios bcryptjs; do if [ ! -d node_modules/$p ]; then echo 安装 $p; npm install $p --no-audit --no-fund --loglevel=error 2>&1 | tail -3; fi; done")

        # ===== 7. 重启服务 =====
        print("\n" + "="*60)
        print("🔧 7. 重启 shuxu-erp 服务")
        print("="*60)
        run(cli, "sudo systemctl daemon-reload", sudo=True)
        run(cli, "sudo systemctl restart shuxu-erp", sudo=True)
        time.sleep(4)
        run(cli, "sudo systemctl status shuxu-erp --no-pager -n 15", sudo=True)

        # ===== 8. 验证 =====
        print("\n" + "="*60)
        print("✅ 8. 本机直连验证")
        print("="*60)
        for i in range(5):
            time.sleep(1)
            rc, out, _ = run(cli, "curl -sS -m 4 http://127.0.0.1:8090/api/health 2>&1")
            if "status" in out or "ok" in out:
                log("🎉 后端API健康检查通过")
                break
            log(f"  等待... {i+1}/5")
        else:
            log("❌ 仍不通，打印最新日志")
            run(cli, "sudo journalctl -u shuxu-erp --no-pager -n 30 --no-hostname", sudo=True)

    finally:
        cli.close()

if __name__ == "__main__":
    main()
