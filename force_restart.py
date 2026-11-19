#!/usr/bin/env python3
"""Force stop and restart auth/rest/envoy containers"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

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
    c = t.open_session(); c.exec_command(cmd)
    out, err = b'', b''
    while True:
        ch = c.recv(65536)
        if not ch: break
        out += ch
    ec = c.recv_exit_status()
    return ec, out.decode('utf-8', errors='replace'), err.decode('utf-8', errors='replace')

def sudo(cmd):
    return ssh(f"sudo {cmd}")

# First, check the state of things
print("=== Check .env JWT_SECRET ===")
ec, out, _ = sudo("grep '^JWT_SECRET=' /opt/supabase/docker/.env")
print(out.strip())

print("\n=== Check compose auth JWT secret line ===")
ec, out, _ = sudo("grep -A1 'GOTRUE_JWT_SECRET' /opt/supabase/docker/docker-compose.yml")
print(out.strip())

print("\n=== Check compose rest JWT secret line ===")
ec, out, _ = sudo("grep 'PGRST_JWT_SECRET' /opt/supabase/docker/docker-compose.yml")
print(out.strip())

# Now check if auth container was created with the OLD secret
print("\n=== Current auth GOTRUE_JWT_SECRET ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT_SECRET")
print(out.strip())

# Force stop, remove, then up
print("\n=== Force stop + rm + up auth, rest, envoy ===")
ec, out, _ = sudo("cd /opt/supabase/docker && docker compose stop auth rest api-gw 2>&1")
print(f"stop: {out.strip()}")

ec, out, _ = sudo("cd /opt/supabase/docker && docker compose rm -f auth rest api-gw 2>&1")
print(f"rm: {out.strip()}")

ec, out, _ = sudo("cd /opt/supabase/docker && docker compose up -d auth rest api-gw 2>&1")
print(f"up: {out.strip()}")

# Wait for health
for i in range(30):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('healthy' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        print("  All up!")
        break

# NOW verify envs
print("\n=== Verify auth GOTRUE_JWT_SECRET ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT_SECRET")
print(out.strip())

print("\n=== Verify rest PGRST_JWT_SECRET ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_JWT_SECRET")
print(out.strip())

# Generate anon key
original_b64 = "BRnoce2N0ZWRx+NZBWYEWnTlHVBI5jiE9DTyH/jie9A="
raw_key = base64.b64decode(original_b64)
def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()
new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

print("\n=== Verify envoy ANON_KEY ===")
ec, out, _ = ssh("docker inspect supabase-envoy --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^ANON_KEY'")
print(f"Envoy ANON_KEY env: {out.strip()[:80]}")

# Login
print("\n=== Login ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']
print(f"OK: {auth_jwt[:60]}...")

# Verify signature matches
parts = auth_jwt.split('.')
def b64ud(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)
sig_input = (parts[0] + '.' + parts[1]).encode()
actual_sig = b64ud(parts[2])
expected_sig = hmac.new(raw_key, sig_input, hashlib.sha256).digest()
print(f"Signature matches original_raw(32b): {hmac.compare_digest(actual_sig, expected_sig)}")

# If this is True, then auth and postgrest are using the same key!

# TESTS
print("\n=== TESTS ===")

cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims'
ec, out, err = ssh(cmd)
print(f"[debug] ec={ec}: {out[:500]}")

cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_id,order_no,status,tenant_id"'
ec, out, err = ssh(cmd)
print(f"[orders] ec={ec}: {out[:500]}")

cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_warehouses?select=warehouse_id,warehouse_code"'
ec, out, err = ssh(cmd)
print(f"[warehouses] ec={ec}: {out[:300]}")

cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_shipping_channels?select=channel_code,channel_name,is_active"'
ec, out, err = ssh(cmd)
print(f"[channels] ec={ec}: {out[:300]}")

t.close()
print("\n=== DONE ===")
