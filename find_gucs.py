#!/usr/bin/env python3
"""Find what GUC settings postgrest actually sets"""
import socket, paramiko

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

# 1. Check ALL session settings with jwt/request prefix
print("=== 1. Search pg_settings for jwt/request ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT name, setting, short_desc FROM pg_settings 
WHERE name LIKE '%jwt%' OR name LIKE '%request%' OR name LIKE '%auth%';
" """)
print(out)

# 2. List ALL custom session settings on a live postgrest connection
# Use a RPC that lists current session settings
print("\n=== 2. Create function to list session settings ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLXEOF'
CREATE OR REPLACE FUNCTION public.list_session_settings()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_object_agg(name, current_setting(name, true))
    FROM (
        SELECT unnest(ARRAY[
            'request.jwt.claim.role',
            'request.jwt.claim.email', 
            'request.jwt.claim.sub',
            'request.jwt.claim.aud',
            'request.jwt.claim.iss',
            'request.jwt.claim.phone',
            'request.jwt.role',
            'request.jwt.email',
            'request.jwt.sub',
            'request.jwt.aud',
            'app.tenant_email',
            'app.settings.jwt_exp',
            'current_user',
            'session_user'
        ]) as name
    ) s;
$$;
GRANT EXECUTE ON FUNCTION public.list_session_settings() TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
SQLXEOF""")
print(f"Create ec={ec}\n{out}")

# 3. Login + call it
import base64, hmac, hashlib, json, time
time.sleep(2)
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

print("\n=== 3. Call list_session_settings ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/list_session_settings'
ec, out, _ = ssh(cmd)
print(f"Result: {out}")

# 4. Also check via psql manually - SET ROLE + set_config to see if our RLS function works
print("\n=== 4. psql test with manual SET ROLE ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.email', 'admin@thalvior.icu', true);
SELECT set_config('request.jwt.claim.sub', '6f9fc265-7ed8-48a3-a1b1-cdc18f310bae', true);
SELECT current_user;
SELECT current_setting('request.jwt.claim.role', true);
SELECT public.get_current_tenant_id();
SELECT count(*) FROM wms_orders;
" """)
print(out)

client.close()
