#!/usr/bin/env python3
"""Fix envoy port mapping + integrate with EXISTING nginx configs."""
import socket, paramiko, time, json, base64, hmac, hashlib

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

# === 1. What nginx configs exist? ===
print("=== 1. Existing nginx configs ===")
o, e = run("""ls -la /etc/nginx/sites-enabled/ 2>/dev/null
echo '---'
ls -la /etc/nginx/sites-available/ 2>/dev/null
echo '---'
# Show each existing server's server_name
for f in /etc/nginx/sites-enabled/*; do
  echo "=== $f ==="
  grep -E 'server_name|listen|root' "$f" | head -10
  echo "---"
done""")
print(o[:3000])

# === 2. Fix envoy port — change "127.0.0.1:8000:8000/tcp" to "8000:8000" ===
print("\n=== 2. Fix envoy port mapping ===")
o, e = run("sed -i 's/127.0.0.1:8000:8000\\/tcp/8000:8000/g' /opt/supabase/docker/docker-compose.yml && grep -n '8000' /opt/supabase/docker/docker-compose.yml | head -5")
print(o)

# Restart envoy
o, e = run("docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env up -d api-gw 2>&1 && sleep 4 && docker port supabase-envoy")
print(o)

# === 3. Start nginx first (fix dup server issue) ===
print("\n=== 3. Fix nginx duplicate default server ===")
# Remove our wms file first, start nginx, then we'll add to existing config
run("sudo rm -f /etc/nginx/sites-enabled/wms /etc/nginx/sites-available/wms")
o, e = run("sudo nginx -t 2>&1")
print(f"nginx test: {o}")
o, e = run("sudo systemctl start nginx 2>&1 || sudo nginx 2>&1; sleep 1; curl -sS -o /dev/null -w 'HTTP %{http_code}\\n' http://localhost/ 2>&1")
print(f"nginx start: {o}")

# === 4. Now — do we need nginx at all? envoy is now on 0.0.0.0:8000 ===
print("\n=== 4. Test direct envoy access (port 8000) ===")
o, e = run("curl -sS -o /dev/null -w 'LOCAL: HTTP %{http_code}\\n' http://localhost:8000/ 2>&1")
print(o)

# We need to know if external port 8000 is reachable. Let's just build a simple nginx reverse proxy
# that proxies all requests to envoy on 8000
# Actually, let me see what thalvior.icu currently serves
print("\n=== 5. What does thalvior.icu resolve to? ===")
o, e = run("curl -sS -o /dev/null -w 'thalvior.icu: HTTP %{http_code}\\n' http://thalvior.icu/ 2>&1 || echo 'no curl external'; nslookup thalvior.icu 2>/dev/null | head -5")
print(o)

# === 6. The simplest approach: nginx on port 80 → WMS frontend at / → proxy /rest/ and /auth/ to envoy ===
# Use a non-conflicting config — don't make it default_server
print("\n=== 6. Create wms nginx config (non-default, use specific server_name or catch-all) ===")

# Actually, let me just check — what domains are currently handled?
o, e = run("grep -r 'server_name' /etc/nginx/sites-enabled/ 2>/dev/null")
print("Current server_names:")
print(o)

# If thalvior.icu is available, use it. Otherwise, just catch remaining traffic
nginx_wms = """# WMS Warehouse Management System
# Frontend SPA + reverse proxy for Supabase API

# This is NOT a default_server — add specific server_name if needed
server {
    listen 80;
    listen [::]:80;
    server_name wms.thalvior.icu;

    root /var/www/wms;
    index index.html;

    # WMS Frontend SPA
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Supabase API proxy
    location /rest/ {
        proxy_pass http://127.0.0.1:8000/rest/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
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
}
"""
b64 = base64.b64encode(nginx_wms.encode()).decode()
run(f"echo '{b64}' | base64 -d | sudo tee /etc/nginx/sites-available/wms > /dev/null")
run("sudo ln -sf /etc/nginx/sites-available/wms /etc/nginx/sites-enabled/wms")
o, e = run("sudo nginx -t 2>&1")
print(f"nginx -t: {o}")
o, e = run("sudo nginx -s reload 2>&1 || sudo systemctl restart nginx 2>&1")
print(f"reload: {o} {e}")
time.sleep(2)

# === 7. Local test via nginx ===
print("\n=== 7. Test WMS via local nginx ===")
o, e = run(f"""curl -sS -H 'Host: wms.thalvior.icu' http://localhost/ -o /dev/null -w 'Frontend: HTTP %{{http_code}}\\n'
curl -sS -H 'Host: wms.thalvior.icu' http://localhost/index.html | head -5
echo '---'
curl -sS -H 'Host: wms.thalvior.icu' http://localhost/rest/v1/ 2>&1 | head -c 200""")
print(o)

# === 8. Update .env.production to use correct URL ===
print("\n=== 8. Update frontend .env.production ===")
import os
env_file = "/workspace/wms-app/.env.production"
with open(env_file) as f:
    content = f.read()
# Use localhost:8000 for now (direct envoy), OR wms.thalvior.icu
# Let's use the nginx proxy approach — /rest/ path
new_content = """VITE_SUPABASE_URL=http://wms.thalvior.icu
VITE_SUPABASE_ANON_KEY={anon_key}
""".format(anon_key=run("grep '^ANON_KEY=' /opt/supabase/docker/.env | cut -d= -f2")[0].strip())
with open(env_file, 'w') as f:
    f.write(new_content)
print("Updated .env.production:")
with open(env_file) as f:
    print(f.read()[:200])
