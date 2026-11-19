#!/usr/bin/env python3
"""Enable postgrest debug logging and test"""
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

# Read compose
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()

# Add PGRST_LOG_LEVEL: debug
# First check if it exists
if 'PGRST_LOG_LEVEL' not in compose:
    # Add after PGRST_DB_USE_LEGACY_GUCS
    old = 'PGRST_DB_USE_LEGACY_GUCS: \'false\''
    new = old + '\n      PGRST_LOG_LEVEL: "debug"'
    compose = compose.replace(old, new)
    print("Added PGRST_LOG_LEVEL: debug")
else:
    # Change existing
    import re
    compose = re.sub(r'PGRST_LOG_LEVEL:.*', 'PGRST_LOG_LEVEL: "debug"', compose)
    print("Updated PGRST_LOG_LEVEL: debug")

sftp = client.open_sftp()
with sftp.file('/tmp/compose.debug', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.debug {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Restart
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    status = out.strip()
    print(f"  [{i*3}s] {status}")
    if 'healthy' in status:
        break

# Generate anon key
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

# Login
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

# Make the request
print("\n=== Make request (direct postgrest) ===")
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, _ = ssh(cmd)
print(f"Result: {out[:500]}")

# NOW check postgrest logs
print("\n=== Postgrest logs (after request) ===")
time.sleep(2)
ec, out, _ = ssh("docker logs supabase-rest --since 30s 2>&1")
print(out[-3000:])

# Also try with host curl
print("\n=== Host curl -> envoy -> postgrest ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" http://127.0.0.1:8000/rest/v1/rpc/debug_jwt_claims'
ec, out, _ = ssh(cmd)
print(f"Result: {out[:500]}")

time.sleep(1)
print("\n=== More logs ===")
ec, out, _ = ssh("docker logs supabase-rest --since 30s 2>&1")
print(out[-2000:])

client.close()
