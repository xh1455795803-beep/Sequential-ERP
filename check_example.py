#!/usr/bin/env python3
"""Check postgrest example config and actual env values"""
import socket, paramiko

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

# 1. Postgrest example config
print("=== 1. postgrest --example (JWT section) ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --example 2>&1 | grep -iA2 -B2 'jwt\\|role-claim'")
print(out)

# 2. Actual env values in container (not YAML-parsed)
print("\n=== 2. Actual container env ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | sort")
for line in out.split('\n'):
    if 'PGRST_JWT' in line or 'ROLE_CLAIM' in line or 'AUD' in line:
        # Show raw bytes
        print(f"  {repr(line)}")

# 3. Dump config full, see actual value
print("\n=== 3. Full dump-config ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --dump-config 2>&1")
for line in out.split('\n'):
    if 'role-claim' in line.lower() or 'jwt-secret' in line.lower() or 'jwt-aud' in line.lower():
        print(f"  {repr(line)}")

# 4. Try: remove PGRST_JWT_ROLE_CLAIM_KEY entirely and use default
print("\n=== 4. Test without ROLE_CLAIM_KEY ===")
# Compose backup and remove that line
sftp = client.open_sftp()
with sftp.file('/opt/supabase/docker/docker-compose.yml', 'r') as f:
    compose = f.read().decode()
sftp.close()

# Remove PGRST_JWT_ROLE_CLAIM_KEY line
import re
new_compose = re.sub(r'\n\s+PGRST_JWT_ROLE_CLAIM_KEY:.*', '', compose)
print(f"Removed ROLE_CLAIM_KEY: {new_compose != compose}")

sftp = client.open_sftp()
with sftp.file('/tmp/compose.noclaim', 'w') as f:
    f.write(new_compose)
sftp.close()
sudo("cp /opt/supabase/docker/docker-compose.yml /opt/supabase/docker/docker-compose.yml.bak6 && mv /tmp/compose.noclaim /opt/supabase/docker/docker-compose.yml && chown ubuntu:ubuntu /opt/supabase/docker/docker-compose.yml")

# Restart
import time
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
sudo("docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env up -d auth rest api-gw 2>&1")
for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    if 'healthy' in out or 'Up' in out:
        print(f"  [{i*3}s] rest: {out.strip()}")
        break

# Dump config now
print("\n=== Dump config (no ROLE_CLAIM_KEY) ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --dump-config 2>&1 | grep -iE 'role-claim|jwt'")
print(out)

# Generate anon key and login
import base64, hmac, hashlib, json
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

# Tests
print("\n=== TESTS ===")
for label, path in [
    ("debug", "rpc/debug_jwt_claims"),
    ("orders", "wms_orders?select=order_no,status,tenant_id"),
]:
    cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/{path}"'
    ec, out, _ = ssh(cmd)
    print(f"[{label}] {out[:400]}")

client.close()
