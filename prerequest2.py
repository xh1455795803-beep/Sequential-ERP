#!/usr/bin/env python3
"""Fix pre-request hook format and also query GUCs via different approach"""
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

# 1. Check postgrest 14.17 changelog for GUC behavior
print("=== 1. Check postgrest docs ===")
import urllib.request
try:
    url = "https://postgrest.org/en/v14.17/api.html#jwt-role-claim-key"
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8.5.0'})
    resp = urllib.request.urlopen(req, timeout=10)
    content = resp.read().decode()
    # Search for relevant sections
    import re
    for match in re.finditer(r'(?i)(legacy|use-legacy|set_config|jwt.*claim|request\.jwt|pre-request)[^<]{0,100}', content):
        print(f"  Found: {match.group()[:150]}")
except Exception as e:
    print(f"  Fetch failed: {e}")

# 2. Let's check: does postgrest use request.jwt.role (without .claim) ?
print("\n=== 2. Test if postgrest sets request.jwt.role directly ===")
# Create a simpler pre-request function (no () in the call)
COMPOSE = "/opt/supabase/docker/docker-compose.yml"
sftp = client.open_sftp()
with sftp.file(COMPOSE, 'r') as f:
    compose = f.read().decode()
sftp.close()

# Fix pre-request to just the function name
compose = compose.replace('PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug()"', 
                          'PGRST_DB_PRE_REQUEST: "public.pgrst_pre_request_debug"')

sftp = client.open_sftp()
with sftp.file('/tmp/compose.pr2', 'w') as f:
    f.write(compose)
sftp.close()
sudo(f"mv /tmp/compose.pr2 {COMPOSE} && chown ubuntu:ubuntu {COMPOSE}")

# Restart
sudo("docker stop supabase-rest supabase-auth supabase-envoy 2>&1 && docker rm supabase-rest supabase-auth supabase-envoy 2>&1")
ec, out, _ = sudo(f"docker compose -f {COMPOSE} --env-file /opt/supabase/docker/.env up -d auth rest api-gw 2>&1")
print(f"Restart: {out[:300]}")

for i in range(20):
    time.sleep(3)
    ec, out, _ = ssh("docker ps --format '{{.Names}} {{.Status}}' | grep supabase-rest")
    if 'healthy' in out:
        break

# 3. Login + request + check debug log
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

# Clear debug log
sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "DELETE FROM postgrest_debug_log;" """)

print("\n=== Make request ===")
cmd = f'curl -sS -m 15 -H "apikey: {new_anon}" -H "Authorization: Bearer {auth_jwt}" "http://127.0.0.1:8000/rest/v1/wms_orders?select=order_no&limit=2"'
ec, out, _ = ssh(cmd)
print(f"Result: {out[:500]}")

time.sleep(1)

print("\n=== Debug log ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT current_user, settings FROM postgrest_debug_log ORDER BY id DESC LIMIT 5;" """)
print(out)

print("\n=== All pg_settings with request or app ===")
ec, out, _ = sudo("""docker exec supabase-db psql -U supabase_admin -d postgres -c "SELECT name, setting FROM pg_settings WHERE name LIKE 'request.%' OR name LIKE 'app.%' ORDER BY name;" """)
print(out[:2000])

client.close()
