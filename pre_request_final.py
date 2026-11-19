#!/usr/bin/env python3
"""Final approach: postgrest pre-request hook dump"""
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

COMPOSE = "/opt/supabase/docker/docker-compose.yml"
ENVFILE = "/opt/supabase/docker/.env"

# 1. Check postgrest docs for pre-request format
print("=== 1. Check postgrest pre-request help ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --example 2>&1 | grep -A5 'pre-request\\|pre_request'")
print(out)

# 2. Create proper pre-request function
print("\n=== 2. Create pre-request function ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
DROP TABLE IF EXISTS postgrest_debug_log;
CREATE TABLE postgrest_debug_log (
    id serial PRIMARY KEY,
    ts timestamptz DEFAULT now(),
    cur_user text,
    settings jsonb
);

CREATE OR REPLACE FUNCTION public.pgrst_pre_request_debug()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v jsonb;
BEGIN
    BEGIN
        SELECT jsonb_object_agg(name, current_setting(name, true))
        INTO v
        FROM pg_settings 
        WHERE name LIKE 'request.%' OR name LIKE 'app.%';
    EXCEPTION WHEN OTHERS THEN v := jsonb_build_object('error', SQLERRM); END;
    
    BEGIN
        INSERT INTO postgrest_debug_log (cur_user, settings)
        VALUES (current_user::text, v);
    EXCEPTION WHEN OTHERS THEN NULL; END;
END;
$$;
ALTER FUNCTION public.pgrst_pre_request_debug() SECURITY INVOKER;
GRANT EXECUTE ON FUNCTION public.pgrst_pre_request_debug() TO anon, authenticated, service_role;
SQLEOF""")
print(f"Create ec={ec}\n{out}")

# 3. Update compose with pre-request
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()

# Add PGRST_DB_PRE_REQUEST after LEGACY_GUCS
old = "PGRST_DB_USE_LEGACY_GUCS: 'true'"
new = old + '\n      PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug"'
if 'PRE_REQUEST' not in compose:
    compose = compose.replace(old, new)
    print("Added PGRST_DB_PRE_REQUEST")
else:
    print("PRE_REQUEST already in compose")

sftp = client.open_sftp()
with sftp.file('/tmp/compose.pr', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.pr {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Restart
print("\n=== 3. Restart ===")
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"Restart:\n{out[:300]}")

for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    status = out.strip()
    if 'healthy' in status:
        print(f"  [{i*3}s] rest: healthy!")
        break
    print(f"  [{i*3}s] rest: {status}")

# 4. Make request
print("\n=== 4. Make request ===")
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

# Clear debug log first
sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "DELETE FROM postgrest_debug_log;" """)

# Send request
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_no&limit=1"'
ec, out, _ = ssh(cmd)
print(f"Response: {out[:500]}")
time.sleep(1)

# 5. Check debug log
print("\n=== 5. Debug log ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT id, cur_user, settings FROM postgrest_debug_log ORDER BY id DESC LIMIT 3;" """)
print(out[:2000])

client.close()
