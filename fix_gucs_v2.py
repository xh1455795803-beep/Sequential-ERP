#!/usr/bin/env python3
"""P0-2: 基于真实 GUC 结构修复 get_current_tenant_id() + 重新启用 RLS + 验证数据流通。"""
import socket, paramiko, time, json, base64, hmac, hashlib

def ssh_exec(cmd, timeout=60):
    s = socket.socket()
    s.connect(('127.0.0.1', 18080))
    s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
    t = paramiko.Transport(s); t.start_client(); t.auth_password('ubuntu', 'Yuan340364#')
    chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
    out = chan.recv(65535).decode(); err = chan.recv_stderr(65535).decode()
    t.close(); s.close()
    return out.strip(), err.strip()

CMP = "docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env"
def run(cmd, timeout=60): return ssh_exec(cmd, timeout)

# Step 1: 先确认 RLS 状态和表权限
print("=" * 70)
print("STEP 1: Check RLS status + permissions + wms_orders data directly")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres <<'SQL'
-- RLS status
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'wms_%' ORDER BY tablename;

-- Count seed data
SELECT 'wms_orders' as t, count(*) FROM wms_orders
UNION ALL SELECT 'wms_warehouses', count(*) FROM wms_warehouses
UNION ALL SELECT 'wms_channels', count(*) FROM wms_channels
UNION ALL SELECT 'wms_asns', count(*) FROM wms_asns
UNION ALL SELECT 'wms_accounts', count(*) FROM wms_accounts;

-- Can authenticated SELECT?
SELECT grantee, privilege_type FROM information_schema.role_table_grants 
WHERE table_name='wms_orders' AND grantee IN ('authenticated', 'anon', 'service_role');
SQL""")
print(o[:2000])
if e: print("[ERR]", e)

# Step 2: 从 env 读 secret，生成 JWT，试一下带 service_role 的 API
print("\n" + "=" * 70)
print("STEP 2: Test REST API with service_role (RLS bypass)")
print("=" * 70)
o, e = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env")
env_vals = {}
for line in o.split('\n'):
    if '=' in line:
        k, v = line.split('=', 1)
        env_vals[k] = v.strip()
SECRET = env_vals.get('JWT_SECRET', '')
ANON = env_vals.get('ANON_KEY', '')
SVC = env_vals.get('SERVICE_ROLE_KEY', '')

# Use SERVICE_ROLE_KEY directly (it's already a JWT) — or make our own
# Actually let's just make one with role=service_role
def make_jwt(secret, sub, email, role):
    header = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    payload = {"sub": sub, "email": email, "role": role, "aud": role, "exp": int(time.time())+21600}
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b'=').decode()
    signing = f"{header}.{payload_b64}"
    sig = hmac.new(secret.encode(), signing.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{signing}.{sig_b64}"

svc_jwt = make_jwt(SECRET, "00000000-0000-0000-0000-000000000000", "admin@thalvior.icu", "service_role")
print(f"service_role JWT: {svc_jwt[:40]}...")

o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/wms_orders?select=id,tenant_id,order_no' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {svc_jwt}' 2>&1""")
print("service_role → wms_orders:", o[:500])

# Step 3: 核心修复 — 重写 get_current_tenant_id() 从 request.jwt.claims JSONB 取
print("\n" + "=" * 70)
print("STEP 3: Rewrite get_current_tenant_id() for Postgrest v14 JSONB claims")
print("=" * 70)

FIX_SQL = r"""
-- 先看原函数长啥样
SELECT pg_get_functiondef('public.get_current_tenant_id()'::regproc);
"""
o, e = run(f"docker exec supabase-db psql -U supabase_admin -d postgres -c \"{FIX_SQL}\"")
print("Current function:", o)

