#!/usr/bin/env python3
"""Set up nginx to host frontend + proxy API."""
import socket, paramiko, time

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

# First, what's envoy's current binding?
print("=== Envoy port binding ===")
o, e = run("docker port supabase-envoy 2>&1")
print(o)

# Change envoy to bind 0.0.0.0 instead of 127.0.0.1
print("\n=== Updating docker-compose.yml envoy port mapping ===")
o, e = run("""cat /opt/supabase/docker/docker-compose.yml | grep -B2 -A5 'container_name: supabase-envoy' | head -20""")
print("Current envoy config:")
print(o)

# Fix port binding: change "127.0.0.1:8000->8000/tcp" to "8000:8000"
o, e = run("""sudo sed -i 's/127.0.0.1:8000->8000\\/tcp/8000:8000/g' /opt/supabase/docker/docker-compose.yml
sudo sed -i 's/127.0.0.1:8000->8000/8000:8000/g' /opt/supabase/docker/docker-compose.yml
grep -A3 'container_name: supabase-envoy' /opt/supabase/docker/docker-compose.yml | grep ports
echo '---'
# Also check if port 8000 is free
ss -tlnp | grep 8000
echo '---'
sudo ufw status 2>/dev/null || echo 'ufw not found'
sudo iptables -L -n | head -20 2>/dev/null || echo 'no iptables'
""")
print(o)

# Restart envoy
print("\n=== Restarting envoy ===")
o, e = run("docker compose -f /opt/supabase/docker/docker-compose.yml --env-file /opt/supabase/docker/.env up -d api-gw 2>&1")
print(o[:500])
time.sleep(3)

o, e = run("docker port supabase-envoy 2>&1; curl -sS -o /dev/null -w 'LOCAL 8000: HTTP %{http_code}\\n' http://localhost:8000/ 2>&1")
print(o)

# Now set up nginx for frontend
print("\n=== Setting up nginx for frontend ===")
o, e = run("""sudo nginx -v 2>&1; which nginx || sudo apt-get install -y nginx 2>&1 | tail -5
echo '---'
sudo tee /etc/nginx/sites-available/wms << 'NGINX'
server {
    listen 80;
    server_name _;

    root /var/www/wms;
    index index.html;

    # WMS Frontend SPA - serve index.html for all routes
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy to envoy
    location /rest/ {
        proxy_pass http://127.0.0.1:8000/rest/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Auth proxy
    location /auth/ {
        proxy_pass http://127.0.0.1:8000/auth/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Storage proxy
    location /storage/ {
        proxy_pass http://127.0.0.1:8000/storage/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Edge functions
    location /functions/ {
        proxy_pass http://127.0.0.1:8000/functions/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/wms /etc/nginx/sites-enabled/wms
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t 2>&1
sudo systemctl restart nginx 2>&1 || sudo nginx 2>&1
""")
print(o[:2000])

# Test nginx
print("\n=== Testing nginx ===")
o, e = run("""curl -sS -o /dev/null -w 'Frontend /: HTTP %{http_code}, size=%{size_download}\\n' http://localhost/ 2>&1
curl -sS 'http://localhost/rest/v1/rpc/get_current_tenant_id' -X POST \
  -H 'apikey: eyJhbGciOiAiSFMyNTYiLCAidHlwIjogIkpXVCJ9.eyJyb2xlIjogImFub24iLCJleHAiOjE3OTUwNzE4NTZ9.oGqR2v7e4S5Qz5oZ7bFd3dG9tN2J0aXJ2YzQ5N2NtcmxqK1hTdlpzK3k5Q3BOMW5QMFV3WVRVRXlJSkZtNXR0Njk5RT0' 2>&1 | head -c 200""")
print(o)
