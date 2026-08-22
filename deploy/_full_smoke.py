#!/usr/bin/env python3
"""端到端冒烟：API+官网+登录测试"""
import os, socket, sys
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

def sh(bash):
    _, stdout, stderr = cli.exec_command(bash, timeout=120, get_pty=True)
    out=''; 
    for line in stdout:
        sys.stdout.write(' | '+line)
        out += line
    err = stderr.read().decode()[:600]
    rc = stdout.channel.recv_exit_status()
    if rc: sys.stdout.write(f'   [exit={rc}]\n')
    if err.strip(): sys.stdout.write(f'   [stderr] {err}\n')
    return out

SH_SMOKE = r"""
B=http://127.0.0.1:8090
echo '===== A. 终版API全量冒烟 ====='
echo '[A1] health:'; curl -sS -m 5 $B/api/health; echo ''
echo '[A2] landing-config keys:'
curl -sS -m 5 $B/api/v1/public/landing/config | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('  keys:', list(d.keys()))
for k,v in list(d.items())[:8]:
    if isinstance(v,list): print(f'   {k}=list(len={len(v)})')
    elif isinstance(v,dict): print(f'   {k}=dict(keys={list(v.keys())[:5]})')
    else: print(f'   {k}={str(v)[:80]}')
" 2>&1 | head -20
echo '[A3] landing-apply 空提交(400):'
curl -sS -m 5 -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/v1/public/landing/apply
echo '[A4] auth/me 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/auth/me
echo '[A5] billing/subscription 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/billing/subscription
echo '[A6] quota/usage 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/quota/usage
echo '[A7] media/list 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/media/list
echo '[A8] products-v2 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/products-v2?page=1
echo '[A9] saas/admin/login 空(4xx):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/v1/saas/admin/login
echo '[A10] finance-v2 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/finance-v2/dashboard
echo '[A11] scheduler 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/scheduler/tasks
echo '[A12] audit/logs 无token(401):'; curl -sS -m 5 -o /dev/null -w '%{http_code}\n' $B/api/v1/audit/logs

echo '
===== B. 官网落地页 + Nginx ====='
echo '[B1] landing目录:'
ls -la /opt/shuxu-erp/landing/ 2>&1 | head -10 || echo 'NO_LANDING_DIR'
echo '[B2] Nginx location/root段:'
grep -nE 'location|root|try_files|alias|index' /etc/nginx/conf.d/shuxu-erp.conf | head -30
echo '[B3] 官网首页HTML前500char:'
curl -sS -m 10 -k https://127.0.0.1/ 2>&1 | head -c 600; echo ''
echo '[B4] 域名官网 HTTP:'
curl -sS -m 12 -o /dev/null -w '%{http_code} size=%{size_download}B\n' https://qianniu-erp.cc/ 2>&1
echo '[B5] ERP app HTTP:'
curl -sS -m 12 -o /dev/null -w '%{http_code} size=%{size_download}B\n' https://qianniu-erp.cc/app/ 2>&1
echo '[B6] 域名 landing config 公网:'
curl -sS -m 14 https://qianniu-erp.cc/api/v1/public/landing/config | head -c 260; echo ''
"""
out_a = sh(SH_SMOKE)

