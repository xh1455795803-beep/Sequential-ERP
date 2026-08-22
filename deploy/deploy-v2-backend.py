#!/usr/bin/env python3
"""V2.0 后端快速部署脚本：仅上传修改过的 V2 文件 + 重启 Node 服务 + 健康检查冒烟"""
import os, sys, socket, time, json
from pathlib import Path
from urllib.parse import urlparse
import paramiko

HERE = Path(__file__).resolve().parent.parent  # <workspace>/deploy/backend/ai-service/..
REPO = Path("/workspace/deploy")

PROXY_URL = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'
REMOTE_BACKEND = '/opt/shuxu-erp/backend/src'
REMOTE_AI      = '/opt/shuxu-erp/backend/ai-service'

def log(*a, **k): print('[deploy-v2]', *a, flush=True, **k)

def connect():
    p = urlparse(PROXY_URL)
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM); s.settimeout(25)
    s.connect((p.hostname, p.port or 80))
    log(f'CONNECT {p.hostname}:{p.port or 80} → {HOST}:22')
    s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
    data = b''
    while b'\r\n\r\n' not in data and len(data) < 4096: data += s.recv(1)
    first = data.split(b'\r\n')[0].decode(errors='ignore')
    if '200' not in first:
        raise RuntimeError('CONNECT failed: ' + first)
    cli = paramiko.SSHClient()
    cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    cli.connect(hostname=HOST, port=22, username=USER, password=PASS,
                sock=s, timeout=30, banner_timeout=25, auth_timeout=25,
                allow_agent=False, look_for_keys=False)
    log('✅ SSH OK')
    return cli

def run(cli, cmd, timeout=180, sudo=False):
    import shlex
    if sudo: cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:200])
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out, err = stdout.read().decode(errors='ignore'), stderr.read().decode(errors='ignore')
    for line in out.splitlines()[:30]:
        print('   |', line)
    rc = stdout.channel.recv_exit_status()
    if rc != 0:
        log(f'   exit={rc}')
        if err.strip(): log('   ERR:', err[:600])
    return rc, out, err

def put(sftp, local: Path, remote: str):
    log(f'📤 {local.name} → {remote}')
    sftp.put(str(local), remote)

def main():
    cli = connect()
    sftp = cli.open_sftp()
    # --------- 1) 上传后端核心修改文件 ---------
    src = REPO / "backend" / "src"
    files = [
        "app.js", "scheduler.js", "inventory-ledger.js",
        "middleware/quota.js", "middleware/audit.js",
        "routes/auth.js", "routes/saas-admin.js", "routes/saas-tenants.js",
        "routes/products-v2.js", "routes/aftersales.js",
        "routes/exchange-rates.js", "routes/auto-audit.js",
        "routes/scheduler-routes.js", "routes/finance-v2.js"
    ]
    for f in files:
        local = src / f
        remote = f"{REMOTE_BACKEND}/{f}"
        if local.exists():
            put(sftp, local, remote)
        else:
            log(f'⚠️  本地缺失: {f}，跳过')
    # --------- 2) 上传 AI 服务目录 ---------
    run(cli, f"mkdir -p {REMOTE_AI}")
    for f in ["main.py", "requirements.txt", "start-ai.sh"]:
        lp = REPO / "backend" / "ai-service" / f
        if lp.exists():
            put(sftp, lp, f"{REMOTE_AI}/{f}")
    run(cli, f"chmod +x {REMOTE_AI}/start-ai.sh")

    # --------- 3) 语法检查 ---------
    rc, out, _ = run(cli, f"cd {REMOTE_BACKEND} && ls app.js >/dev/null && for f in app.js scheduler.js inventory-ledger.js middleware/quota.js middleware/audit.js routes/auth.js routes/saas-admin.js routes/saas-tenants.js routes/products-v2.js routes/aftersales.js routes/exchange-rates.js routes/auto-audit.js routes/scheduler-routes.js routes/finance-v2.js; do echo \"=== $f ===\"; /usr/bin/node --check \"$f\" && echo OK; done")
    if rc != 0:
        log('❌ 远端语法检查失败，ABORT，未重启服务')
        return 1

    # --------- 4) 重启 Node 后端（优先 pm2 → systemctl → 端口直接杀进程自启） ---------
    log('🔄 重启 Node 后端服务...')
    rc_pm2, _, _ = run(cli, "command -v pm2 >/dev/null 2>&1 && pm2 list --no-color 2>&1 | head -20", timeout=30)
    if rc_pm2 == 0:
        run(cli, "cd /opt/shuxu-erp/backend && (pm2 restart shuxu-erp || pm2 restart src/app.js || pm2 restart all)", timeout=60)
        time.sleep(3)
        run(cli, "pm2 list --no-color 2>&1 | head -20")
    else:
        # 用 systemd 或直接 node 重启
        rc_svc, _, _ = run(cli, "systemctl is-active shuxu-erp 2>&1", timeout=10)
        if rc_svc == 0:
            run(cli, "sudo -n systemctl restart shuxu-erp 2>&1", timeout=30, sudo=True)
        else:
            # 兜底：找到并杀 node 进程，cd 后 nohup 重启
            run(cli, "pkill -f 'node.*app.js' 2>/dev/null; sleep 2; "
                     "cd /opt/shuxu-erp/backend && nohup /usr/bin/node src/app.js > src/app.stdout.log 2>&1 &", timeout=30)
    time.sleep(5)

    # --------- 5) 健康检查：通过代理发 HTTP ---------
    log('🧪 HTTP 健康检查 (通过 HTTPS_PROXY 代理) ...')
    import urllib.request
    proxy = urllib.request.ProxyHandler({'https': PROXY_URL, 'http': PROXY_URL})
    opener = urllib.request.build_opener(proxy)
    try:
        with opener.open('https://qianniu-erp.cc/api/health', timeout=15) as r:
            body = r.read().decode(errors='ignore')
            log('  /api/health →', body[:300])
            data = json.loads(body)
            if data.get('version') == '2.0.0':
                log('✅ V2.0 健康检查通过，版本匹配')
            else:
                log('⚠️  版本可能未生效，返回=', data)
    except Exception as e:
        log('❌ 健康检查失败：', e)

    # 6) 测登录接口是否可达 (冒烟，不实际登录)
    try:
        req = urllib.request.Request('https://qianniu-erp.cc/api/v1/auth/login',
                                     data=json.dumps({"username":"__smoke__","password":"__bad__"}).encode(),
                                     headers={'Content-Type':'application/json'})
        with opener.open(req, timeout=15) as r:
            log('  /api/v1/auth/login 响应=', r.status)
    except urllib.error.HTTPError as e:
        log('  /api/v1/auth/login →', e.code, '(401/400 都算OK)')
    except Exception as e:
        log('⚠️  /api/v1/auth/login fail:', type(e).__name__, e)

    log('\n🎉 V2.0 部署完成。请刷新 https://qianniu-erp.cc/app/ 登录验证')
    return 0

if __name__ == '__main__':
    sys.exit(main())
