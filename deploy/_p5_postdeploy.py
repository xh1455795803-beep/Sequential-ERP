#!/usr/bin/env python3
"""通过 HTTP CONNECT SSH 到服务器：执行 migrate-v5/v6-final + 启动后端 + 冒烟API + 官网落地页检查"""
import os, sys
from pathlib import Path
from urllib.parse import urlparse
import paramiko
import socket

PROXY_URL = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy') or os.environ.get('HTTP_PROXY')
HOST = '120.55.6.75'
USER = 'admin'
PASS = 'yuan340364'

def log(*a, **k): print('[fix]', *a, flush=True, **k)

p = urlparse(PROXY_URL)
ph, pp = p.hostname, p.port or 80
log(f'CONNECT {ph}:{pp} -> {HOST}:22')
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.settimeout(25)
s.connect((ph, pp))
s.sendall(f'CONNECT {HOST}:22 HTTP/1.1\r\nHost: {HOST}:22\r\n\r\n'.encode())
data = b''
while b'\r\n\r\n' not in data:
    data += s.recv(1)
first = data.split(b'\r\n')[0].decode(errors='ignore')
log('  ', first)
assert '200' in first

cli = paramiko.SSHClient()
cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(hostname=HOST, port=22, username=USER, password=PASS,
            sock=s, timeout=25, banner_timeout=20, auth_timeout=20,
            allow_agent=False, look_for_keys=False)
log('✅ SSH OK')

def run(cmd, timeout=300, sudo=False):
    import shlex
    if sudo: cmd = "sudo -n bash -lc " + shlex.quote(cmd)
    log('$', cmd[:200])
    stdin, stdout, stderr = cli.exec_command(cmd, timeout=timeout, get_pty=True)
    out = []
    while True:
        try: line = stdout.readline()
        except: break
        if not line: break
        sys.stdout.write('   | ' + line)
        out.append(line)
    err = stderr.read().decode(errors='ignore')
    rc = stdout.channel.recv_exit_status()
    if rc != 0: log(f'   exit={rc}'); 
    if err.strip()[:300]: log('   STDERR:', err[:300])
    return rc, ''.join(out), err

# --- 1. migrate-v5 + migrate-v6-final ---
log('\n=== 1. 执行 migrate-v5.js ===')
run("cd /opt/shuxu-erp/backend/src && set -a && . ../.env && set +a && node migrate-v5.js 2>&1 | tail -30")

log('\n=== 2. 执行 migrate-v6-final.js ===')
run("cd /opt/shuxu-erp/backend/src && set -a && . ../.env && set +a && node migrate-v6-final.js 2>&1 | tail -40")

# --- 2. 检查后端进程，启动后端 ---
log('\n=== 3. 检查 8090 端口 ===')
run("ss -ltnp 2>/dev/null | grep ':8090' || echo 'PORT_NOT_LISTEN'")
run("ps aux | grep -E 'node.*(app|index|server)' | grep -v grep | head -5 || echo 'NO_NODE'")

# 优先 pm2，否则 nohup 直接拉起
log('\n=== 4. 启动后端 ===')
start_script = r"""
set +e
cd /opt/shuxu-erp/backend/src
# 先尝试 pm2
if command -v pm2 >/dev/null 2>&1; then
  echo '[pm2] 尝试 pm2 list:'
  pm2 list 2>&1 | head -10
  APP=$(pm2 list 2>/dev/null | grep -iE 'shuxu|erp|app' | awk '{print $4}' | head -1)
  if [ -n "$APP" ]; then
    echo "pm2 restart $APP"
    pm2 restart "$APP" 2>&1 | tail -5
  else
    echo "pm2 start app.js"
    pm2 start app.js --name shuxu-erp 2>&1 | tail -10
  fi
else
  # nohup 兜底
  PID=$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$PID" ] && echo "已有8090 pid=$PID" || {
    echo "nohup node app.js -> /tmp/shuxu-erp.log"
    set -a; . ../.env; set +a
    nohup node app.js > /tmp/shuxu-erp.log 2>&1 &
    sleep 1
    echo "后台启动，pid=$(pgrep -f 'node app.js' | head -1)"
  }
fi
sleep 4
# 探测
echo '--- 探测 127.0.0.1:8090/api/health ---'
curl -sS -m 8 http://127.0.0.1:8090/api/health 2>&1
echo ''
echo '--- tail nohup log (last 15) ---'
tail -15 /tmp/shuxu-erp.log 2>/dev/null || echo 'NO_LOG'
"""
run(start_script, timeout=60)

# --- 5. API冒烟：/billing /media /public/landing 等终版接口 ---
log('\n=== 5. 冒烟测试（终版新增接口）===')
smoke = r"""
set +e
B=http://127.0.0.1:8090
echo '[1] health:'
curl -sS -m 6 $B/api/health ; echo ''
echo '[2] public landing config (开放):'
curl -sS -m 6 $B/api/v1/public/landing/config | head -c 400 ; echo ''
echo '[3] auth/login 结构探测 (POST 无数据应当 400 或 401):'
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/v1/auth/login
echo '[4] billing 未登录应 401:'
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' $B/api/v1/billing/subscription
echo '[5] media 未登录应 401:'
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' $B/api/v1/media/list
echo '[6] quota usage 未登录应 401:'
curl -sS -m 6 -o /dev/null -w '%{http_code}\n' $B/api/v1/quota/usage
echo '[7] 官网根路径 / (Nginx):'
curl -sS -m 8 -o /dev/null -w '%{http_code} -> %{redirect_url}\n' -k https://127.0.0.1/ 2>&1 || echo 'CURL_LOCALHOST_HTTPS_SKIP'
echo '[8] 通过域名官网接口:'
curl -sS -m 10 https://qianniu-erp.cc/api/v1/public/landing/config 2>&1 | head -c 300; echo ''
"""
run(smoke, timeout=60)

log('\n✅ 后端修复+冒烟完成')
cli.close()
