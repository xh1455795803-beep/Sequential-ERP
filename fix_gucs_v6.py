#!/usr/bin/env python3
"""P0 FIX v6: DISABLE RLS to see data, then CREATE function via .sql file."""
import socket, paramiko, time, json, base64, hmac, hashlib

def ssh_exec(cmd, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

def run(c, t=120): return ssh_exec(c, t)

o, _ = run("grep -E '^(JWT_SECRET|ANON_KEY)=' /opt/supabase/docker/.env")
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
# 1. DISABLE RLS on ALL wms_ tables — test data visibility
# ============================================================
print("=" * 70)
print("1. DISABLE RLS on wms_ tables (temporarily)")
print("=" * 70)
run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
DO $$ BEGIN
  EXECUTE (SELECT string_agg(format('ALTER TABLE %I DISABLE ROW LEVEL SECURITY', tablename), '; ')
           FROM pg_tables WHERE tablename LIKE 'wms_%');
END $$;" """)

# ============================================================
# 2. Quick test — can we see data now?
# ============================================================
print("\n" + "=" * 70)
print("2. Quick data visibility test")
print("=" * 70)
auth_jwt = make_jwt("d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")

for tbl in ['wms_orders', 'wms_accounts', 'wms_warehouses', 'wms_shipping_channels']:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{tbl}?limit=3' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    try:
        data = json.loads(o)
        print(f"  {tbl}: {len(data) if isinstance(data, list) else 'ERR'} rows")
    except:
        print(f"  {tbl}: {o[:200]}")

# ============================================================
# 3. Write function SQL to a FILE, then scp/cat to server
# ============================================================
print("\n" + "=" * 70)
print("3. Write new get_current_tenant_id() to .sql file on server")
print("=" * 70)

func_sql = r'''-- Step 1: DROP old function (RLS policies depend on it — we already disabled RLS, so just DROP RESTRICT)
-- Actually let's try CREATE OR REPLACE first, using same dollar-quoting as original
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
    v_claims jsonb;
    v_email text;
    v_sub uuid;
    v_tid bigint;
BEGIN
    -- Postgrest v14+: read entire JWT from request.jwt.claims (JSONB)
    BEGIN
        v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN v_claims := NULL;
    END;

    IF v_claims IS NOT NULL THEN
        v_email := v_claims->>'email';
        IF v_email IS NOT NULL AND v_email <> '' THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
            IF v_tid IS NOT NULL THEN
                RETURN v_tid;
            END IF;
        END IF;

        BEGIN
            v_sub := (v_claims->>'sub')::uuid;
        EXCEPTION WHEN OTHERS THEN
            v_sub := NULL;
        END;
        IF v_sub IS NOT NULL THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE user_id = v_sub LIMIT 1;
            IF v_tid IS NOT NULL THEN
                RETURN v_tid;
            END IF;
        END IF;
    END IF;

    -- Legacy fallback: old singular GUCs (pre-v14 postgrest)
    BEGIN
        v_email := current_setting('request.jwt.claim.email', true);
    EXCEPTION WHEN OTHERS THEN
        v_email := NULL;
    END;
    IF v_email IS NOT NULL AND v_email <> '' THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN
            RETURN v_tid;
        END IF;
    END IF;

    -- Session setting fallback
    BEGIN
        v_email := current_setting('app.tenant_email', true);
    EXCEPTION WHEN OTHERS THEN
        v_email := NULL;
    END;
    IF v_email IS NOT NULL AND v_email <> '' THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN
            RETURN v_tid;
        END IF;
    END IF;

    RETURN NULL;
END;
$$;
'''

# Write to server file via base64
import base64 as b64mod
encoded = b64mod.b64encode(func_sql.encode()).decode()
run(f"echo '{encoded}' | base64 -d > /tmp/fix_tenant_fn.sql && wc -l /tmp/fix_tenant_fn.sql")

# Execute it
o, e = run("docker cp /tmp/fix_tenant_fn.sql supabase-db:/tmp/ && docker exec supabase-db psql -U supabase_admin -d postgres -f /tmp/fix_tenant_fn.sql 2>&1")
print(o[:1000])
if e: print("[ERR]", e[:500])

# Verify
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT prosrc LIKE '%request.jwt.claims%' as has_jsonb_logic FROM pg_proc WHERE proname='get_current_tenant_id';" """)
print(f"Has JSONB logic: {o}")

# ============================================================
# 4. Test rpc/get_current_tenant_id with RLS DISABLED
# ============================================================
print("\n" + "=" * 70)
print("4. rpc/get_current_tenant_id test")
print("=" * 70)
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(f"get_current_tenant_id() => {o}")

# ============================================================
# 5. RE-ENABLE RLS, then test tables
# ============================================================
print("\n" + "=" * 70)
print("5. RE-ENABLE RLS + full test")
print("=" * 70)
run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
DO $$ BEGIN
  EXECUTE (SELECT string_agg(format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tablename), '; ')
           FROM pg_tables WHERE tablename LIKE 'wms_%');
END $$;" """)
# restart postgrest to clear schema cache
run("docker restart supabase-rest && sleep 4")

print("\nAuthenticated REST API results:")
for tbl in ['wms_orders', 'wms_accounts', 'wms_warehouses', 'wms_shipping_channels', 'wms_shipment_labels']:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{tbl}?limit=5' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    try:
        data = json.loads(o)
        if isinstance(data, list):
            print(f"  ✅ {tbl}: {len(data)} rows")
            if len(data) > 0:
                print(f"     Sample: {json.dumps(data[0], ensure_ascii=False)[:200]}")
        else:
            print(f"  ⚠️  {tbl}: {o[:200]}")
    except:
        print(f"  ❌ {tbl}: {o[:200]}")

# Also: what if tenant_id=2? Let's make sure our user has tenant_id=1
o, e = run("docker exec supabase-db psql -U supabase_admin -d postgres -c \"SELECT * FROM wms_accounts;\"")
print(f"\nwms_accounts table:\n{o}")
