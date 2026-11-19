#!/usr/bin/env python3
"""Full restart with absolute path"""
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

COMPOSE = "/opt/supabase/docker/docker-compose.yml"
ENVFILE = "/opt/supabase/docker/.env"

# Make sure .env ends with newline
print("=== Fix .env trailing newline ===")
sudo(f"sed -i -e '$a\\' {ENVFILE}")

# Use absolute path
print("\n=== Up auth, rest, api-gw ===")
cmd = f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1"
ec, out, err = sudo(cmd)
print(f"ec={ec}")
print(f"stdout:\n{out}")
print(f"stderr:\n{err}")

# Wait
for i in range(30):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('healthy' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        print("  All up!")
        break

# Verify envs
print("\n=== auth GOTRUE_JWT_SECRET ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT_SECRET")
print(out.strip())

print("\n=== rest PGRST_JWT_SECRET ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_JWT_SECRET")
print(out.strip())

# Generate keys
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

# Login
print("\n=== Login ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']
print(f"OK: {auth_jwt[:60]}...")

# Verify signature
parts = auth_jwt.split('.')
def b64ud(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)
sig_input = (parts[0] + '.' + parts[1]).encode()
actual_sig = b64ud(parts[2])
expected_sig = hmac.new(raw_key, sig_input, hashlib.sha256).digest()
match = hmac.compare_digest(actual_sig, expected_sig)
print(f"Signature matches original_raw(32b): {match}")

# TESTS
print("\n=== TESTS ===")
for label, path in [
    ("debug_jwt_claims", "rpc/debug_jwt_claims"),
    ("wms_orders", "wms_orders?select=order_id,order_no,status,tenant_id"),
    ("wms_warehouses", "wms_warehouses?select=warehouse_id,warehouse_code"),
    ("wms_shipping_channels", "wms_shipping_channels?select=channel_code,channel_name,is_active"),
    ("wms_inbound_receipts", "wms_inbound_receipts?select=receipt_no,status"),
]:
    cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, err = ssh(cmd)
    print(f"[{label}] ec={ec}: {out[:400]}")

t.close()
print("\n=== DONE ===")
