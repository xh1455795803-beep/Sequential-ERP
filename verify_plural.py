#!/usr/bin/env python3
"""Verify request.jwt.claims (plural) + fix all WMS functions"""
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

# 1. First verify: does PostgREST 14 use request.jwt.claims (plural)?
# Let me create a simple test via psql using the pre-request approach
print("=== 1. Check all request.* GUCs via new debug function ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
-- Drop old debug function
DROP FUNCTION IF EXISTS public.pgrst_pre_request_debug();
DROP TABLE IF EXISTS postgrest_debug_log;

-- New version: dump ALL request.* and app.* settings as JSON
CREATE TABLE postgrest_debug_log (
    id serial PRIMARY KEY,
    ts timestamptz DEFAULT now(),
    cur_user text,
    sess_user text,
    all_settings jsonb
);

CREATE OR REPLACE FUNCTION public.pgrst_pre_request_debug()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_settings jsonb;
BEGIN
    SELECT jsonb_object_agg(name, current_setting(name, true))
    INTO v_settings
    FROM pg_settings 
    WHERE name LIKE 'request.%' OR name LIKE 'app.%';
    
    INSERT INTO postgrest_debug_log (cur_user, sess_user, all_settings)
    VALUES (current_user::text, session_user::text, v_settings);
END;
$$;

GRANT EXECUTE ON FUNCTION public.pgrst_pre_request_debug() TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
SQLEOF""")
print(f"Create: {ec}\n{out}")

# Also clean up compose - remove PGRST_DB_PRE_REQUEST (we don't need it, let's use direct psql)
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()
compose = compose.replace('\n      PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug"', '')
sftp = client.open_sftp()
with sftp.file('/tmp/compose.clean', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.clean {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Force restart
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
time.sleep(15)

# 2. Login + make request
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

# 3. CRITICAL TEST: direct psql that mimics what postgrest does
# First let's see if request.jwt.claims exists as a GUC after a postgrest request
print("\n=== 2. Direct psql: check if request.jwt.claims works ===")
# We need to check THIS ON a connection that postgrest used
# The tricky part is that each postgrest request is a separate connection
# Let's create a RPC that checks

ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres << 'SQLEOF'
CREATE OR REPLACE FUNCTION public.check_pgrst_gucs()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
    SELECT jsonb_build_object(
        'cur_user', current_user::text,
        'sess_user', session_user::text,
        'jwt_claims_plural', current_setting('request.jwt.claims', true),
        'jwt_claim_role_singular', current_setting('request.jwt.claim.role', true),
        'jwt_claim_email_singular', current_setting('request.jwt.claim.email', true),
        'jwt_role_direct', current_setting('request.jwt.role', true),
        'all_request_settings', (
            SELECT jsonb_object_agg(name, current_setting(name, true))
            FROM pg_settings 
            WHERE name LIKE 'request.%' OR name LIKE 'app.%'
        )
    );
$$;
GRANT EXECUTE ON FUNCTION public.check_pgrst_gucs() TO anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
SQLEOF""")
print(f"Create: {ec}\n{out}")
time.sleep(2)

# Call it via postgrest
print("\n=== 3. Call check_pgrst_gucs ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/check_pgrst_gucs'
ec, out, _ = ssh(cmd)
print(f"Result:\n{json.dumps(json.loads(out), indent=2)}")

# 4. If request.jwt.claims has the full JWT, then fix get_current_tenant_id()!
print("\n=== 4. If plural works, fix ALL functions ===")
if 'request.jwt.claims' in out and out:
    print("GREAT! request.jwt.claims works!")
    print("Now I need to fix: get_current_tenant_id(), debug_jwt_claims()")
    print("Using: current_setting('request.jwt.claims', true)::json->>'email'")
else:
    print("plural NOT working either - need to dig deeper")

# 5. Also try reading raw cookie-style GUCs
# In some versions postgrest puts them in request.jwt.role (no .claim.)
# Let's test all possible names

client.close()
