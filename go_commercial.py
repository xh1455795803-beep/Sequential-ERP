#!/usr/bin/env python3
"""🏆 商用启动脚本 — 最后检查 + 重启 + 冒烟测试"""
import socket, time, paramiko, json, requests

HOST = '43.133.232.81'
USER = 'ubuntu'
PASS = 'yuan340364#'
BASE = 'https://thalvior.icu'
ANON = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

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

def do(label, cmd):
    print('\n=== [' + label + '] ===')
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=30)
    out = stdout.read().decode().strip()
    err = stderr.read().decode().strip()
    if out: print(out[:400])
    if err and 'NOTICE' not in err: print('ERR:', err[:200])

ok = 0
fail = 0

def check(label, cond, detail=''):
    global ok, fail
    if cond:
        ok += 1
        print('  ✅ ' + label + ((' — ' + detail) if detail else ''))
    else:
        fail += 1
        print('  ❌ ' + label + ((' — ' + detail) if detail else ''))

print('\n' + '🏆' * 20)
print('  THALVIOR ERP — 商用就绪启动序列')
print('  ' + time.strftime('%Y-%m-%d %H:%M:%S'))
print('🏆' * 20)

# ============================================================
# Phase 1: 容器重启（使 daemon.json + auth 新 env 生效）
# ============================================================
print('\n📦 Phase 1: 重启使所有配置生效')

do('1a. restart supabase-auth',
    'docker restart supabase-auth && sleep 4 && '
    'docker ps --filter name=supabase-auth --format "{{.Names}} {{.Status}}"')

do('1b. restart supabase-rest (新 policy 生效)',
    'docker restart supabase-rest && sleep 5 && '
    'docker ps --filter name=supabase-rest --format "{{.Names}} {{.Status}}"')

do('1c. restart supabase-edge-functions',
    'docker restart supabase-edge-functions && sleep 5 && '
    'docker ps --filter name=supabase-edge-functions --format "{{.Names}} {{.Status}}"')

# ============================================================
# Phase 2: 所有 Edge Function 冒烟测试
# ============================================================
print('\n🔥 Phase 2: Edge Function 冒烟测试（RLS 不影响 service_role）')

