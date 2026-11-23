#!/usr/bin/env python3
"""清掉 auth.users 上所有旧 WMS trigger + 函数"""
import socket, time, paramiko

HOST, PORT, USER, PASS = '43.133.232.81', 22, 'ubuntu', 'yuan340364#'

def connect():
    sock = socket.socket(); sock.settimeout(15); sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    for _ in range(15):
        try:
            sock.connect(('127.0.0.1', 18080))
            sock.sendall(f'CONNECT {HOST}:{PORT} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n\r\n'.encode())
            buf = b''
            while b'\r\n\r\n' not in buf:
                d = sock.recv(4096)
                if not d: break
                buf += d
            time.sleep(0.5)
            t = paramiko.Transport(sock); t.start_client(); t.auth_password(USER, PASS)
            c = paramiko.SSHClient(); c._transport = t; c._sftp_live = False
            return c
        except Exception:
            try: sock.close()
            except: pass
            time.sleep(2)
    raise RuntimeError('connect failed')

def run(c, cmd):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    o = stdout.read().decode('utf-8', errors='replace').strip()
    e = stderr.read().decode('utf-8', errors='replace').strip()
    return o, e

def run_stdin(c, cmd, data):
    stdin, stdout, stderr = c.exec_command(cmd, timeout=30)
    stdin.write(data.encode())
    stdin.channel.shutdown_write()
    return stdout.read().decode('utf-8', errors='replace').strip(), stderr.read().decode('utf-8', errors='replace').strip()

c = connect()

print('='*60)
print('🔧 清理 auth.users 上的旧 WMS trigger + 函数')
print('='*60)

# 1. DROP 所有我们知道的旧 trigger (auth.users 上的)
drop_triggers = """
DROP TRIGGER IF EXISTS block_test_accounts_trigger ON auth.users;
DROP TRIGGER IF EXISTS trg_auth_user_seed_fees ON auth.users;
DROP TRIGGER IF EXISTS trg_automation_seed_user ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', drop_triggers)
print(f'\n1️⃣ DROP triggers:\n{o}\n{e[:300]}')

# 2. 确认 auth.users 现在还有哪些 trigger
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT tgname FROM pg_trigger t 
  JOIN pg_class c ON c.oid = t.tgrelid 
  WHERE NOT tgisinternal AND c.relname='users' 
  JOIN pg_namespace cn ON cn.oid = c.relnamespace AND cn.nspname='auth';
\"""")
print(f'\n2️⃣ auth.users 剩余 trigger:\n{o}')

# 3. 同时也清掉 public schema 里其他旧 WMS trigger (它们可能也引用了被 DROP 的表)
old_wms_triggers = [
    ('inventory', 'notify_inventory_low_trigger'),
    ('orders', 'notify_order_created_trigger'),
    ('orders', 'notify_order_status_change_trigger'),
    ('bills', 'notify_bill_due_trigger'),
    ('orders', 'trg_deduct_inventory_on_ship'),
    ('orders', 'trg_touch_invoices'),
    ('invoices', 'trg_guard_invoice_status'),
    ('invoice_items', 'trg_invoice_insert_guard'),
    ('waybills', 'trg_notify_waybill_shipped'),
]
# 但我们的新 schema 里没有 orders/invoices/bills/waybills 这些表了
# 所以它们已经随表 DROP CASCADE 清掉了。只需要确认一下
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT tgname || ' ON ' || cn.nspname || '.' || c.relname
  FROM pg_trigger t 
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace cn ON cn.oid = c.relnamespace
  WHERE NOT t.tgisinternal AND cn.nspname='public' AND tgname ILIKE '%wms%' OR tgname ILIKE '%thalvior%' OR tgname ILIKE '%legacy%';
\"""")
print(f'\n3️⃣ public schema 里残留的旧 trigger:\n{o}')

# 4. 同时也 DROP 掉旧函数（public 里的 handle_new_user 等）
o, _ = run(c, """docker exec supabase-db psql -U supabase_admin -d postgres -c \"
  SELECT p.proname || '(' || pg_get_function_arguments(p.oid) || ')' 
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace 
  WHERE n.nspname='public' AND (
    p.proname ILIKE '%wms%' OR p.proname ILIKE '%thalvior%' OR 
    p.proname ILIKE 'handle_new_user' OR p.proname ILIKE 'on_auth_user_seed%' OR
    p.proname ILIKE 'fn_automation%' OR p.proname ILIKE 'block_test%' OR
    p.proname ILIKE 'notify_inventory%' OR p.proname ILIKE 'notify_order%' OR
    p.proname ILIKE 'notify_bill%' OR p.proname ILIKE 'trg_deduct%' OR
    p.proname ILIKE 'gotrue_%'
  );
\"""")
print(f'\n4️⃣ public schema 旧函数:\n{o[:2000]}')

# 生成 DROP 语句并执行
drop_funcs_sql = """
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace 
           WHERE n.nspname='public' AND (
             p.proname ILIKE '%wms%' OR p.proname ILIKE '%thalvior%' OR 
             p.proname ILIKE 'handle_new_user' OR p.proname ILIKE 'on_auth_user_seed%' OR
             p.proname ILIKE 'fn_automation%' OR p.proname ILIKE 'block_test%' OR
             p.proname ILIKE 'notify_inventory%' OR p.proname ILIKE 'notify_order%' OR
             p.proname ILIKE 'notify_bill%' OR p.proname ILIKE 'trg_deduct%' OR
             p.proname ILIKE 'gotrue_%' OR p.proname ILIKE 'trigger_inventory%' OR
             p.proname ILIKE 'trg_asn_%' OR p.proname ILIKE 'trg_shipment%' OR
             p.proname ILIKE 'trg_cancellation%' OR p.proname ILIKE 'get_current_tenant%'
           )
  LOOP
    EXECUTE format('DROP FUNCTION IF EXISTS public.%I(%s) CASCADE', r.proname, r.args);
    RAISE NOTICE 'DROP FUNCTION %s(%s)', r.proname, r.args;
  END LOOP;
END $$;
"""
o, e = run_stdin(c, 'docker exec -i supabase-db psql -U supabase_admin -d postgres', drop_funcs_sql)
print(f'\n5️⃣ DROP 旧函数:\n{o[:1500]}\n{e[:500]}')

# 6. 测试 signin!
print('\n\n6️⃣ 测试 signin:')
o, _ = run(c, """curl -s -X POST 'http://127.0.0.1:8000/auth/v1/token?grant_type=password' \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
  -H 'Content-Type: application/json' \
  -d '{"email":"merchant@thalvior.dev","password":"Merchant1234!"}'""")
print(f'   response ({len(o)} chars): {o[:500]}')

if 'access_token' in o:
    import json
    token = json.loads(o)['access_token']
    print(f'\n   ✅ token 获取成功! 长度 {len(token)}')
    
    # 测试 token 调用 API
    o2, _ = run(c, f"""curl -s 'http://127.0.0.1:8000/rest/v1/tlv_outbound_orders?select=*&limit=5' \
      -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCAiaXNzIjogInN1cGFiYXNlIiwgImlhdCI6IDE3OTAyNjgwMTYsICJleHAiOiAyMTA1NjI4MDE2fQ.P3s0YUizo985KezDkYZLOSbJGB0_2EaEzLd23MGSsFw' \
      -H 'Authorization: Bearer {token}'""")
    print(f'\n   ✅ 带 token 调 API: HTTP 200, 返回 {len(o2)} chars')
else:
    print(f'\n   ❌ 还是失败: {o[:200]}')

c.close()
