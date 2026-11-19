#!/usr/bin/env python3
"""Use pre-request hook to see what postgrest actually sets"""
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

# 1. Create a debug log table + pre-request function
print("=== 1. Create pre-request debug hook ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
-- Create a table to log what postgrest does
CREATE TABLE IF NOT EXISTS postgrest_debug_log (
    id serial PRIMARY KEY,
    ts timestamptz DEFAULT now(),
    current_user text,
    settings jsonb,
    jwt_payload jsonb
);

-- Grant access
GRANT ALL ON postgrest_debug_log TO public;
GRANT USAGE ON postgrest_debug_log_id_seq TO public;

-- Pre-request function (SECURITY INVOKER - runs as postgrest connection user after SET ROLE)
CREATE OR REPLACE FUNCTION public.pgrst_pre_request_debug()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    all_settings jsonb;
BEGIN
    SELECT jsonb_object_agg(name, current_setting(name, true))
    INTO all_settings
    FROM pg_settings 
    WHERE name LIKE 'request.%' OR name LIKE 'app.%';
    
    INSERT INTO postgrest_debug_log (current_user, settings)
    VALUES (current_user::text, all_settings);
END;
$$;

-- Grant to all roles that postgrest might SET ROLE to
GRANT EXECUTE ON FUNCTION public.pgrst_pre_request_debug() TO anon, authenticated, service_role;
SQLEOF""")
print(f"Create ec={ec}\n{out}")

# 2. Add PGRST_DB_PRE_REQUEST to compose
COMPOSE = "/opt/supabase/docker/docker-compose.yml"
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()

old = 'PGRST_DB_USE_LEGACY_GUCS: \'true\''
new = old + '\n      PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug()"'
compose = compose.replace(old, new)

sftp = client.open_sftp()
with sftp.file('/tmp/compose.prereq', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.prereq {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

ec, out, _ = sudo(f"grep -E 'PRE_REQUEST|LEGACY' {COMPOSE}")
print(f"\nCompose:\n{out}")

# 3. Restart
print("\n=== 2. Force restart ===")
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file /opt/supabase/docker/.env up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:300]}")

for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    status = out.strip()
    print(f"  [{i*3}s] {status}")
    if 'healthy' in status:
        break

# 4. Login + make a request
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

print("\n=== 3. Make request ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_no&limit=2"'
ec, out, _ = ssh(cmd)
print(f"Result: {out[:500]}")

time.sleep(1)

# 5. Check debug log
print("\n=== 4. Debug log ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT current_user, settings FROM postgrest_debug_log ORDER BY id DESC LIMIT 3;" """)
print(out)

client.close()
