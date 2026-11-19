#!/usr/bin/env python3
"""Fix Supabase JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY on server 43.133.232.81
Uses the tested socket+paramiko.Transport approach.
"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

# Connect via proxy (proven working)
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
resp = b''
while b'\r\n\r\n' not in resp:
    resp += s.recv(4096)

t = paramiko.Transport(s)
t.start_client()
t.auth_password('ubuntu', 'Yuan340364#')

def ssh(cmd):
    c = t.open_session()
    c.exec_command(cmd)
    out, err = b'', b''
    while True:
        ch = c.recv(65536)
        if not ch: break
        out += ch
    ec = c.recv_exit_status()
    return ec, out.decode('utf-8', errors='replace'), err.decode('utf-8', errors='replace')

def sudo(cmd):
    return ssh(f"sudo {cmd}")

# ========== Step 1: Generate correct keys ==========
print("=== Step 1: Generate keys ===")
original_b64 = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
raw_key = base64.b64decode(original_b64)
print(f"Raw HMAC key: {len(raw_key)} bytes: {raw_key.hex()}")

def b64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b'=')

def sign_jwt(payload, secret):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    p = json.dumps(payload).encode()
    si = b64url_encode(h) + b'.' + b64url_encode(p)
    sig = hmac.new(secret, si, hashlib.sha256).digest()
    return (si + b'.' + b64url_encode(sig)).decode()

new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)
new_service = sign_jwt({"role": "service_role", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)
print(f"ANON_KEY   = {new_anon}")
print(f"SERVICE_ROLE_KEY = {new_service}")

# ========== Step 2: Fix files ==========
print("\n=== Step 2: Fix files ===")

# Backup
sudo("cp /opt/supabase/docker/.env /opt/supabase/docker/.env.bak")

# We'll use a base64-encoded sed script to avoid escaping issues
# Encode each sed command

# Fix JWT_SECRET
cmd = f"sed -i 's|^JWT_SECRET=.*|JWT_SECRET={original_b64}|' /opt/supabase/docker/.env"
ec, out, _ = sudo(cmd)
print(f"JWT_SECRET fix ec={ec}")

# Fix ANON_KEY - contains + and _ chars; use | as separator (safe for base64url JWT)
cmd = f"sed -i 's|^ANON_KEY=.*|ANON_KEY={new_anon}|' /opt/supabase/docker/.env"
ec, out, _ = sudo(cmd)
print(f"ANON_KEY fix ec={ec}")

# Fix SERVICE_ROLE_KEY
cmd = f"sed -i 's|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY={new_service}|' /opt/supabase/docker/.env"
ec, out, _ = sudo(cmd)
print(f"SERVICE_ROLE_KEY fix ec={ec}")

# Fix compose.yml PGRST_JWT_SECRET line
# Current bad value (we set it manually earlier): BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A=
# Desired: ${JWT_JWKS:-${JWT_SECRET}}
bad = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
good = "${JWT_JWKS:-${JWT_SECRET}}"
# Escape $ signs for sed
good_escaped = good.replace('$', r'\$')
cmd = f"sed -i 's|PGRST_JWT_SECRET: {bad}|PGRST_JWT_SECRET: {good_escaped}|' /opt/supabase/docker/docker-compose.yml"
ec, out, _ = sudo(cmd)
print(f"compose fix ec={ec}")

# Verify both files
ec, out, _ = sudo("grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' /opt/supabase/docker/.env")
print(f"\n.env verify:\n{out}")
ec, out, _ = sudo("grep PGRST_JWT_SECRET /opt/supabase/docker/docker-compose.yml")
print(f"\ncompose verify:\n{out}")

# ========== Step 3: Restart ==========
print("\n=== Step 3: Restart auth + rest + envoy ===")
ec, out, _ = sudo("cd /opt/supabase/docker && docker compose up -d auth rest api-gw 2>&1")
print(f"Restart:\n{out[:500]}")

# Wait
for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('(healthy)' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        print("  All containers up!")
        break

# ========== Step 4: Test ==========
print("\n=== Step 4: Test ===")

# Login
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
try:
    login_data = json.loads(out)
    auth_jwt = login_data['access_token']
    print(f"Login OK, JWT: {auth_jwt[:60]}...")
except Exception as e:
    print(f"Login FAILED: {e}\nout={out[:300]}")
    t.close()
    sys.exit(1)

# Test direct postgrest first (no envoy, simplest path)
print("\n--- Direct postgrest: auth container -> rest:3000 ---")
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, err = ssh(cmd)
print(f"ec={ec}")
print(f"  Result: {out[:500]}")
if err: print(f"  stderr: {err[:200]}")

# Test via envoy (host -> 127.0.0.1:8000)
print("\n--- Via envoy (host curl) ---")
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims'
ec, out, err = ssh(cmd)
print(f"ec={ec}")
print(f"  Result: {out[:500]}")
if err: print(f"  stderr: {err[:200]}")

# Test wms_orders with RLS
print("\n--- wms_orders via envoy ---")
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_id,order_no,status,tenant_id"'
ec, out, err = ssh(cmd)
print(f"ec={ec}")
print(f"  Result: {out[:500]}")
if err: print(f"  stderr: {err[:200]}")

# Also test wms_warehouses, wms_shipping_channels
print("\n--- wms_warehouses ---")
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_warehouses?select=warehouse_id,warehouse_code,warehouse_name"'
ec, out, err = ssh(cmd)
print(f"ec={ec}: {out[:300]}")

print("\n--- wms_shipping_channels ---")
cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_shipping_channels?select=channel_id,channel_code,channel_name"'
ec, out, err = ssh(cmd)
print(f"ec={ec}: {out[:300]}")

# Also need to update frontend .env.production with the new anon key?
# Let's check what the current VITE_SUPABASE_ANON_KEY is
print("\n--- Check frontend .env.production ---")
try:
    with open('/workspace/wms-app/.env.production', 'r') as f:
        for line in f:
            if 'ANON_KEY' in line or 'SUPABASE' in line:
                print(f"  {line.strip()[:80]}")
except FileNotFoundError:
    print("  No .env.production found")

t.close()
print("\n=== DONE ===")
