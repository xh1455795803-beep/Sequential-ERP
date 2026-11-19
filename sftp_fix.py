#!/usr/bin/env python3
"""Use SFTP to upload fixed .env and restart"""
import socket, base64, hmac, hashlib, paramiko, time, sys, json, re

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

# New raw secret - definitely NOT base64 format (contains dashes, length 51 not base64 multiple)
NEW_SECRET = "thalvior-wms-supabase-jwt-secret-v1-fixed-2026-wb-v2"  # 54 chars

raw_key = NEW_SECRET.encode()

def b64u(d): return base64.urlsafe_b64encode(d).rstrip(b'=')
def sign_jwt(p, s):
    h = json.dumps({"alg": "HS256", "typ": "JWT"}).encode()
    pp = json.dumps(p).encode()
    si = b64u(h) + b'.' + b64u(pp)
    sig = hmac.new(s, si, hashlib.sha256).digest()
    return (si + b'.' + b64u(sig)).decode()

new_anon = sign_jwt({"role": "anon", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)
new_service = sign_jwt({"role": "service_role", "iss": "supabase", "iat": 1790268016, "exp": 2105628016}, raw_key)

print(f"New JWT_SECRET: {NEW_SECRET} ({len(raw_key)} bytes raw)")
print(f"New ANON_KEY:   {new_anon}")
print(f"New SERVICE_ROLE_KEY: {new_service}")

# Read current .env via SSH, edit in memory, upload via SFTP
print("\n=== Read current .env ===")
ec, env_content, _ = ssh(f"sudo cat {ENVFILE}")
print(f"Read {len(env_content)} chars, {env_content.count(chr(10))} lines")

# Verify it ends with newline
if not env_content.endswith('\n'):
    env_content += '\n'

# Edit using regex
env_content = re.sub(r'^JWT_SECRET=.*$', f'JWT_SECRET={NEW_SECRET}', env_content, flags=re.MULTILINE)
env_content = re.sub(r'^ANON_KEY=.*$', f'ANON_KEY={new_anon}', env_content, flags=re.MULTILINE)
env_content = re.sub(r'^SERVICE_ROLE_KEY=.*$', f'SERVICE_ROLE_KEY={new_service}', env_content, flags=re.MULTILINE)

print("\n=== Verify edits in memory ===")
for line in env_content.split('\n'):
    if line.startswith(('JWT_SECRET=', 'ANON_KEY=', 'SERVICE_ROLE_KEY=')):
        print(f"  {line[:80]}")

# Upload via SFTP to /tmp, then sudo mv
print("\n=== Upload to server ===")
sftp = client.open_sftp()
with sftp.file('/tmp/.env.new', 'w') as f:
    f.write(env_content)
sftp.close()

# Move with sudo
ec, out, err = sudo(f"cp {ENVFILE} {ENVFILE}.bak2 && mv /tmp/.env.new {ENVFILE} && chmod 600 {ENVFILE} && chown ubuntu:ubuntu {ENVFILE}")
print(f"Move ec={ec}: {out} {err[:200]}")

# Verify file
ec, out, _ = sudo(f"head -5 {ENVFILE} && echo '---' && grep -c '' {ENVFILE}")
print(f"\nVerify:\n{out[:300]}")

# Verify specific lines
ec, out, _ = sudo(f"grep -E '^(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)=' {ENVFILE}")
print(f"\nKey lines:\n{out}")

# Stop + rm + up
print("\n=== Stop containers ===")
sudo("docker stop supabase-auth supabase-rest supabase-envoy 2>&1")
sudo("docker rm supabase-auth supabase-rest supabase-envoy 2>&1")

print("\n=== Compose up ===")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:800]}")

for i in range(30):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep -E 'supabase-(auth|rest|envoy)'")
    lines = [l for l in out.strip().split('\n') if l.strip()]
    print(f"  [{i*3}s] {lines}")
    if all(('healthy' in l or 'Up' in l) for l in lines) and len(lines) >= 3:
        print("  All up!")
        break

# Verify envs
print("\n=== Container envs ===")
ec, out, _ = ssh("docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' | grep GOTRUE_JWT_SECRET")
print(f"auth: {out.strip()}")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | grep PGRST_JWT_SECRET")
print(f"rest: {out.strip()}")

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
print(f"Auth JWT signed with raw_key ({len(raw_key)}b): {match}")

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

client.close()
print("\n=== DONE ===")