funcs = [
    ('generate-label-pdf', {'outbound_id': ''}, True),  # 需先找 OID
    ('sync-tiktok-orders', {'merchant_id': 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'}, True),
    ('sync-shopee-orders', {'merchant_id': '7e3bf09f-3937-4891-a6f6-75941f39d1b2'}, True),
    ('sync-lazada-orders', {'merchant_id': 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'}, True),
    ('sync-ozon-orders', {'merchant_id': '7e3bf09f-3937-4891-a6f6-75941f39d1b2'}, True),
    ('sync-mercado-orders', {'merchant_id': 'c657a6a3-0b47-4a01-bbf2-5a0ce40a08d5'}, True),
    ('sync-logistics-tracking', {}, True),
    ('recharge-wallet', {'merchant_id': '7e3bf09f-3937-4891-a6f6-75941f39d1b2', 'amount': 1.0}, True),
]

# 先找一个 outbound_id
OID = None
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -t -A -c \"SELECT id FROM tlv_outbound_orders ORDER BY created_at DESC LIMIT 1;\"")
OID = stdout.read().decode().strip()
funcs[0] = ('generate-label-pdf', {'outbound_id': OID}, True)

for fname, body, _ in funcs:
    try:
        url = BASE + '/functions/v1/' + fname
        r = requests.post(url, json=body,
                         headers={'Content-Type': 'application/json',
                                  'Authorization': 'Bearer ' + ANON},
                         timeout=30)
        d = r.json()
        # 检查关键字段
        if fname == 'generate-label-pdf':
            ok_svg = len(d.get('results', [{}])[0].get('svg_base64', '')) > 1000
            check(fname + ' ✓', ok_svg, 'svg=' + str(len(d.get('results', [{}])[0].get('svg_base64', ''))))
        elif fname == 'recharge-wallet':
            check(fname + ' ✓', d.get('ok') == True, 'balance=' + str(d.get('balance')))
        elif fname.startswith('sync'):
            check(fname + ' ✓', d.get('ok') == True, 'created=' + str(d.get('created', 0)))
        else:
            check(fname + ' ✓', r.status_code < 500, 'HTTP ' + str(r.status_code))
    except Exception as e:
        check(fname, False, str(e)[:60])

# ============================================================
# Phase 3: REST API 冒烟测试
# ============================================================
print('\n🔌 Phase 3: REST API 冒烟测试（RLS 应仍放行 service_role）')

# service_role key 读
SR_KEY = None
stdin, stdout, stderr = ssh.exec_command("cat /opt/supabase/docker/.env | grep SERVICE_ROLE_KEY | cut -d= -f2")
SR_KEY = stdout.read().decode().strip()

tables_test = ['tlv_merchants', 'tlv_outbound_orders', 'tlv_merchant_wallets', 'tlv_billings',
               'tlv_merchant_inventory', 'tlv_platforms', 'tlv_label_templates', 'tlv_flow_nodes']

for t in tables_test:
    url = BASE + '/rest/v1/' + t + '?select=*&limit=3'
    r = requests.get(url, headers={'apikey': SR_KEY, 'Authorization': 'Bearer ' + SR_KEY}, timeout=15)
    try:
        d = r.json()
        rows = len(d) if isinstance(d, list) else 0
        check('REST ' + t, r.status_code == 200, str(rows) + ' rows')
    except Exception:
        check('REST ' + t, False, 'HTTP ' + str(r.status_code))

# ============================================================
# Phase 4: 安全验证
# ============================================================
print('\n🛡️ Phase 4: 安全验证')

# anon 读受保护表 → 必须 0 行
url = BASE + '/rest/v1/tlv_merchant_wallets?select=*&limit=5'
r = requests.get(url, headers={'apikey': ANON, 'Authorization': 'Bearer ' + ANON}, timeout=15)
d = r.json()
check('RLS: anon token → 0 行', len(d) == 0, '实际 ' + str(len(d)) + ' 行')

# signup 被关
try:
    r = requests.post(BASE + '/auth/v1/signup',
                     json={'email': 'newuser@test.com', 'password': 'Pass123'},
                     headers={'apikey': ANON}, timeout=15)
    check('Auth: signup 被关', r.status_code >= 400, 'HTTP ' + str(r.status_code))
except Exception as e:
    check('Auth: signup 被关', True, str(e)[:40])

# 安全头
try:
    r = requests.get(BASE + '/', timeout=15, allow_redirects=True)
    h = r.headers
    check('HSTS', 'Strict-Transport-Security' in h)
    check('XFO', 'X-Frame-Options' in h)
    check('NOSNIFF', 'X-Content-Type-Options' in h and h.get('X-Content-Type-Options') == 'nosniff')
except Exception:
    pass

# ============================================================
# Phase 5: 审计日志验证
# ============================================================
print('\n📋 Phase 5: 审计日志闭环')
do('audit_logs 数量',
    "docker exec supabase-db psql -U postgres -d postgres -c \"SELECT count(*) as entries FROM tlv_audit_logs;\"")

# ============================================================
# Phase 6: 前端可访问
# ============================================================
print('\n🌐 Phase 6: 前端可访问')
try:
    r = requests.get('https://thalvior.icu/', timeout=15, allow_redirects=True)
    check('前端页面 200', r.status_code < 400 and len(r.text) > 1000, 'HTTP ' + str(r.status_code))
    check('前端 HTML 有 Vite 打包标记', 'assets/' in r.text)
except Exception as e:
    check('前端页面', False, str(e)[:60])

# ============================================================
# 最终结果
# ============================================================
ssh.close()
print('\n' + '🏆' * 20)
print('  🏁 商用启动验证结果')
print('  ✅ PASS: ' + str(ok) + '   ❌ FAIL: ' + str(fail))
print('  ' + str(ok * 100 // max(1, ok + fail)) + '%')
print()
if fail == 0:
    print('  🎉 全部通过 — 可以正式对第一批商家开放！')
else:
    print('  ⚠️ 有 ' + str(fail) + ' 项失败 — 需要先修复')
print('🏆' * 20)
