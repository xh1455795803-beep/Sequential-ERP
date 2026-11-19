#!/usr/bin/env python3
"""Check postgrest crash logs and fix"""
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

COMPOSE = "/opt/supabase/docker/docker-compose.yml"
ENVFILE = "/opt/supabase/docker/.env"

# 1. Postgrest crash logs
print("=== Postgrest crash logs ===")
ec, out, _ = sudo("docker logs supabase-rest --tail 50 2>&1")
print(out)

# 2. Check compose content - my PGRST_JWT_ROLE_CLAIM_KEY line
print("\n=== Compose PGRST lines ===")
ec, out, _ = sudo(f"grep -n 'PGRST' {COMPOSE}")
print(out)

# 3. Check - was the sed command bad? Let's see the env section
print("\n=== Rest service full env ===")
ec, out, _ = sudo(f"sed -n '/^  rest:/,/^  realtime:/p' {COMPOSE}")
print(out[:2000])

# 4. Fix: remove the bad PGRST_JWT_ROLE_CLAIM_KEY and PGRST_JWT_AUD 
# Also restore PGRST_DB_EXTRA_SEARCH_PATH (we had duplicate)
print("\n=== Fix compose ===")

# First restore from .bak3
sftp = client.open_sftp()
with sftp.file('/opt/supabase/docker/docker-compose.yml', 'r') as f:
    compose_content = f.read().decode()

# Read the backup from the previous version (before I added PGRST_JWT_ROLE_CLAIM_KEY)
# Actually let me check if .bak3 exists
ec, bak_content, _ = sudo(f"cat {COMPOSE}.bak3 2>&1 | head -5")
print(f".bak3: {bak_content[:100]}")

if 'PGRST_JWT_SECRET_IS_BASE64' in bak_content:
    # bak3 has IS_BASE64=false but no ROLE_CLAIM_KEY - that's our good state
    print("Restoring from .bak3 (has IS_BASE64, no ROLE_CLAIM_KEY)")
    sudo(f"cp {COMPOSE}.bak3 {COMPOSE}")
else:
    print("bak3 doesn't have what we need, manual fix")
    # Remove bad lines and restore IS_BASE64=false + PGRST_AUD
    # ...

# Verify
ec, out, _ = sudo(f"grep -n 'PGRST' {COMPOSE}")
print(f"\nAfter fix:\n{out}")

# 5. Now let's just restart with the known-good config (IS_BASE64=false, no ROLE_CLAIM_KEY)
# and debug the jwt-role-claim-key from the default value perspective
print("\n=== Restart ===")
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1")
sudo("docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file {ENVFILE} up -d auth rest api-gw 2>&1")
print(f"ec={ec}\n{out[:500]}")

import time
for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    print(f"  [{i*3}s] rest: {out.strip()}")
    if 'healthy' in out or 'Up' in out:
        break

client.close()
