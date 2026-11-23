#!/usr/bin/env python3
"""Thalvior v7 部署 — 干净版"""
import socket, time, sys, io, tarfile
import paramiko

HOST = '43.133.232.81'
PORT = 22
USER = 'ubuntu'
PASS = 'yuan340364#'
PROXY = ('127.0.0.1', 18080)

def make_proxy_sock():
    sock = socket.socket()
    sock.settimeout(15)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for attempt in range(15):
        try:
            sock.connect(PROXY)
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(0.5)
            return sock
        except Exception as e:
            print(f'  proxy attempt {attempt+1} failed: {e}')
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('proxy connect failed after 15 attempts')

def connect():
    sock = make_proxy_sock()
    t = paramiko.Transport(sock)
    t.start_client()
    t.auth_password(USER, PASS)
    c = paramiko.SSHClient()
    c._transport = t
    c._sftp_live = False
    print(f'✅ SSH 已连接 {HOST}')
    return c, t

def run(c, cmd, timeout=120):
    print(f'🔹 {cmd[:150]}')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:800])
    if err: print(f'  stderr: {err[:400]}')
    if rc != 0: print(f'  ⚠️ exit_code={rc}')
    return rc, out, err

def run_stdin(c, cmd, data, timeout=180):
    print(f'🔹 {cmd[:120]} ({len(data)} bytes)')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    stdin.write(data.encode() if isinstance(data, str) else data)
    stdin.channel.shutdown_write()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:800])
    if err: print(f'  stderr: {err[:400]}')
    if rc != 0: print(f'  ⚠️ exit_code={rc}')
    return rc, out, err

c, t = connect()

# ====== STEP 0: 彻底 DROP 所有 tlv_*/wms_* + 旧 RPC ======
print('\n--- STEP 0: 彻底清理 ---')

# 0a. 用 -t -A 生成干净的 DROP SQL（无表格头）
rc, drop_lines, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT 'DROP TABLE IF EXISTS ' || quote_ident(tablename) || ' CASCADE;' 
  FROM pg_tables WHERE schemaname='public' 
  AND (tablename LIKE 'tlv_%' OR tablename LIKE 'wms_%');
\"""")
# 过滤掉空行和 ?column? 头部
clean_drop = '\n'.join(l.strip() for l in drop_lines.split('\n') 
                       if l.strip() and 'DROP TABLE' in l)
print(f'📦 {len(clean_drop.split(chr(10)))} 张表要 DROP')
if clean_drop:
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', clean_drop)

# 0b. 删除残留类型
rc, type_out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT 'DROP TYPE IF EXISTS ' || quote_ident(typtname) || ' CASCADE;'
  FROM pg_type WHERE typtnamespace='public'::regnamespace AND (typtname LIKE 'tlv_%' OR typtname LIKE 'wms_%');
\"""")
clean_types = '\n'.join(l.strip() for l in type_out.split('\n') 
                        if l.strip() and 'DROP TYPE' in l)
if clean_types:
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', clean_types)

# 0c. 删除旧函数/RPC
run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  DROP FUNCTION IF EXISTS calc_outbound_charge(uuid, numeric) CASCADE;
  DROP FUNCTION IF EXISTS calc_outbound_charge(uuid, double precision) CASCADE;
\"""")

# 0d. 删除旧 RLS policy（可能残留）
rc, pol_out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT 'DROP POLICY IF EXISTS ' || quote_ident(polname) || ' ON ' || quote_ident(tablename) || ';'
  FROM pg_policies WHERE schemaname='public' AND (tablename LIKE 'tlv_%' OR tablename LIKE 'wms_%');
\"""")
clean_pol = '\n'.join(l.strip() for l in pol_out.split('\n') if l.strip() and 'DROP POLICY' in l)
if clean_pol:
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', clean_pol)

# 0e. 确认干净了
rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT count(*) FROM pg_tables WHERE schemaname='public' AND (tablename LIKE 'tlv_%' OR tablename LIKE 'wms_%');
\"""")
remaining = out.strip()
print(f'📊 剩余旧表: {remaining}')

# 0f. 清理 auth.users
run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  DELETE FROM auth.users WHERE email LIKE '%thalvior%dev%' OR email LIKE '%thalvior%demo%';
\"""")

# ====== STEP 1: 上传 dist ======
print('\n--- STEP 1: 上传前端 ---')
buf = io.BytesIO()
with tarfile.open(fileobj=buf, mode='w:gz') as tar:
    tar.add('/workspace/wms-app/dist', arcname='.')
sftp = c.open_sftp()
with sftp.file('/tmp/saas_v7_dist.tgz', 'wb') as f:
    f.write(buf.getvalue())
sftp.close()

# ====== STEP 2: 应用 schema ======
print('\n--- STEP 2: 应用 Schema ---')
# 从 schema 里去掉开头的 DROP DO $$ 块（我们已经手动 DROP 过了）
with open('/workspace/saas_v7_clean.sql', 'r') as f:
    full = f.read()
idx = full.find('-- 平台层')
schema_body = full[idx:] if idx > 0 else full

rc, out, err = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', schema_body)

# 验证 tlv_warehouses 有 city 字段
rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT column_name FROM information_schema.columns 
  WHERE table_name='tlv_warehouses' ORDER BY ordinal_position;
\"""")
print(f'📊 tlv_warehouses 字段:\n{out.strip()}')

rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT column_name FROM information_schema.columns 
  WHERE table_name='tlv_merchants' ORDER BY ordinal_position;
\"""")
print(f'📊 tlv_merchants 字段:\n{out.strip()}')

