#!/usr/bin/env python3
"""Fix envoy port + nginx config manually."""
import socket, paramiko, time, json, base64, hmac, hashlib, subprocess, os

def ssh_exec(cmd, timeout=120, retries=3):
    last_err = None
    for _ in range(retries):
        try:
            s = socket.socket(); s.settimeout(15)
            s.connect(('127.0.0.1', 18080))
            s.sendall(b"CONNECT 43.133.232.81:22 HTTP/1.1\r\nHost: 43.133.232.81:22\r\n\r\n")
            t = paramiko.Transport(s); t.start_client(timeout=15); t.auth_password('ubuntu', 'Yuan340364#')
            chan = t.open_session(); chan.settimeout(timeout); chan.exec_command(cmd)
            out = chan.recv(131072).decode(errors='replace')
            err = chan.recv_stderr(65535).decode(errors='replace')
            t.close(); s.close()
            return out.strip(), err.strip()
        except Exception as ex:
            last_err = ex; time.sleep(2)
    raise last_err

def run(c, t=120): return ssh_exec(c, t)

# === 1. See EXACT envoy ports line ===
print("=== 1. Envoy ports line (raw) ===")
o, e = run("grep -n -A10 'container_name: supabase-envoy' /opt/supabase/docker/docker-compose.yml | head -15")
print(o)

# === 2. Read the whole compose, find and replace the ports ===
print("\n=== 2. Fix envoy ports via python ===")
o, e = run("cat /opt/supabase/docker/docker-compose.yml")
compose = o
# Show lines around ports
for i, line in enumerate(compose.split('\n')):
    if '8000' in line or 'ports:' in line:
        print(f"  L{i+1}: {line}")

# Fix all occurrences: "127.0.0.1:8000->8000/tcp" → "8000:8000"
# Also "127.0.0.1:10000->10000" → "10000:10000"
compose_new = compose.replace('127.0.0.1:8000->8000/tcp', '8000:8000')
compose_new = compose_new.replace('127.0.0.1:10000->10000/tcp', '10000:10000')
compose_new = compose_new.replace('127.0.0.1:8000->8000', '8000:8000')
compose_new = compose_new.replace('127.0.0.1:10000->10000', '10000:10000')
if compose_new != compose:
    b64 = base64.b64encode(compose_new.encode()).decode()
    run(f"echo '{b64}' | base64 -d | sudo tee /opt/supabase/docker/docker-compose.yml > /dev/null")
    print("  ✅ Compose updated")
else:
    print("  ❌ No changes made — check manually")

# Verify
o, e = run("grep -n '8000\\|10000' /opt/supabase/docker/docker-compose.yml | head -10")
print("After fix:", o)

# === 3. Restart envoy ===
print("\n=== 3. Restart envoy with new ports ===")
o, e = run("docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env up -d api-gw 2>&1")
print(o[:500])
time.sleep(5)

o, e = run("docker port supabase-envoy 2>&1")
print("Port mapping:", o)

# === 4. Fix nginx config ===
print("\n=== 4. Rewrite nginx config ===")
nginx_conf = """server {
    listen 80 default_server;
    server_name _;

    root /var/www/wms;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /rest/ {
        proxy_pass http://127.0.0.1:8000/rest/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /auth/ {
        proxy_pass http://127.0.0.1:8000/auth/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /storage/ {
        proxy_pass http://127.0.0.1:8000/storage/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    location /functions/ {
        proxy_pass http://127.0.0.1:8000/functions/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
"""
b64 = base64.b64encode(nginx_conf.encode()).decode()
run(f"echo '{b64}' | base64 -d | sudo tee /etc/nginx/sites-available/wms > /dev/null")
run("sudo ln -sf /etc/nginx/sites-available/wms /etc/nginx/sites-enabled/wms")
run("sudo rm -f /etc/nginx/sites-enabled/default")
o, e = run("sudo nginx -t 2>&1")
print(f"nginx -t: {o} {e}")
o, e = run("sudo systemctl restart nginx 2>&1 || sudo nginx -s reload 2>&1")
print(f"nginx restart: {o} {e}")
time.sleep(2)

# === 5. Test everything ===
print("\n=== 5. Full connectivity test ===")
o, e = run("curl -sS -o /dev/null -w 'Frontend /: HTTP %{http_code}\\n' http://localhost/")
print(o)
o, e = run("curl -sS http://localhost/index.html | head -5")
print("index.html:", o[:200])

# Test API via nginx
o, e = run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")
ANON = o.strip()

o, e = run(f"""curl -sS 'http://localhost/rest/v1/wms_orders?limit=3' \
  -H 'apikey: {ANON}' 2>&1 | head -c 300""")
print(f"\nAnonymous /rest/v1/wms_orders: {o}")
