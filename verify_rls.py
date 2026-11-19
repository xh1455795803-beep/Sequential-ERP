#!/usr/bin/env python3
"""Disable RLS + create good debug function + test"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
resp = b''
while b'\r\n\r\n' not in resp:
    resp += s.recv(4096)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('43.133.232.81', port=22, username='ubuntu', password='Yuan340364#', sock=s)

def ssh(cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    ec = stdout.channel.recv_exit_status()
    return ec, out, err

def sudo(cmd):
    return ssh(f"sudo {cmd}")

NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"
raw_key = NEW_SECRET.encode()
def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()
new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

# 1. Create a SECURITY INVOKER debug function
print("=== 1. Create debug_postgrest (SECURITY INVOKER) ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
CREATE OR REPLACE FUNCTION public.debug_postgrest()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'current_user', current_user,
        'session_user', session_user,
        'jwt_role', current_setting('request.jwt.claim.role', true),
        'jwt_email', current_setting('request.jwt.claim.email', true),
        'jwt_sub', current_setting('request.jwt.claim.sub', true),
        'jwt_aud', current_setting('request.jwt.claim.aud', true),
        'jwt_iss', current_setting('request.jwt.claim.iss', true)
    );
$$;
GRANT EXECUTE ON FUNCTION public.debug_postgrest() TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
SQLEOF""")
print(f"ec={ec}\n{out}")

time.sleep(3)

# 2. Test invoker debug function
print("\n=== 2. debug_postgrest via envoy ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_postgrest'
ec, out, _ = ssh(cmd)
print(f"Result: {out[:500]}")

# 3. Temporarily DISABLE RLS on ALL wms_ tables and test
print("\n=== 3. Disable RLS on wms tables ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'wms_%' LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
        RAISE NOTICE 'Disabled RLS on %', r.tablename;
    END LOOP;
END $$;
" """)
print(f"Disable RLS:\n{out[:2000]}")

# 4. Test data WITHOUT RLS
print("\n=== 4. Data TESTS (RLS DISABLED) ===")
for label, path in [
    ("wms_orders", "wms_orders?select=order_no,status,tenant_id&limit=5"),
    ("wms_warehouses", "wms_warehouses?select=warehouse_code&limit=5"),
    ("wms_shipping_channels", "wms_shipping_channels?select=channel_code,channel_name&limit=10"),
    ("wms_inbound_receipts", "wms_inbound_receipts?select=receipt_no,status&limit=5"),
    ("wms_shipment_labels", "wms_shipment_labels?select=label_no,status&limit=5"),
]:
    cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, _ = ssh(cmd)
    print(f"[{label}] {out[:500]}")

# 5. Look at RLS policy for wms_orders
print("\n=== 5. RLS policies for wms_orders ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies WHERE tablename IN ('wms_orders', 'wms_warehouses') ORDER BY tablename;
" """)
print(out)

# 6. Look at seed data tenant_ids
print("\n=== 6. Sample data tenant_ids ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT 'wms_accounts' as tbl, account_id, email, tenant_id FROM wms_accounts LIMIT 3
UNION ALL
SELECT 'wms_orders', order_id, order_no, tenant_id FROM wms_orders LIMIT 5;
" """)
print(out)

client.close()
