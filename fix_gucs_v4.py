#!/usr/bin/env python3
"""P0 FIX v4: CREATE OR REPLACE (no DROP) + list real tables + reload postgrest."""
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
# 1. List ALL wms_ tables in DB, and what postgrest can see
# ============================================================
print("=" * 70)
print("1. DB tables + Postgrest schema visibility")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'wms_%' ORDER BY tablename;" """)
print("DB wms_ tables:")
print(o)

o, e = run("""curl -sS 'http://localhost:8000/rest/v1/' \
  -H 'apikey: ' 2>&1 | head -c 3000""")
print("\nPostgrest root (apikey empty):", o[:3000])

# ============================================================
# 2. CREATE OR REPLACE get_current_tenant_id
# ============================================================
print("\n" + "=" * 70)
print("2. CREATE OR REPLACE get_current_tenant_id()")
print("=" * 70)

SQL = r"""
CREATE OR REPLACE FUNCTION public.get_current_tenant_id()
RETURNS integer
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_claims jsonb;
    v_email text;
    v_sub uuid;
    v_tid integer;
BEGIN
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
"""
o, e = run(f"""docker exec -i supabase-db psql -U supabase_admin -d postgres <<'EOF'
{SQL}
SELECT proname, pg_get_functiondef(oid) FROM pg_proc WHERE proname='get_current_tenant_id';
EOF""")
print(o[:2000])
if e: print("[ERR]", e[:500])

# ============================================================
# 3. Verify the function text has JSONB logic
# ============================================================
print("\n" + "=" * 70)
print("3. Check function body contains 'request.jwt.claims'")
print("=" * 70)
o, e = run("""docker exec supabase-db psql -U supabase_admin -d postgres -c "
SELECT prosrc FROM pg_proc WHERE proname='get_current_tenant_id';" """)
has_new = 'request.jwt.claims' in o
print(f"Has JSONB logic: {has_new}")
print(o[:500])

# ============================================================
# 4. Restart postgrest
# ============================================================
print("\n" + "=" * 70)
print("4. Restart postgrest")
print("=" * 70)
run("docker restart supabase-rest && sleep 5")

# ============================================================
# 5. End-to-end test
# ============================================================
print("\n" + "=" * 70)
print("5. REST API tests")
print("=" * 70)
auth_jwt = make_jwt("d0000000-0000-0000-0000-000000000001", "admin@thalvior.icu", "authenticated")
print(f"JWT[:50]={auth_jwt[:50]}")

# First test RPC
o, e = run(f"""curl -sS -X POST 'http://localhost:8000/rest/v1/rpc/get_current_tenant_id' \
  -H 'apikey: {ANON}' \
  -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
print(f"\nrpc/get_current_tenant_id => {o}")

# Then tables
for tbl in ['wms_orders', 'wms_accounts', 'wms_channels', 'wms_warehouses', 'wms_asns']:
    o, e = run(f"""curl -sS 'http://localhost:8000/rest/v1/{tbl}?limit=5' \
      -H 'apikey: {ANON}' \
      -H 'Authorization: Bearer {auth_jwt}' 2>&1""")
    print(f"\n{tbl} => {o[:300]}")
