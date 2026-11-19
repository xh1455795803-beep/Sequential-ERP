#!/usr/bin/env python3
"""P0-1: 修 compose + 创建 debug 表和 pre-request 钩子 + 重启 postgrest + 发真实 JWT 请求 + 看 GUCs."""
import socket, paramiko, time, json, base64, hmac, hashlib

def ssh_exec(cmd, timeout=30):
    s = socket.socket()
    s.connect(('127.0.0.1', 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    t = paramiko.Transport(s); t.start_client(); t.auth_password('ubuntu', 'Yuan340364#')
    chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
    out = chan.recv(65535).decode(); err = chan.recv_stderr(65535).decode()
    t.close(); s.close()
    return out.strip(), err.strip()

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"

def run(cmd, timeout=60):
    return ssh_exec(cmd, timeout)

# Step 1: 看 compose 里 role claim key 原文
print("=" * 70)
print("STEP 1: Check raw docker-compose.yml rest env block")
print("=" * 70)
o, e = run("grep -A 30 'container_name: supabase-rest' /opt/supabase/docker/docker-compose.yml | grep -E 'PGRST|JWT' ")
print(o)
if e: print("[ERR]", e)

# Step 2: 直接编辑 compose — 加 PRE_REQUEST, 修正 ROLE_CLAIM_KEY, 确保 LEGACY_GUCS
print("\n" + "=" * 70)
print("STEP 2: Edit docker-compose.yml — add PGRST_DB_PRE_REQUEST")
print("=" * 70)

# Read the compose file, find rest service env block, add PGRST_DB_PRE_REQUEST
o, e = run("cat /opt/supabase/docker/docker-compose.yml | python3 -c \"\nimport sys\ncontent = sys.stdin.read()\nold = 'PGRST_LOG_LEVEL: \\\"debug\\\"'\nnew = '''PGRST_LOG_LEVEL: \\\"debug\\\"\n      PGRST_DB_PRE_REQUEST: \\\"public.pgrst_pre_request_debug\\\"'''\nif old in content and 'PGRST_DB_PRE_REQUEST' not in content:\n    content = content.replace(old, new)\n    with open('/tmp/fixed-compose.yml', 'w') as f:\n        f.write(content)\n    print('ADDED PGRST_DB_PRE_REQUEST')\nelif 'PGRST_DB_PRE_REQUEST' in content:\n    print('ALREADY EXISTS')\nelse:\n    print('OLD STRING NOT FOUND, manual check needed')\n    print(content[content.find('PGRST_LOG'):content.find('PGRST_LOG')+200])\n\" && sudo cp /tmp/fixed-compose.yml /opt/supabase/docker/docker-compose.yml && echo COPIED")
print(o)
if e: print("[ERR]", e)

# Verify
o, e = run("grep -E 'PRE_REQUEST|LEGACY_GUCS|ROLE_CLAIM' /opt/supabase/docker/docker-compose.yml")
print("After edit:", o)

# Step 3: 在 DB 里创建 debug 表和 pre-request 函数
print("\n" + "=" * 70)
print("STEP 3: Create debug table + pre-request function")
print("=" * 70)

SQL = r"""
-- drop old if exists
DROP TABLE IF EXISTS postgrest_debug_log CASCADE;
CREATE TABLE postgrest_debug_log (
    id serial PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    cur_user text,
    current_setting text,
    request_jwt_claims text,
    all_settings jsonb
);

-- Debug function 1: SECURITY INVOKER, called directly to see current GUCs
CREATE OR REPLACE FUNCTION public.debug_gucs()
RETURNS TABLE(
    cur_user text,
    request_jwt_claims text,
    request_jwt_claim_sub text,
    request_jwt_claim_email text,
    request_jwt_claim_role text,
    app_tenant_email text,
    all_gucs jsonb
) LANGUAGE plpgsql SECURITY INVOKER AS $$
BEGIN
    cur_user := current_user::text;
    BEGIN request_jwt_claims := current_setting('request.jwt.claims', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN request_jwt_claim_sub := current_setting('request.jwt.claim.sub', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN request_jwt_claim_email := current_setting('request.jwt.claim.email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN request_jwt_claim_role := current_setting('request.jwt.claim.role', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN app_tenant_email := current_setting('app.tenant_email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    
    SELECT jsonb_object_agg(name, current_setting(name, true))
    INTO all_gucs
    FROM pg_settings
    WHERE name LIKE 'request.%' OR name LIKE 'app.%';
    
    RETURN NEXT;
END;
$$;

-- pre-request hook
CREATE OR REPLACE FUNCTION public.pgrst_pre_request_debug()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
    v_settings jsonb;
BEGIN
    SELECT jsonb_object_agg(name, current_setting(name, true))
    INTO v_settings
    FROM pg_settings
    WHERE name LIKE 'request.%' OR name LIKE 'app.%';
    
    INSERT INTO postgrest_debug_log(cur_user, current_setting, request_jwt_claims, all_settings)
    VALUES (
        current_user::text,
        current_setting('request.method', true),
        current_setting('request.jwt.claims', true),
        v_settings
    );
EXCEPTION WHEN OTHERS THEN
    NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.debug_gucs() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pgrst_pre_request_debug() TO anon, authenticated, service_role;
"""

o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'SQL'
{SQL}
SQL""")
print(o)
if e: print("[ERR]", e)

# Step 4: 重启 postgrest
print("\n" + "=" * 70)
print("STEP 4: Restart supabase-rest")
print("=" * 70)
o, e = run(f"docker restart supabase-rest && sleep 5 && docker ps --filter name=supabase-rest")
print(o)

o, e = run(f"docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|pre.request|legacy'")
print("After restart config:", o)

# Step 5: 生成 JWT 并发请求
print("\n" + "=" * 70)
print("STEP 5: Generate JWT + hit /rpc/debug_gucs via envoy")
print("=" * 70)

# Read JWT_SECRET and ANON_KEY
o, e = run("grep -E '^(JWT_SECRET|ANON_KEY)=' /opt/supabase/docker/.env")
env_vals = {}
for line in o.split('\n'):
    if '=' in line:
        k, v = line.split('=', 1)
        env_vals[k] = v.strip()
SECRET = env_vals.get('JWT_SECRET', '')
ANON = env_vals.get('ANON_KEY', '')

def make_jwt(secret, sub, email, role):
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = {
        "sub": sub, "email": email, "role": role,
        "aud": "authenticated", "exp": int(time.time()) + 21600,
        "iat": int(time.time())
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    signing = f"{header}.{payload_b64}"
    sig = hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{signing}.{sig_b64}"

jwt = make_jwt(SECRET, "d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")
print(f"JWT: {jwt[:40]}...")
print(f"ANON: {ANON[:30]}...")

# Hit envoy (port 8000 on host, which maps to 127.0.0.1:8000 on server)
# But we're on remote server, so hit localhost:8000
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/debug_gucs' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {jwt}' \
  -H 'Content-Type: application/json' 2>&1""")
print("Response:", o[:2000])

# Also hit wms_orders
o2, e2 = run(f"""curl -sS 'http://localhost:8000/rest/v1/wms_orders?select=id,tenant_id,order_no' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {jwt}' 2>&1""")
print("\nwms_orders:", o2[:1000])

# Step 6: 看 debug log
print("\n" + "=" * 70)
print("STEP 6: Check debug log table")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT id, created_at, cur_user, current_setting, request_jwt_claims,
       left(all_settings::text, 500) as settings_preview
FROM postgrest_debug_log ORDER BY id DESC LIMIT 5;" """)
print(o)

# Step 7: 看 debug_gucs RPC 结果
print("\n" + "=" * 70)
print("STEP 7: Run debug_gucs RPC directly as supabase_admin (for comparison)")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT * FROM public.debug_gucs();" """)
print(o)
