#!/usr/bin/env python3
"""Fix JWT: use a raw hex string as JWT_SECRET (not base64 format)"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json, secrets

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

# Generate a 64-char hex string (32 bytes raw, hex-encoded -> 64 chars)
# Hex strings are NOT valid base64 (different alphabet, length 64 = 4*16 so it could be... hmm)
# Actually let's use a UUID-style string with dashes - definitely not base64
NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb"  # 52 chars, not base64 format

# Let's verify: is this valid base64?
try:
    decoded = base64.b64decode(NEW_SECRET + '==')
    print(f"WARNING: NEW_SECRET might be decodable as base64: {len(decoded)} bytes")
except:
    print(f"Good: NEW_SECRET is NOT valid base64")

# Generate ANON_KEY and SERVICE_ROLE_KEY with NEW_SECRET as raw key
raw_key = NEW_SECRET.encode()  # 52 bytes as raw
print(f"\nUsing JWT_SECRET={NEW_SECRET}")
print(f"Raw key length: {len(raw_key)} bytes")

def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()

new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)
new_service = sign_jwt({"role": "service_role", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

print(f"ANON_KEY={new_anon}")
print(f"SERVICE_ROLE_KEY={new_service}")

# Now fix .env
ENVFILE = "/opt/supabase/docker/.env"
COMPOSE = "/opt/supabase/docker/docker-compose.yml"

print(f"\n=== Fix .env ===")

# Build sed commands
# NEW_SECRET has no special sed chars except nothing; use | as separator
for label, old_pattern, new_val in [
    ("JWT_SECRET", "JWT_SECRET=.*", f"JWT_SECRET={NEW_SECRET}"),
    ("ANON_KEY", "ANON_KEY=.*", f"ANON_KEY={new_anon}"),
    ("SERVICE_ROLE_KEY", "SERVICE_ROLE_KEY=.*", f"SERVICE_ROLE_KEY={new_service}"),
]:
    # Use python for safety
    pass

# Use Python to edit .env reliably
py_edits = f"""
import re

with open("{ENVFILE}", "r") as f:
    content = f.read()

content = re.sub(r'^JWT_SECRET=.*$', 'JWT_SECRET={NEW_SECRET}', content, flags=re.MULTILINE)
content = re.sub(r'^ANON_KEY=.*$', 'ANON_KEY={new_anon}', content, flags=re.MULTILINE)
content = re.sub(r'^SERVICE_ROLE_KEY=.*$', 'SERVICE_ROLE_KEY={new_service}', content, flags=re.MULTILINE)

# Ensure trailing newline
if not content.endswith('\\n'):
    content += '\\n'

with open("{ENVFILE}", "w") as f:
    f.write(content)

print(".env updated OK")
"""

ec, out, err = sudo(f'python3 -c {json.dumps(py_edits)}')
print(f"Python edit: ec={ec}")
print(out)
if err: print(f"stderr: {err[:300]}")

# Verify
ec, out, _ = sudo(f"grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' {ENVFILE} | head -3")
print(f"\n.env verify:\n{out}")

# Force restart
print("\n=== Stop + rm containers ===")
sudo("docker stop supabase-auth supabase-rest supabase-envoy 2>&1")
sudo("docker rm supabase-auth supabase-rest supabase-envoy 2>&1")

print("\n=== Compose up ===")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:500]}")

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
print("\n=== Verify container envs ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT_SECRET")
print(f"auth GOTRUE_JWT_SECRET: {out.strip()}")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_JWT_SECRET")
print(f"rest PGRST_JWT_SECRET: {out.strip()}")

# Login
print("\n=== Login ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
login_data = json.loads(out)
auth_jwt = login_data['access_token']
print(f"OK: {auth_jwt[:60]}...")

# Verify auth signs with raw secret
parts = auth_jwt.split('.')
def b64ud(s):
    s += '=' * (4 - len(s) % 4)
    return base64.urlsafe_b64decode(s)
sig_input = (parts[0] + '.' + parts[1]).encode()
actual_sig = b64ud(parts[2])
expected_sig = hmac.new(raw_key, sig_input, hashlib.sha256).digest()
match = hmac.compare_digest(actual_sig, expected_sig)
print(f"Auth JWT signed with raw_key ({len(raw_key)} bytes): {match}")

# TESTS
print("\n=== TESTS ===")
for label, path in [
    ("debug_jwt_claims", "rpc/debug_jwt_claims"),
    ("wms_orders", "wms_orders?select=order_no,status,tenant_id"),
    ("wms_warehouses", "wms_warehouses?select=warehouse_code"),
    ("wms_shipping_channels", "wms_shipping_channels?select=channel_code,channel_name,is_active"),
    ("wms_inbound_receipts", "wms_inbound_receipts?select=receipt_no,status"),
]:
    cmd = f'curl -sS --connect-timeout 5 --max-time 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, err = ssh(cmd)
    print(f"[{label}] ec={ec}: {out[:500]}")

t.close()
print("\n=== DONE ===")