# 验证表数量
rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'tlv_%';
\"""")
print(f'📊 tlv_* 表总数: {out.strip()}')

# 验证 RPC
rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT proname FROM pg_proc WHERE proname='calc_outbound_charge';
\"""")
print(f'📊 calc_outbound_charge: {"✅ 存在" if out.strip() else "❌ 缺失"}')

# ====== STEP 3: 部署 dist ======
print('\n--- STEP 3: 部署 ---')
run(c, 'sudo rm -rf /var/www/wms && sudo mkdir -p /var/www/wms')
run(c, 'sudo tar xzf /tmp/saas_v7_dist.tgz -C /var/www/wms')
run(c, 'sudo chown -R www-data:www-data /var/www/wms')
run(c, 'sudo ln -sf /var/www/wms/assets /var/www/assets 2>/dev/null; sudo nginx -s reload 2>/dev/null; echo done')

# ====== STEP 4: 种子 ======
print('\n--- STEP 4: 种子 ---')

# 4a. 仓库
rc, out, _ = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres -t -A', """
INSERT INTO tlv_warehouses (name, code, country, city, address, contact_name, contact_phone, contact_email, billing_mode, status)
VALUES ('深圳前海云仓', 'WH-SZ-001', 'CN', '深圳', '南山区前海路100号', '王仓管', '13800138000', 'wh@thalvior.dev', 'per_pkg', 'active')
RETURNING id::text;
""")
wh_uuid = out.strip().split('\n')[-1].strip()
print(f'📦 warehouse_id: {wh_uuid}')

if not wh_uuid or len(wh_uuid) < 10:
    print('❌ 仓库创建失败，退出')
    sys.exit(1)
wh_sql = wh_uuid.replace("'", "''")

# 4b. auth.users
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, confirmation_token, raw_user_meta_data, raw_app_meta_data, created_at)
VALUES
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'merchant@thalvior.dev', crypt('Merchant1234!', gen_salt('bf')),
    now(), '', '{{"portal_role":"merchant","tenant_id":"{wh_sql}"}}'::jsonb,
    '{{"provider":"email","providers":["email"]}}'::jsonb, now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'wms@thalvior.dev', crypt('Wms1234!', gen_salt('bf')),
    now(), '', '{{"portal_role":"warehouse","tenant_id":"{wh_sql}"}}'::jsonb,
    '{{"provider":"email","providers":["email"]}}'::jsonb, now()),
  ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
    'admin@thalvior.dev', crypt('Admin1234!', gen_salt('bf')),
    now(), '', '{{"portal_role":"admin","tenant_id":null}}'::jsonb,
    '{{"provider":"email","providers":["email"]}}'::jsonb, now());
""")

# 4c. merchant
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
INSERT INTO tlv_merchants (id, warehouse_id, business_name, contact_name, contact_email, country, balance, status)
SELECT id, '{wh_sql}'::uuid, '测试商家', '李老板', 'merchant@thalvior.dev', 'CN', 5000.00, 'active'
FROM auth.users WHERE email = 'merchant@thalvior.dev';
""")

# 4d. 修正 tenant_id
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
WITH m AS (SELECT id FROM tlv_merchants WHERE contact_email = 'merchant@thalvior.dev' LIMIT 1)
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{tenant_id}', to_jsonb(m.id::text)
) FROM m WHERE email = 'merchant@thalvior.dev';
""")

# 4e. billing rules
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
INSERT INTO tlv_billing_rules (warehouse_id, rule_type, rule_name, unit, rate, priority, status) VALUES
  ('{wh_sql}'::uuid, 'packaging', '基础打包费', 'order', 3.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'weight', '重计费', 'kg', 8.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'cod', 'COD 手续费', 'pct', 3.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'storage', '仓租', 'sku_day', 0.05, 100, 'active'),
  ('{wh_sql}'::uuid, 'inbound', '入库处理', 'pcs', 0.50, 100, 'active');
""")

# 4f. 示例 SKU
run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
WITH m AS (SELECT id FROM tlv_merchants WHERE contact_email = 'merchant@thalvior.dev' LIMIT 1)
INSERT INTO tlv_merchant_products (merchant_id, warehouse_id, sku, name, weight_kg, length_cm, width_cm, height_cm, status)
SELECT m.id, '{wh_sql}'::uuid, 'SKU-001', '测试商品 A', 0.5, 15, 10, 5, 'active' FROM m;
""")

# ====== STEP 5: HTTP ======
print('\n--- STEP 5: HTTP 验证 ---')
for path in ['/merchant/login', '/wms/login', '/admin/login']:
    rc, out, _ = run(c, f'curl -s -o /dev/null -w "%{{http_code}}" https://thalvior.icu{path}')
    print(f'  {path} → HTTP {out}')
rc, out, _ = run(c, 'curl -s -o /dev/null -w "%{http_code}" https://thalvior.icu/assets/index-C12aLu0K.css')
print(f'  /assets/css → HTTP {out}')

# 清理临时文件
run(c, 'rm -f /tmp/saas_v7_dist.tgz')

c.close()
print('\n' + '='*60)
print('🎉 部署完成!')
print('='*60)
print('''
三端入口：
  🛍️ 商家端: https://thalvior.icu/merchant/login
  🏭 仓库端: https://thalvior.icu/wms/login
  ⚙️ 管理端: https://thalvior.icu/admin/login

dev 测试账号（生产前删除）：
  merchant@thalvior.dev  / Merchant1234!  (商家)
  wms@thalvior.dev       / Wms1234!        (仓库)
  admin@thalvior.dev     / Admin1234!      (平台管理员)
''')
