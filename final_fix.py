#!/usr/bin/env python3
"""THE FIX: set LEGACY_GUCS=true + restart + test"""
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

# 1. Fix compose: change LEGACY_GUCS to true
print("=== 1. Fix LEGACY_GUCS ===")
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()

old = "PGRST_DB_USE_LEGACY_GUCS: 'false'"
new = "PGRST_DB_USE_LEGACY_GUCS: 'true'"
compose = compose.replace(old, new)

sftp = client.open_sftp()
with sftp.file('/tmp/compose.fixed', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.fixed {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Verify
ec, out, _ = sudo(f"grep -E 'LEGACY_GUCS|JWT_SECRET|ROLE_CLAIM|JWT_AUD' {COMPOSE}")
print(f"After fix:\n{out}")

# 2. Force restart
print("\n=== 2. Force restart ===")
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:500]}")

for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    status = out.strip()
    print(f"  [{i*3}s] rest: {status}")
    if 'healthy' in status:
        break

# 3. Verify postgrest config
print("\n=== 3. Verify postgrest config ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'legacy|jwt'")
print(out)

# 4. Generate keys + Login
NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"
raw_key = NEW_SECRET.encode()
def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()
new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

# Reload debug function too
print("\n=== 4. Reload debug function ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "NOTIFY pgrst, 'reload schema';" """)
time.sleep(2)

# 5. TESTS
print("\n=== 5. TESTS ===")
for label, path in [
    ("debug_postgrest", "rpc/debug_postgrest"),
    ("debug_jwt_claims", "rpc/debug_jwt_claims"),
    ("wms_orders", "wms_orders?select=order_no,status,tenant_id&limit=5"),
    ("wms_warehouses", "wms_warehouses?select=warehouse_code&limit=5"),
    ("wms_shipping_channels", "wms_shipping_channels?select=channel_code,channel_name,is_active&limit=10"),
    ("wms_inbound_receipts", "wms_inbound_receipts?select=receipt_no,status&limit=5"),
    ("wms_shipment_labels", "wms_shipment_labels?select=label_no,status,channel_id&limit=5"),
    ("wms_products", "wms_products?select=sku_code,product_name&limit=5"),
]:
    cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, _ = ssh(cmd)
    print(f"[{label}] {out[:500]}")

client.close()
print("\n=== DONE ===")
