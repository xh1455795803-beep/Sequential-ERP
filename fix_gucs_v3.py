#!/usr/bin/env python3
"""P0 FIX v3: SSH retry + DROP+CREATE + correct aud."""
import socket, paramiko, time, json, base64, hmac, hashlib, sys

def ssh_exec(cmd, timeout=60, retries=3):
    last_err = None
    for attempt in range(retries):
        try:
            s = socket.socket()
            s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(65535).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex
            time.sleep(2)
    raise last_err

def run(cmd, timeout=120): return ssh_exec(cmd, timeout)

# Read env
o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env")
env = {}
for line in o.split('\n'):
    if '=' in line:
        k, v = line.split('=', 1); env[k] = v.strip()
SECRET, ANON = env['JWT_SECRET'], env['ANON_KEY']

def make_jwt(sub, email, role):
    h = base64.urlsafe_b64encode(json.dumps({"alg":"HS256","typ":"JWT"}).encode()).rstrip(b'=').decode()
    p = json.dumps({"sub":sub,"email":email,"role":role,"aud":"authenticated","exp":int(time.time())+21600}).encode()
    pb = base64.urlsafe_b64encode(p).rstrip(b'=').decode()
    sig = hmac.new(SECRET.encode(), f"{h}.{pb}".encode(), hashlib.sha256).digest()
    sb = base64.urlsafe_b64encode(sig).rstrip(b'=').decode()
    return f"{h}.{pb}.{sb}"

# ============================================================
# STEP 1: DROP old function, CREATE new one (JSONB-aware)
# ============================================================
print("=" * 70)
print("STEP 1: Fix get_current_tenant_id()")
print("=" * 70)

SQL_1 = r"""
DROP FUNCTION IF EXISTS public.get_current_tenant_id();

CREATE FUNCTION public.get_current_tenant_id()
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_claims jsonb;
    v_email text;
    v_sub uuid;
    v_tid integer;
BEGIN
    -- Postgrest v14+: read entire JWT from request.jwt.claims (JSONB)
    BEGIN
        v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN v_claims := NULL; END;

    IF v_claims IS NOT NULL THEN
        v_email := v_claims->>'email';
        IF v_email IS NOT NULL THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
            IF v_tid IS NOT NULL THEN RETURN v_tid; END;
        END IF;
        BEGIN v_sub := (v_claims->>'sub')::uuid; EXCEPTION WHEN OTHERS THEN v_sub := NULL; END;
        IF v_sub IS NOT NULL THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE user_id = v_sub LIMIT 1;
            IF v_tid IS NOT NULL THEN RETURN v_tid; END;
        END IF;
    END IF;

    -- Legacy fallback
    BEGIN v_email := current_setting('request.jwt.claim.email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN RETURN v_tid; END;
    END IF;

    BEGIN v_email := current_setting('app.tenant_email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN RETURN v_tid; END;
    END IF;

    RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_current_tenant_id() TO anon, authenticated, service_role;
"""
o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'EOF'
{SQL_1}
EOF""")
print(o[:1500])
if e: print("[ERR]", e[:500])

# ============================================================
# STEP 2: Restart postgrest to clear schema cache
# ============================================================
print("\n" + "=" * 70)
print("STEP 2: Restart supabase-rest")
print("=" * 70)
o, e = run("docker restart supabase-rest && sleep 4 && docker ps --filter name=supabase-rest --format '{{.Status}}'")
print(o)

# ============================================================
# STEP 3: Quick test — is wms_accounts data there?
# ============================================================
print("\n" + "=" * 70)
print("STEP 3: DB sanity check")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT count(*) as orders FROM wms_orders;
SELECT count(*) as accounts FROM wms_accounts;
SELECT email, tenant_id FROM wms_accounts LIMIT 3;" """)
print(o)

# ============================================================
# STEP 4: End-to-end REST API test
# ============================================================
print("\n" + "=" * 70)
print("STEP 4: REST API test (authenticated JWT)")
print("=" * 70)
auth_jwt = make_jwt("d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")
print(f"JWT: {auth_jwt[:50]}...")

tests = [
    ("wms_orders", "select=id,tenant_id,order_no,status&limit=10"),
    ("wms_warehouses", "select=id,tenant_id,warehouse_code&limit=5"),
    ("wms_channels", "select=id,tenant_id,channel_code&limit=5"),
    ("wms_asns", "select=id,tenant_id,asn_no,status&limit=5"),
    ("wms_accounts", "select=id,tenant_id,email&limit=5"),
    ("rpc/get_current_tenant_id", ""),
]

for tbl, sel in tests:
    url = f"http://localhost:8000/rest/v1/{tbl}"
    if sel: url += f"?{sel}"
    o, e = run(f"""curl -sS '{url}' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    print(f"\n{tbl}:")
    print(f"  {o[:400]}")
    if e: print(f"  [ERR] {e[:200]}")

# ============================================================
# STEP 5: Check RLS policies — are they correct?
# ============================================================
print("\n" + "=" * 70)
print("STEP 5: Check RLS policies")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename LIKE 'wms_%'
ORDER BY tablename, policyname LIMIT 10;" """)
print(o)
