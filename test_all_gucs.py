#!/usr/bin/env python3
"""Reload postgrest schema cache properly and test"""
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

# 1. Check if functions exist in DB
print("=== 1. Check functions exist ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT proname, prosrc FROM pg_proc WHERE proname LIKE '%check_pgrst%' OR proname LIKE '%list_session%' OR proname LIKE '%debug_post%';" """)
print(out)

# 2. Reload schema via admin API
print("\n=== 2. Reload schema via admin API ===")
# Postgrest admin server is on port 3001
# From host we can access via docker network
ec, out, _ = ssh("docker exec supabase-rest wget -qO- http://localhost:3001/reload 2>&1")
print(f"Admin reload: {out}")

# Also NOTIFY
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" """)
print(f"Notify: {out.strip()}")
time.sleep(3)

# 3. Check if RPC functions now visible
print("\n=== 3. Test RPC ===")
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

# Try direct wget from auth container to rest:3000
print("\n=== Direct container-to-container test ===")
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/check_pgrst_gucs'
ec, out, err = ssh(cmd)
print(f"check_pgrst_gucs: {out[:1000]}")

# Also try via envoy
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/check_pgrst_gucs'
ec, out, _ = ssh(cmd)
print(f"Via envoy: {out[:1000]}")

# 4. Try ALL possible JWT claim GUC names manually
print("\n=== 4. Manually check all GUC names ===")
ec, out, _ = sudo(f"""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
-- Create function that tries EVERY possible name
CREATE OR REPLACE FUNCTION public.test_all_jwt_gucs()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'cur_user', current_user::text,
        'jwt_claims_plural', current_setting('request.jwt.claims', true),
        'jwt_claim_role_singular', current_setting('request.jwt.claim.role', true),
        'jwt_claim_email_singular', current_setting('request.jwt.claim.email', true),
        'jwt_claim_sub_singular', current_setting('request.jwt.claim.sub', true),
        'jwt_role_no_claim', current_setting('request.jwt.role', true),
        'jwt_email_no_claim', current_setting('request.jwt.email', true),
        'jwt_sub_no_claim', current_setting('request.jwt.sub', true),
        'jwt_role_claim', current_setting('role', true),
        'jwt_email_claim', current_setting('email', true),
        'jwt_sub_claim', current_setting('sub', true)
    );
$$;
GRANT EXECUTE ON FUNCTION public.test_all_jwt_gucs() TO anon, authenticated, service_role;
SQLEOF""")
print(f"Create all-gucs: {ec}\n{out}")

# Reload
ssh("docker exec supabase-rest wget -qO- http://localhost:3001/reload")
sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" """)
time.sleep(3)

cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/test_all_jwt_gucs'
ec, out, err = ssh(cmd)
print(f"\ntest_all_jwt_gucs: {out[:1000]}")

client.close()
