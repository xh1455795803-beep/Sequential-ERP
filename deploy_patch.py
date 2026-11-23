#!/usr/bin/env python3
"""补 RPC + 种子数据（表已存在）"""
import socket, time, sys
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
    for _ in range(15):
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
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('proxy failed')

def connect():
    sock = make_proxy_sock()
    t = paramiko.Transport(sock)
    t.start_client()
    t.auth_password(USER, PASS)
    c = paramiko.SSHClient()
    c._transport = t
    c._sftp_live = False
    return c, t

def run(c, cmd, timeout=120):
    print(f'🔹 {cmd[:120]}')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:600])
    if err: print(f'  stderr: {err[:300]}')
    if rc != 0: print(f'  ⚠️ exit_code={rc}')
    return rc, out, err

def run_stdin(c, cmd, data, timeout=120):
    print(f'🔹 {cmd[:100]} ({len(data)} bytes)')
    stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout)
    stdin.write(data.encode() if isinstance(data, str) else data)
    stdin.channel.shutdown_write()
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    rc = stdout.channel.recv_exit_status()
    if out: print(out[:600])
    if err: print(f'  stderr: {err[:300]}')
    if rc != 0: print(f'  ⚠️ exit_code={rc}')
    return rc, out, err

c, t = connect()

# ===== 1. 先清掉之前可能的残留 =====
run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  DELETE FROM auth.users WHERE email LIKE '%thalvior%dev%';
  DELETE FROM tlv_warehouses WHERE code = 'WH-SZ-001';
  DELETE FROM tlv_billing_rules WHERE rule_name IN ('基础打包费','重计费','COD 手续费','仓租','入库处理');
  DELETE FROM tlv_merchant_products WHERE sku = 'SKU-001';
  DELETE FROM tlv_merchants WHERE business_name = '测试商家';
\"""")

# ===== 2. 补 RPC =====
with open('/workspace/saas_v7_clean.sql') as f:
    full = f.read()
# 找到 RPC 部分
rpc_start = full.find('-- calc_outbound_charge')
rpc_end = full.find('GRANT EXECUTE', rpc_start) + len('GRANT EXECUTE ON FUNCTION calc_outbound_charge(uuid, numeric) TO authenticated, anon;')
rpc_sql = full[rpc_start:rpc_end]
print(f'\n🔧 应用 RPC ({len(rpc_sql)} bytes)')
rc, out, err = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', rpc_sql)
if rc == 0 or 'ERROR' not in err:
    print('✅ RPC 成功')
else:
    print(f'❌ RPC 失败: {err}')

# 验证 RPC
rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT proname FROM pg_proc WHERE proname='calc_outbound_charge';
\"""")
print(f'📊 RPC 验证: {"✅" if "calc_outbound_charge" in out else "❌"}')

# ===== 3. 种子数据 =====
print('\n🌱 种子数据')

# 3a. 仓库 — 用 -t -A + 过滤只拿 UUID
rc, wh_out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  INSERT INTO tlv_warehouses (name, code, country, city, address, contact_name, contact_phone, contact_email, billing_mode, status)
  VALUES ('深圳前海云仓', 'WH-SZ-001', 'CN', '深圳', '南山区前海路100号', '王仓管', '13800138000', 'wh@thalvior.dev', 'per_pkg', 'active')
  RETURNING id::text;
\"""")
# -t -A 模式下只输出 RETURNING 的值（但 INSERT 消息可能也混在一起？让我们验证）
# 解析：找看起来像 UUID 的那一行
wh_uuid = ''
for line in wh_out.strip().split('\n'):
    line = line.strip()
    if len(line) == 36 and line[8] == '-' and line[13] == '-':
        wh_uuid = line
        break
print(f'📦 warehouse_id: {wh_uuid}')

if not wh_uuid:
    print('❌ warehouse 创建失败，先不继续种子')
    wh_uuid = ''  # 空着，后面 merchant 直接用 self-join 拿

if wh_uuid:
    wh_sql = wh_uuid.replace("'", "''")
    
    # 3b. auth.users
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
    
    # 3c. merchant — 用 auth.users.id
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
INSERT INTO tlv_merchants (id, warehouse_id, business_name, contact_name, contact_email, country, balance, status)
SELECT id, '{wh_sql}'::uuid, '测试商家', '李老板', 'merchant@thalvior.dev', 'CN', 5000.00, 'active'
FROM auth.users WHERE email = 'merchant@thalvior.dev';
""")
    
    # 3d. 修正 merchant tenant_id 指向自己（覆盖之前的 warehouse_id）
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', """
WITH m AS (SELECT id FROM tlv_merchants WHERE contact_email = 'merchant@thalvior.dev' LIMIT 1)
UPDATE auth.users
SET raw_user_meta_data = jsonb_set(
  COALESCE(raw_user_meta_data, '{}'::jsonb),
  '{tenant_id}', to_jsonb(m.id::text)
) FROM m WHERE email = 'merchant@thalvior.dev';
""")
    
    # 3e. billing rules
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
INSERT INTO tlv_billing_rules (warehouse_id, rule_type, rule_name, unit, rate, priority, status) VALUES
  ('{wh_sql}'::uuid, 'packaging', '基础打包费', 'order', 3.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'weight', '重计费', 'kg', 8.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'cod', 'COD 手续费', 'pct', 3.00, 100, 'active'),
  ('{wh_sql}'::uuid, 'storage', '仓租', 'sku_day', 0.05, 100, 'active'),
  ('{wh_sql}'::uuid, 'inbound', '入库处理', 'pcs', 0.50, 100, 'active');
""")
    
    # 3f. 示例 SKU
    run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', f"""
WITH m AS (SELECT id FROM tlv_merchants WHERE contact_email = 'merchant@thalvior.dev' LIMIT 1)
INSERT INTO tlv_merchant_products (merchant_id, warehouse_id, sku, name, weight_kg, length_cm, width_cm, height_cm, status)
SELECT m.id, '{wh_sql}'::uuid, 'SKU-001', '测试商品 A', 0.5, 15, 10, 5, 'active' FROM m;
""")

    print('✅ 种子数据完成')
else:
    print('⚠️ 跳过种子数据（warehouse_id 为空）')

# ===== 4. 最终验证 =====
print('\n--- 最终验证 ---')
for path in ['/merchant/login', '/wms/login', '/admin/login', '/assets/index-DNGO2v2a.js']:
    rc, out, _ = run(c, f'curl -s -o /dev/null -w "%{{http_code}}" https://thalvior.icu{path}')
    print(f'  {path} → HTTP {out}')

rc, out, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT email, raw_user_meta_data->>'portal_role' as role FROM auth.users WHERE email LIKE '%thalvior%dev%';
\"""")
print(f'\n📊 auth.users 验证:\n{out}')

c.close()
print('\n🎉 完成!')
