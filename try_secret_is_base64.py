#!/usr/bin/env python3
"""Try PGRST_JWT_SECRET_IS_BASE64=false and also check postgrest debug"""
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

# First: check postgrest version and all env vars
print("=== Postgrest version + all possible JWT env vars ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --version 2>&1")
print(out)

ec, out, _ = ssh("docker exec supabase-rest postgrest --help 2>&1 | head -80")
print(f"Help:\n{out}")

# Check postgrest source env var names
print("\n=== Compose rest section ===")
ec, out, _ = sudo(f"sed -n '/rest:/,/^  [a-z]/p' {COMPOSE} | head -40")
print(out)

# Check if PGRST_JWT_SECRET_IS_BASE64 is a valid env
print("\n=== Check postgrest help for secret_is_base64 ===")
ec, out, _ = ssh("docker exec supabase-rest postgrest --help 2>&1 | grep -i -E 'secret|base64|jwt|aud'")
print(out)

# Let's also check what postgrest source code uses
# Actually let's just try: add PGRST_JWT_SECRET_IS_BASE64=false to compose and restart
# Also try: set PGRST_JWT_AUD=authenticated

print("\n=== Adding PGRST_JWT_SECRET_IS_BASE64 and PGRST_JWT_AUD to compose ===")
# Read compose
ec, compose_content, _ = sudo(f"cat {COMPOSE}")

# Find the rest service PGRST block and add new env vars
# We need to find where PGRST_JWT_SECRET is and add two more lines after it
old_line = "      PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}"
new_lines = """      PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}
      PGRST_JWT_SECRET_IS_BASE64: "false"
      PGRST_JWT_AUD: "authenticated"
      PGRST_LOG_LEVEL: "debug"
      PGRST_DB_EXTRA_SEARCH_PATH: "public, app" """

# Actually let's just add these as new env vars in the rest service
# Let's use sed to insert after PGRST_JWT_SECRET line
old = 'PGRST_JWT_SECRET: ${JWT_JWKS:-${JWT_SECRET}}'
new = old + '\n      PGRST_JWT_SECRET_IS_BASE64: "false"\n      PGRST_JWT_AUD: "authenticated"'

import re
new_compose = compose_content.replace(old, new)

if new_compose == compose_content:
    print("WARNING: Could not find PGRST_JWT_SECRET line to replace!")
    # Print surrounding lines
    for i, line in enumerate(compose_content.split('\n')):
        if 'PGRST_JWT_SECRET' in line:
            lines = compose_content.split('\n')
            print(f"  Line {i}: {lines[i-1] if i>0 else ''}")
            print(f"  Line {i+1}: {line}")
            print(f"  Line {i+2}: {lines[i+1] if i+1 < len(lines) else ''}")
else:
    print("Compose updated with new env vars")
    # Upload
    sftp = client.open_sftp()
    with sftp.file('/tmp/docker-compose.new', 'w') as f:
        f.write(new_compose)
    sftp.close()
    sudo(f"cp {COMPOSE} {COMPOSE}.bak3 && mv /tmp/docker-compose.new {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Verify
ec, out, _ = sudo(f"grep -A2 'PGRST_JWT_SECRET' {COMPOSE}")
print(f"\nCompose now:\n{out}")

# Restart
print("\n=== Stop + rm + up ===")
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

# Verify rest envs
print("\n=== Rest container envs ===")
ec, out, _ = ssh("docker inspect supabase-rest --format '{{range .Config.Env}}{{println .}}{{end}}' | sort")
print(out)

# Login and test
print("\n=== Login + Test ===")
ec, out, _ = ssh('docker exec supabase-auth wget -qO- --post-data=\'{"email":"admin@thalvior.icu","password":"3403641888"}\' --header=\'Content-Type: application/json\' http://localhost:9999/token?grant_type=password')
auth_jwt = json.loads(out)['access_token']

# Direct postgrest
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" http://rest:3000/rpc/debug_jwt_claims'
ec, out, _ = ssh(cmd)
print(f"[debug] {out[:500]}")

# Orders via postgrest
cmd = f'docker exec supabase-auth wget -qO- --header="Authorization: Bearer {auth_jwt}" "http://rest:3000/wms_orders?select=order_no,status,tenant_id"'
ec, out, _ = ssh(cmd)
print(f"[orders] {out[:500]}")

# Postgrest logs now
print("\n=== Postgrest logs (after test) ===")
ec, out, _ = ssh("docker logs supabase-rest --since 30s 2>&1")
print(out[-2000:])

client.close()