# Now rewrite it
NEW_FUNC = r"""
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_claims jsonb;
    v_email text;
    v_sub uuid;
    v_tenant_id integer;
BEGIN
    -- Path 1: Try request.jwt.claims JSONB (Postgrest v14+)
    BEGIN
        v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN
        v_claims := NULL;
    END;

    IF v_claims IS NOT NULL THEN
        -- 1a: Extract email from JSONB
        v_email := v_claims->>'email';
        IF v_email IS NOT NULL THEN
            SELECT tenant_id INTO v_tenant_id FROM public.wms_accounts WHERE email = v_email LIMIT 1;
            IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END;
        END IF;

        -- 1b: Extract sub (should be UUID) from JSONB
        BEGIN
            v_sub := (v_claims->>'sub')::uuid;
        EXCEPTION WHEN OTHERS THEN v_sub := NULL;
        END;
        IF v_sub IS NOT NULL THEN
            SELECT tenant_id INTO v_tenant_id FROM public.wms_accounts WHERE user_id = v_sub LIMIT 1;
            IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END;
        END IF;
    END IF;

    -- Path 2: Legacy fallback — old singular GUCs (in case v13 or older)
    BEGIN v_email := current_setting('request.jwt.claim.email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END;
    END IF;

    -- Path 3: Session setting app.tenant_email
    BEGIN v_email := current_setting('app.tenant_email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL THEN
        SELECT tenant_id INTO v_tenant_id FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tenant_id IS NOT NULL THEN RETURN v_tenant_id; END;
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_tenant_id() TO anon, authenticated, service_role;
"""

o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'P00FUNC'
{NEW_FUNC}
P00FUNC""")
print(o)
if e: print("[ERR]", e)

# Step 4: 重新启用 RLS + 确认 authenticated 有表权限
print("\n" + "=" * 70)
print("STEP 4: Re-enable RLS + grant perms to authenticated")
print("=" * 70)

RLS_SQL = r"""
-- Re-enable RLS on all wms_ tables
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE tablename LIKE 'wms_%' LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END LOOP;
END $$;

-- Grant permissions
DO $$
DECLARE
    t text;
BEGIN
    FOR t IN SELECT tablename FROM pg_tables WHERE tablename LIKE 'wms_%' LOOP
        EXECUTE format('GRANT ALL ON %I TO authenticated, service_role', t);
        EXECUTE format('GRANT SELECT ON %I TO anon', t);
    END LOOP;
END $$;

-- Also grant on sequences
DO $$
DECLARE
    s text;
BEGIN
    FOR s IN SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema='public' LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %I TO authenticated, service_role', s);
    END LOOP;
END $$;

-- Verify
SELECT tablename, rowsecurity FROM pg_tables WHERE tablename LIKE 'wms_%' ORDER BY tablename LIMIT 5;
"""
o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'RLSCMD'
{RLS_SQL}
RLSCMD""")
print(o[:2000])
if e: print("[ERR]", e)

# Step 5: 用 authenticated JWT 测 REST API
print("\n" + "=" * 70)
print("STEP 5: Test REST API end-to-end with authenticated JWT")
print("=" * 70)

auth_jwt = make_jwt(SECRET, "d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")

tests = [
    ("wms_orders", "select=id,tenant_id,order_no,status", 10),
    ("wms_warehouses", "select=id,tenant_id,warehouse_code", 5),
    ("wms_channels", "select=id,tenant_id,channel_code", 5),
    ("wms_asns", "select=id,tenant_id,asn_no,status", 5),
    ("wms_accounts", "select=id,tenant_id,email", 5),
]

for table, sel, limit in tests:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{table}?{sel}&limit={limit}' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    print(f"\n{table} ({sel}): {o[:300]}")
    if e: print(f"  [ERR] {e[:200]}")

# Step 6: debug_gucs 也重写一下，显示 JSONB 里提取的值
print("\n" + "=" * 70)
print("STEP 6: Verify debug_gucs() shows extracted tenant")
print("=" * 70)

o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/debug_gucs' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print("debug_gucs:", o[:500])

# Step 7: 重启 postgrest 清 schema cache（确保新函数被识别）
print("\n" + "=" * 70)
print("STEP 7: Restart postgrest + final verify")
print("=" * 70)
run("docker restart supabase-rest && sleep 3")

for table, sel, limit in tests[:3]:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{table}?{sel}&limit={limit}' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    print(f"{table}: {o[:200]}")