# ---- C. 注册+登录+订阅 ----
SH_C = r"""
B=http://127.0.0.1:8090
DB_USER=$(grep -E '^DB_USER=' /opt/shuxu-erp/backend/.env | cut -d= -f2-)
DB_PASS=$(grep -E '^DB_PASSWORD=' /opt/shuxu-erp/backend/.env | cut -d= -f2-)
[ -z "$DB_USER" ] && DB_USER=shuxu
[ -z "$DB_PASS" ] && DB_PASS='K9mXw7pQ2vRn5tLz'
echo '===== C. 注册+登录+套餐订阅 ====='
echo '[C1] users表 前3:'
mysql -u"$DB_USER" -p"$DB_PASS" shuxu_erp -e "SELECT id,tenant_id,username,role,IFNULL(is_owner,0) is_owner FROM users LIMIT 3;" 2>&1 | head -8
echo '[C2] 注册 test_final_001（如已存在则忽略）:'
RES=$(curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"username":"test_final_001","password":"Test@123456","tenantName":"终版测试租户001"}' \
  $B/api/v1/auth/register 2>&1)
echo "$RES"
echo '[C3] 登录:'
L=$(curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"username":"test_final_001","password":"Test@123456"}' \
  $B/api/v1/auth/login 2>&1)
echo "$L"
TOK=$(printf "%s" "$L" | python3 -c "import sys,json;
try: d=json.load(sys.stdin); print(d.get('token',''))
except: print('')" 2>/dev/null)
echo "token len=${#TOK}"
if [ -z "$TOK" ]; then
  # 兜底：如果注册失败，尝试找DB里任意账号
  echo '[C3-alt] 从DB查询可用账号...'
  ALT=$(mysql -u"$DB_USER" -p"$DB_PASS" shuxu_erp -N -B -e "SELECT username FROM users WHERE role='owner' LIMIT 1;" 2>/dev/null | head -1)
  echo "alt account: [$ALT]"
  if [ -n "$ALT" ]; then
    L=$(curl -sS -m 10 -X POST -H 'Content-Type: application/json' \
      -d "{\"username\":\"$ALT\",\"password\":\"Test@123456\"}" \
      $B/api/v1/auth/login 2>&1)
    TOK=$(printf "%s" "$L" | python3 -c "import sys,json;
try: d=json.load(sys.stdin); print(d.get('token',''))
except: print('')" 2>/dev/null)
    echo "alt token len=${#TOK}"
  fi
fi
if [ -n "$TOK" ]; then
  AUTH="Authorization: Bearer $TOK"
  echo '[C4] auth/me:'
  curl -sS -m 8 -H "$AUTH" $B/api/v1/auth/me | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  u=d.get('user',{}); t=d.get('tenant',{});
  print('  user:',u.get('username'),' role=',u.get('role'),' is_owner=',u.get('is_owner'))
  print('  tenant:',t.get('name'),' plan=',t.get('planName'),' expired=',t.get('expired'))
except Exception as e: print('  parse fail',e)
" 2>&1
  echo '[C5] billing/subscription:'
  curl -sS -m 8 -H "$AUTH" $B/api/v1/billing/subscription | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  s=d.get('subscription') or {}
  print('  plan_code:',s.get('plan_code'),' expire:',s.get('expire_at'),' status:',s.get('status'))
except Exception as e: print('  parse fail',e)
" 2>&1
  echo '[C6] quota/usage:'
  curl -sS -m 8 -H "$AUTH" $B/api/v1/quota/usage | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  u=d.get('usage') or {}
  print('  shop_count=',u.get('shop_count'),' month_orders=',u.get('month_orders'),' product_count=',u.get('product_count'))
except Exception as e: print('  parse fail',e)
" 2>&1
  echo '[C7] billing/orders list:'
  curl -sS -m 8 -H "$AUTH" "$B/api/v1/billing/orders?page=1&size=5" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print('  total=',d.get('total'),' items=',len(d.get('items') or []))
except Exception as e: print('  parse fail',e)
" 2>&1
  echo '[C8] 创建套餐订单(standard/month):'
  curl -sS -m 10 -X POST -H 'Content-Type: application/json' -H "$AUTH" \
    -d '{"order_type":"plan","plan_code":"standard","cycle":"month"}' \
    $B/api/v1/billing/orders | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  print('  status=',d.get('status'))
  o=d.get('order') or {}
  print('  order_no=',o.get('order_no'),' amount=',o.get('amount'),' item=',o.get('item_name'))
except Exception as e: print('  parse fail',e)
" 2>&1
  echo '[C9] billing/orders list (after create):'
  curl -sS -m 8 -H "$AUTH" "$B/api/v1/billing/orders?page=1&size=5" | python3 -c "
import sys,json
try:
  d=json.load(sys.stdin)
  items=d.get('items') or []
  print('  total=',d.get('total'))
  for o in items[:3]:
    print('   #',o.get('order_no'),o.get('item_name'),o.get('amount'),o.get('status'))
except Exception as e: print('  parse fail',e)
" 2>&1
else
  echo 'SKIP C4-C9: 未能获取token'
fi
"""
out_c = sh(SH_C)

cli.close()
print('\n✅ 完整冒烟 Done')
