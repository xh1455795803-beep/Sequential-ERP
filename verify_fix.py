#!/usr/bin/env python3
"""Verify postgrest JWT parsing works - check SECURITY DEFINER issue"""
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

# 1. Check debug_jwt_claims function definition
print("=== 1. debug_jwt_claims function definition ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE p.proname = 'debug_jwt_claims' AND n.nspname = 'public';" """)
print(out)

# 2. Create an INVOKER version of debug function
print("\n=== 2. Create debug_postgrest (SECURITY INVOKER) ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
CREATE OR REPLACE FUNCTION public.debug_postgrest()
RETURNS TABLE(
    cur_user text,
    current_user_setting text,
    jwt_role text,
    jwt_email text,
    jwt_sub text,
    jwt_aud text,
    jwt_iss text
)
LANGUAGE sql
STABLE
AS $$
    SELECT 
        current_user::text as cur_user,
        current_setting('request.jwt.claim.role', true) as current_user_setting,
        current_setting('request.jwt.claim.role', true) as jwt_role,
        current_setting('request.jwt.claim.email', true) as jwt_email,
        current_setting('request.jwt.claim.sub', true) as jwt_sub,
        current_setting('request.jwt.claim.aud', true) as jwt_aud,
        current_setting('request.jwt.claim.iss', true) as jwt_iss;
$$;
SQLEOF""")
print(f"Create ec={ec}\n{out}")

# Grant permissions
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "GRANT EXECUTE ON FUNCTION public.debug_postgrest() TO anon, authenticated;" """)
print(f"Grant: {out}")

# 3. Generate keys + Login
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

# 4. Test new debug function
print("\n=== 3. Test debug_postgrest ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_postgrest'
ec, out, _ = ssh(cmd)
print(f"debug_postgrest: {out[:500]}")

# 5. Test RPC schema reload to pick up new function
print("\n=== 4. Reload schema cache ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" """)
print(f"Notify: {out}")
time.sleep(2)

# 6. Now test the REAL data tables!
print("\n=== 5. REAL DATA TESTS ===")
for label, path in [
    ("wms_orders", "wms_orders?select=order_no,status,tenant_id&limit=5"),
    ("wms_warehouses", "wms_warehouses?select=warehouse_code&limit=5"),
    ("wms_shipping_channels", "wms_shipping_channels?select=channel_code,channel_name&limit=10"),
    ("wms_inbound_receipts", "wms_inbound_receipts?select=receipt_no,status&limit=5"),
    ("wms_shipment_labels", "wms_shipment_labels?select=label_no,status&limit=5"),
]:
    cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, _ = ssh(cmd)
    print(f"[{label}] {out[:400]}")

client.close()
