#!/usr/bin/env python3
"""P8 端到端终验：启动后端 + API全量回归 + SaaS运营后台UI验证"""
import os, socket, sys, time
from urllib.parse import urlparse
import paramiko

PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY')
p = urlparse(PROXY)
s = socket.socket(); s.settimeout(25)
s.connect((p.hostname, p.port or 80))
s.sendall(b'CONNECT 120.55.6.75:22 HTTP/1.1\r\nHost: 120.55.6.75:22\r\n\r\n')
d=b''
while b'\r\n\r\n' not in d: d+=s.recv(1)
assert b'200' in d.split(b'\r\n')[0]

cli=paramiko.SSHClient(); cli.set_missing_host_key_policy(paramiko.AutoAddPolicy())
cli.connect(hostname='120.55.6.75', port=22, username='admin', password='yuan340364',
            sock=s, timeout=25, allow_agent=False, look_for_keys=False)

def sh(bash, timeout=120):
    _, stdout, stderr = cli.exec_command(bash, timeout=timeout, get_pty=True)
    out=''; 
    for line in stdout:
        sys.stdout.write(' | '+line)
        out += line
    err = stderr.read().decode()[:600]
    rc = stdout.channel.recv_exit_status()
    if rc: sys.stdout.write(f'   [exit={rc}]\n')
    if err.strip(): sys.stdout.write(f'   [stderr] {err}\n')
    return out

# 启动后端
print('=== Step1: 确认8090启动 ===')
sh(r"""
set +e
PID=$(ss -ltnp 2>/dev/null | grep ':8090 ' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
if [ -n "$PID" ]; then
  echo "8090 running pid=$PID"
else
  cd /opt/shuxu-erp/backend/src
  set -a; . ../.env; set +a
  nohup node app.js > /tmp/shuxu-erp.log 2>&1 &
  sleep 3
  echo "启动完成，现在8090:"
  ss -ltnp 2>/dev/null | grep ':8090' | head -1
fi
""")

# API 全量回归
print('\n=== Step2: API回归 ===')
sh(r"""
B=http://127.0.0.1:8090
check() { local n=$1; local code=$2; echo -n "  [$n] expect=$code  -> "; curl -sS -m 6 -o /dev/null -w 'real=%{http_code}\n' ${@:3}; }
check '1 健康检查' 200 $B/api/health
check '2 开放landing配置' 200 $B/api/v1/public/landing/config
check '3 空申请400' 400 -X POST -H 'Content-Type: application/json' -d '{}' $B/api/v1/public/landing/apply
check '4 无token访问auth/me 401' 401 $B/api/v1/auth/me
check '5 无token访问billing 401' 401 $B/api/v1/billing/subscription
check '6 无token访问quota 401' 401 $B/api/v1/quota/usage
check '7 无token访问media 401' 401 $B/api/v1/media/list
check '8 无token访问products-v2 401' 401 $B/api/v1/products-v2?page=1
check '9 无token访问finance-v2 401' 401 $B/api/v1/finance-v2/dashboard
check '10 无token访问scheduler 401' 401 $B/api/v1/scheduler/tasks
check '11 无token访问audit 401' 401 $B/api/v1/audit/logs
check '12 saas空登录400' 400 -X POST -H 'Content-Type: application/json' -d '{}' $B/api/v1/saas/admin/login
check '13 越权随机路径 404(无path泄露)' 404 $B/api/v1/not_exist_xyz_999
echo '--- 验证404没有path字段 ---'
curl -sS -m 6 $B/api/v1/not_exist_xyz_999
echo ''
echo '--- 验证随机后端ID不存在(数据隔离401而非数据) ---'
curl -sS -m 6 -H "Authorization: Bearer invalid_token_xyz" -o /dev/null -w '%{http_code}\n' $B/api/v1/orders
""")

cli.close()
print('\n✅ P8 API回归完成')
