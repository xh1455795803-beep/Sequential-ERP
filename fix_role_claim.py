#!/usr/bin/env python3
"""Fix PGRST_JWT_ROLE_CLAIM_KEY and test"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('127.0.0.1', 18080))
s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
resp = b''
while b'\r\n\r\n' not in resp:
    resp += s.recv(4096)

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect('43.133.232.81', port=22, username='ubuntu', password='Yuan340364#', sock=s)

def ssh(cmd):
    stdin, stdout, stderr = client.exec_command(cmd)
    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    ec = stdout.channel.recv_exit_status()
    return ec, out, err

def sudo(cmd):
    return ssh(f"sudo {cmd}")

COMPOSE = "/opt/supabase/docker/docker-compose.yml"
ENVFILE = "/opt/supabase/docker/.env"

# Check current PGRST_JWT_ROLE_CLAIM_KEY
print("=== Current compose JWT lines ===")
ec, out, _ = sudo(f"grep -A6 'PGRST_JWT_SECRET' {COMPOSE}")
print(out)

# Also check .env
print("\n=== .env PGRST lines ===")
ec, out, _ = sudo(f"grep 'PGRST' {ENVFILE}")
print(out)

# Add PGRST_JWT_ROLE_CLAIM_KEY: role to compose.yml
# First let's read full compose rest env section
ec, compose_content, _ = sudo(f"cat {COMPOSE}")

# Add PGRST_JWT_ROLE_CLAIM_KEY after PGRST_JWT_AUD
old = '      PGRST_JWT_AUD: "authenticated"'
new = old + '\n      PGRST_JWT_ROLE_CLAIM_KEY: "role"'

if old in compose_content:
    new_compose = compose_content.replace(old, new)
    # Upload
    sftp = client.open_sftp()
    with sftp.file('/tmp/docker-compose.new', 'w') as f:
        f.write(new_compose)
    sftp.close()
    sudo(f"cp {COMPOSE} {COMPOSE}.bak4 && mv /tmp/docker-compose.new {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")
    print("\nCompose updated!")
else:
    print("WARNING: Could not find PGRST_JWT_AUD line!")

# Verify
print("\n=== Verify ===")
ec, out, _ = sudo(f"grep -A10 'rest:' {COMPOSE} | head -30")
print(out)

# Force restart
print("\n=== Force restart ===")
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1")
sudo("docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:500]}")

for i in range(30):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('healthy' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        break

# Dump config to confirm
print("\n=== postgrest --dump-config JWT ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'jwt|role-claim'")
print(out)

# Login + Test
NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"
raw_key = NEW_SECRET.encode()
def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()

new_anon = sign_jwt({"role": "anon", "aud": "authenticated", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

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
    print(f"[{label}] ec={ec}: {out[:600]}")

client.close()
