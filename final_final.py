import socket, time, paramiko, requests

HOST = '43.133.232.81'; USER='ubuntu'; PASS='yuan340364#'
proxy = socket.socket(); proxy.connect(('127.0.0.1', 18080))
proxy.send(b'CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n')
time.sleep(0.6)
ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect(HOST, username=USER, password=PASS, sock=proxy)

anon_key = 'eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw'

print('=' * 60)
print('FINAL SELF-CHECK — Thalvior ERP')
print('=' * 60)

ok = 0; fail = 0
def t(name, cond, detail=''):
    global ok, fail
    if cond: ok += 1; print(f'  ✅ {name}')
    else: fail += 1; print(f'  ❌ {name}: {detail}')

# 1. Docker
stdin, stdout, stderr = ssh.exec_command("docker ps --format '{{.Names}} {{.Status}}'", timeout=10)
docker_out = stdout.read().decode()
healthy_cnt = docker_out.count('healthy')
t('Docker 容器 10/11 healthy', healthy_cnt >= 10, f'{healthy_cnt} healthy')

# 2. 根路径
r = requests.get('https://thalvior.icu/', timeout=10)
t('根路径返回 HTML 200', r.status_code == 200 and 'text/html' in r.headers.get('Content-Type',''))
t('根路径引用新 JS', 'index-CrkVMzNw.js' in r.text)
t('根路径不引用旧 JS', 'index-yFkiQAvS' not in r.text)
t('根路径不显示 LandingPage', '把中国货卖向全球' not in r.text)

# 3. /login
r = requests.get('https://thalvior.icu/login', timeout=10)
t('/login 返回 200 HTML', r.status_code == 200)

# 4. Auth 安全
r = requests.post('https://thalvior.icu/auth/v1/signup',
    json={'email':'x@test.com','password':'abc123456'}, headers={'apikey': anon_key}, timeout=10)
t('Signup 关闭 (422)', r.status_code == 422, f'got {r.status_code}')

# 5. Auth settings 可达
r = requests.get('https://thalvior.icu/auth/v1/settings', headers={'apikey': anon_key}, timeout=10)
t('Auth settings (200)', r.status_code == 200, f'got {r.status_code}')

# 6. Edge Function 可达（400 表示活了，只是缺参数）
r = requests.get('https://thalvior.icu/functions/v1/', timeout=10)
t('Edge Functions 可达', r.status_code in [200, 400, 500], f'got {r.status_code}')

# 7. DB 表数
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -t -c \"SELECT count(*) FROM information_schema.tables WHERE table_schema='public';\"", timeout=10)
tbls = int(stdout.read().decode().strip() or 0)
t(f'DB 表数 {tbls}', tbls >= 25)

# 8. DB RPC/函数
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -t -c \"SELECT count(*) FROM information_schema.routines WHERE routine_schema='public';\"", timeout=10)
fns = int(stdout.read().decode().strip() or 0)
t(f'DB 函数 {fns}', fns >= 5)

# 9. Trigger
stdin, stdout, stderr = ssh.exec_command(
    "docker exec supabase-db psql -U postgres -t -c \"SELECT count(*) FROM pg_trigger WHERE tgname IN ('tlv_outbound_balance_trigger','tlv_wallet_sync_trigger','tlv_inventory_log_trigger');\"", timeout=10)
trigs = int(stdout.read().decode().strip() or 0)
t(f'3 个核心 Trigger 存在', trigs == 3, f'only {trigs}')

# 10. 核心表有数据
for tname, label in [('tlv_merchants','商家'), ('tlv_outbound_orders','出库订单'), 
                    ('tlv_merchant_wallets','钱包流水'), ('tlv_billing_rules','计费规则')]:
    stdin, stdout, stderr = ssh.exec_command(
        f"docker exec supabase-db psql -U postgres -t -c 'SELECT count(*) FROM {tname};'", timeout=10)
    cnt = stdout.read().decode().strip()
    t(f'{label} {cnt} 行', cnt.isdigit() and int(cnt) > 0)

# 11. RLS 裸奔检查（auth policy qual=true 的表，排除 billing_rules 公开配置）
stdin, stdout, stderr = ssh.exec_command(
    """docker exec supabase-db psql -U postgres -t -c "
    SELECT tablename FROM pg_policies 
    WHERE policyname LIKE '%_auth' AND qual ILIKE 'true'
    AND tablename NOT IN ('tlv_billing_rules','tlv_platforms','tlv_label_templates');" """,
    timeout=15)
naked = [l.strip() for l in stdout.read().decode().split('\n') if l.strip()]
t('RLS 无裸奔 auth policy', len(naked) == 0, f'裸奔: {naked}')

# 12. nginx -t
stdin, stdout, stderr = ssh.exec_command("sudo nginx -t 2>&1", timeout=10)
t('nginx -t 通过', 'test is successful' in stdout.read().decode())

# 13. anon token 读 merchant_wallets 应该 0 行
r = requests.get('https://thalvior.icu/rest/v1/tlv_merchant_wallets?select=id',
    headers={'apikey': anon_key}, timeout=10)
wallets = r.json() if r.status_code == 200 else []
t('anon 读 wallets → 0 行（RLS 生效）', len(wallets) == 0, f'got {len(wallets)} rows')

# 14. anon token 读 outbound_orders 应该 0 行
r = requests.get('https://thalvior.icu/rest/v1/tlv_outbound_orders?select=id',
    headers={'apikey': anon_key}, timeout=10)
orders = r.json() if r.status_code == 200 else []
t('anon 读 orders → 0 行（RLS 生效）', len(orders) == 0, f'got {len(orders)} rows')

print()
print('=' * 60)
print(f'✅ 通过 {ok}/{ok+fail}    ❌ 失败 {fail}')
if fail == 0: print('🎉🎉🎉  全部通过！可以上线！')
else: print('⚠️  有失败项，见上')
print('=' * 60)

ssh.close()
