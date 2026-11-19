#!/usr/bin/env python3
"""P0 FIX v5: correct return type BIGINT + list all tables + verify."""
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
# 1. CREATE OR REPLACE — RETURNS BIGINT, SECURITY DEFINER (match original)
# ============================================================
print("=" * 70)
print("1. CREATE OR REPLACE get_current_tenant_id() — BIGINT, JSONB-aware")
print("=" * 70)

SQL = r"""
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $function$
DECLARE
    v_claims jsonb;
    v_email text;
    v_sub uuid;
    v_tid bigint;
BEGIN
    -- Postgrest v14+: read entire JWT from request.jwt.claims (JSONB)
    BEGIN
        v_claims := current_setting('request.jwt.claims', true)::jsonb;
    EXCEPTION WHEN OTHERS THEN v_claims := NULL; END;

    IF v_claims IS NOT NULL THEN
        v_email := v_claims->>'email';
        IF v_email IS NOT NULL AND v_email <> '' THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
            IF v_tid IS NOT NULL THEN RETURN v_tid; END;
        END IF;
        BEGIN v_sub := (v_claims->>'sub')::uuid; EXCEPTION WHEN OTHERS THEN v_sub := NULL; END;
        IF v_sub IS NOT NULL THEN
            SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE user_id = v_sub LIMIT 1;
            IF v_tid IS NOT NULL THEN RETURN v_tid; END;
        END IF;
    END IF;

    -- Legacy fallback: old singular GUCs (pre-v14 postgrest)
    BEGIN v_email := current_setting('request.jwt.claim.email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL AND v_email <> '' THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN RETURN v_tid; END;
    END IF;

    -- Session setting fallback
    BEGIN v_email := current_setting('app.tenant_email', true); EXCEPTION WHEN OTHERS THEN NULL; END;
    IF v_email IS NOT NULL AND v_email <> '' THEN
        SELECT tenant_id INTO v_tid FROM public.wms_accounts WHERE email = v_email LIMIT 1;
        IF v_tid IS NOT NULL THEN RETURN v_tid; END;
    END IF;

    RETURN NULL;
END;
$function$;

-- Verify
SELECT prosrc FROM pg_proc WHERE proname='get_current_tenant_id';
"""
o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'EOF'
{SQL}
EOF""")
print(o[:2000])
if e: print("[ERR]", e[:500])

# ============================================================
# 2. Verify body has JSONB logic
# ============================================================
print("\n" + "=" * 70)
print("2. Verify function body")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT prosrc LIKE '%request.jwt.claims%' as has_jsonb,
       prosrc LIKE '%SECURITY DEFINER%' as has_definer
FROM pg_proc WHERE proname='get_current_tenant_id';" """)
print(o)

# ============================================================
# 3. Reload postgrest schema cache
# ============================================================
print("\n" + "=" * 70)
print("3. Reload postgrest")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" 2>&1
sleep 1
docker restart supabase-rest 2>&1
sleep 5
docker ps --filter name=supabase-rest --format '{{.Status}}'""")
print(o)

# ============================================================
# 4. Final end-to-end test
# ============================================================
print("\n" + "=" * 70)
print("4. REST API tests — AUTHENTICATED JWT")
print("=" * 70)
auth_jwt = make_jwt("d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")

# RPC first
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(f"rpc/get_current_tenant_id => {o}")

# List actual wms_ tables that exist
real_tables = [
    'wms_orders', 'wms_order_items', 'wms_accounts', 'wms_warehouses',
    'wms_shipping_channels', 'wms_shipment_labels', 'wms_shipment_items',
    'wms_inventory', 'wms_inbound_receipts', 'wms_inbound_items',
    'wms_products', 'wms_bins', 'wms_zones', 'wms_exceptions',
]

for tbl in real_tables:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{tbl}?limit=5' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    try:
        data = json.loads(o)
        if isinstance(data, list):
            print(f"  ✅ {tbl}: {len(data)} rows")
        else:
            print(f"  ⚠️  {tbl}: {o[:150]}")
    except:
        print(f"  ❌ {tbl}: {o[:200]}")

# ============================================================
# 5. Also run a direct SECURITY INVOKER debug to confirm GUCs
# ============================================================
print("\n" + "=" * 70)
print("5. debug_gucs RPC (SECURITY INVOKER) — raw GUC check")
print("=" * 70)
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/debug_gucs' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(o[:800])
