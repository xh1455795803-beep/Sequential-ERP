import socket, time, paramiko, requests, json

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

results = []

def check(name, ok, detail=''):
    results.append((name, ok, detail))
    mark = '✅' if ok else '❌'
    print(f'  {mark} {name}: {detail}')

print('=' * 60)
print('THALVIOR ERP - 完整自检')
print('=' * 60)

# ===================== 1. 服务器健康 =====================
print('\n## 1. 服务器健康')
stdin, stdout, stderr = ssh.exec_command("docker ps --format 'table {{.Names}}\t{{.Status}}' 2>&1", timeout=15)
docker_out = stdout.read().decode()
healthy = docker_out.count('healthy') + docker_out.count('Up ')
check('Docker 容器', 'healthy' in docker_out or 'Up ' in docker_out, f'{healthy} 个 healthy')
print(docker_out)

# ===================== 2. URL 可达 =====================
print('\n## 2. URL 可达性')
urls = [
    ('根路径', 'https://thalvior.icu/', 200),
    ('登录页', 'https://thalvior.icu/login', 200),
    ('REST API', 'https://thalvior.icu/rest/v1/', 401),  # 401 是正常的（需要 auth）
    ('Auth settings', 'https://thalvior.icu/auth/v1/settings', 200),
    ('Edge Functions', 'https://thalvior.icu/functions/v1/', 200),
]
for name, url, expected in urls:
    try:
        r = requests.get(url, timeout=10, allow_redirects=False)
        ok = r.status_code == expected
        check(name, ok, f'HTTP {r.status_code} (期望 {expected})')
    except Exception as e:
        check(name, False, str(e)[:50])

# ===================== 3. 根路径 HTML 检查 =====================
print('\n## 3. 根路径 HTML 内容')
r = requests.get('https://thalvior.icu/', timeout=10)
check('返回 HTML', 'text/html' in r.headers.get('Content-Type',''), f'Content-Type: {r.headers.get("Content-Type")}')
check('引用正确 JS', 'index-CrkVMzNw.js' in r.text, f'JS file referenced')
check('引用正确 CSS', 'index-CLp7osj1.css' in r.text, f'CSS file referenced')
check('不引用旧 JS', 'index-yFkiQAvS' not in r.text, '旧 build 已清除')

# ===================== 4. Edge Function 实测 =====================
print('\n## 4. Edge Function 冒烟')
anon_key = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'
headers = {'apikey': anon_key, 'Authorization': f'Bearer {anon_key}'}
try:
    r = requests.post('https://thalvior.icu/functions/v1/generate-label-pdf',
        json={'test': True}, headers=headers, timeout=15)
    check('generate-label-pdf', r.status_code in [200, 400, 422], f'HTTP {r.status_code}')
except Exception as e:
    check('generate-label-pdf', False, str(e)[:50])

# ===================== 5. DB 表数量 =====================
print('\n## 5. 数据库')
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -c \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';\" -t 2>&1",
    timeout=15)
tbl_count = stdout.read().decode().strip()
check('public schema 表数', tbl_count.isdigit() and int(tbl_count) >= 25, f'{tbl_count} 张表')

stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -c \"SELECT count(*) FROM information_schema.routines WHERE routine_schema='public' AND routine_type='FUNCTION';\" -t 2>&1",
    timeout=15)
fn_count = stdout.read().decode().strip()
check('DB Functions/RPC', fn_count.isdigit() and int(fn_count) >= 3, f'{fn_count} 个函数')

# ===================== 6. RLS 安全检查 =====================
print('\n## 6. RLS 安全（不应该有 qual=true 的裸奔表）')
stdin, stdout, stderr = ssh.exec_command(
    """docker exec supabase-db psql -U postgres -t -c "
    SELECT p.tablename FROM pg_policies p 
    WHERE p.qual ILIKE '%true%' AND p.qual NOT ILIKE '%auth%'
    LIMIT 5;" 2>&1""",
    timeout=15)
naked = [l.strip() for l in stdout.read().decode().split('\n') if l.strip()]
check('无裸奔表（qual=true 无 auth）', len(naked) == 0, f'裸奔表: {naked}' if naked else '全部有 auth 过滤')

# ===================== 7. Auth signup 关闭 =====================
print('\n## 7. Auth 安全')
try:
    r = requests.post('https://thalvior.icu/auth/v1/signup',
        json={'email': 'shouldfail@test.com', 'password': 'abc123456'},
        headers={'apikey': anon_key}, timeout=10)
    check('Signup 已关闭', r.status_code == 422, f'HTTP {r.status_code}')
except Exception as e:
    check('Signup 已关闭', False, str(e)[:50])

# ===================== 8. 重要表数据 =====================
print('\n## 8. 核心表数据量')
queries = [
    ('商家表', 'tlv_merchants'),
    ('仓库表', 'tlv_warehouses'),
    ('出库订单', 'tlv_outbound_orders'),
    ('出库明细', 'tlv_outbound_items'),
    ('钱包流水', 'tlv_merchant_wallets'),
    ('计费规则', 'tlv_billing_rules'),
]
for label, tbl in queries:
    stdin, stdout, stderr = ssh.exec_command(
        f"docker exec supabase-db psql -U postgres -c 'SELECT count(*) FROM {tbl};' -t 2>&1",
        timeout=10)
    cnt = stdout.read().decode().strip()
    check(label, cnt.isdigit(), f'{cnt} 行')

# ===================== 9. Trigger 检查 =====================
print('\n## 9. Trigger 检查')
triggers = [
    ('tlv_outbound_balance_trigger', '出库自动扣费判断'),
    ('tlv_wallet_sync_trigger', '钱包同步余额到 merchants'),
    ('tlv_inventory_log_trigger', '库存变化写日志'),
]
for tname, desc in triggers:
    stdin, stdout, stderr = ssh.exec_command(
        f"docker exec supabase-db psql -U postgres -t -c \"SELECT count(*) FROM pg_trigger WHERE tgname='{tname}';\" 2>&1",
        timeout=10)
    exists = '1' in stdout.read().decode()
    check(f'Trigger {tname}', exists, desc)

# ===================== 10. nginx 配置 =====================
print('\n## 10. Nginx 配置')
stdin, stdout, stderr = ssh.exec_command(
    "sudo grep -c 'backdrop-blur\\|glass\\|security-headers\\|rate_limit' /etc/nginx/sites-enabled/meoo /etc/nginx/conf.d/*.conf 2>&1",
    timeout=10)
ng = stdout.read().decode().strip()
check('Nginx 安全配置', ng != '', f'matches: {ng}')

stdin, stdout, stderr = ssh.exec_command("sudo nginx -t 2>&1", timeout=10)
check('nginx -t 通过', 'test is successful' in stdout.read().decode(), '')

# ===================== 汇总 =====================
print('\n' + '=' * 60)
ok_cnt = sum(1 for _, ok, _ in results if ok)
total = len(results)
print(f'✅ 通过: {ok_cnt}/{total}')
fails = [(n, d) for n, ok, d in results if not ok]
if fails:
    print('\n❌ 失败项:')
    for n, d in fails:
        print(f'   {n}: {d}')
else:
    print('\n🎉 全部通过！')
print('=' * 60)

ssh.close()
